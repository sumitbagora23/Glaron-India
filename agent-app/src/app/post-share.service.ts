import { Injectable, inject } from '@angular/core';
import { SharePost } from './post.service';
import { ShareBrandingService } from './share-branding.service';

/** What actually happened when the agent tapped Share. */
export type ShareOutcome = 'shared' | 'downloaded' | 'cancelled' | 'failed';

/**
 * Hands an admin post to the device's share sheet.
 *
 * Nothing is added around the artwork — no bars, no frame. The only things
 * drawn are this agent's OWN branding (see ShareBrandingService): their logo
 * in the empty space at the top-right, and their detail lines at the
 * bottom-right. Both sit straight on the picture with nothing behind them, and
 * the text is coloured to suit whatever the artwork is doing underneath.
 *
 * With no branding set the post is forwarded byte-for-byte, with no re-encoding
 * at all.
 *
 * Browsers without file sharing (most desktops) save the image instead.
 */
@Injectable({
  providedIn: 'root'
})
export class PostShareService {
  // Wide enough to stay sharp on any phone, small enough to send instantly.
  private readonly MAX_WIDTH = 1080;

  private branding = inject(ShareBrandingService);

  async share(post: SharePost): Promise<ShareOutcome> {
    // Glaron publishes plain artwork; the branding stamped on is this agent's own.
    const logo = this.branding.logo;
    const details = (this.branding.details || '').trim();
    const needsDrawing = !!logo || !!details;

    let blob: Blob;
    try {
      blob = needsDrawing ? await this.compose(post, logo, details) : this.toBlob(post.image);
    } catch (e) {
      console.warn('Post share: could not build the image', e);
      return 'failed';
    }

    const extension = blob.type === 'image/png' ? 'png' : 'jpg';
    const file = new File([blob], `glaron-${post.id}.${extension}`, { type: blob.type });
    const text = (post.caption || '').trim();

    const nav = navigator as any;
    if (nav.canShare && nav.canShare({ files: [file] })) {
      try {
        await nav.share({ files: [file], ...(text ? { text } : {}) });
        return 'shared';
      } catch (e: any) {
        // Backing out of the share sheet is a normal thing to do, not an error.
        if (e && e.name === 'AbortError') return 'cancelled';
        console.warn('Post share: share sheet failed, saving instead', e);
      }
    }

    return this.download(blob, file.name) ? 'downloaded' : 'failed';
  }

  // ---- Image composition ----

  private async compose(post: SharePost, logo: string | null, details: string): Promise<Blob> {
    const picture = await this.loadImage(post.image);

    const scale = picture.width > this.MAX_WIDTH ? this.MAX_WIDTH / picture.width : 1;
    const width = Math.max(1, Math.round(picture.width * scale));
    const height = Math.max(1, Math.round(picture.height * scale));

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('canvas unavailable');

    ctx.drawImage(picture, 0, 0, width, height);

    // Overlays are sized off the shorter edge so a tall portrait post and a
    // wide landscape one end up with the same visual weight.
    const unit = Math.min(width, height);
    const margin = Math.round(unit * 0.045);

    if (logo) await this.drawLogo(ctx, logo, width, margin, unit);
    if (details) this.drawDetails(ctx, details, width, height, margin, unit);

    return await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(
        (b) => (b ? resolve(b) : reject(new Error('toBlob failed'))),
        'image/jpeg',
        0.92
      );
    });
  }

  // The agent's own logo in the top-right corner, transparent — no card, no tile.
  // A soft glow in the opposite tone to the artwork keeps its edges readable
  // without putting a visible shape behind it.
  private async drawLogo(
    ctx: CanvasRenderingContext2D, source: string, width: number, margin: number, unit: number
  ) {
    const logo = await this.loadImage(source).catch(() => null);
    if (!logo) return;

    const logoWidth = Math.round(unit * 0.22);
    const logoHeight = Math.round(logoWidth / (logo.width / logo.height || 1));
    const x = width - margin - logoWidth;
    const y = margin;

    const onDark = this.meanLuminance(ctx, x, y, logoWidth, logoHeight) < 140;

    ctx.save();
    ctx.shadowColor = onDark ? 'rgba(0, 0, 0, 0.5)' : 'rgba(255, 255, 255, 0.6)';
    ctx.shadowBlur = Math.round(unit * 0.018);
    ctx.drawImage(logo, x, y, logoWidth, logoHeight);
    ctx.restore();
  }

  // The agent's own detail lines at the bottom-right, right-aligned and stacked
  // upwards from the bottom margin. Ink colour follows the artwork: light type
  // over a dark corner, dark type over a light one.
  private drawDetails(
    ctx: CanvasRenderingContext2D,
    details: string,
    width: number, height: number,
    margin: number, unit: number
  ) {
    // At most four lines — beyond that it stops being a detail and starts
    // covering the design.
    const lines = details.split('\n').map((l) => l.trim()).filter(Boolean).slice(0, 4);
    if (!lines.length) return;

    const fontSize = Math.round(unit * 0.03);
    const lineHeight = Math.round(fontSize * 1.4);
    const blockHeight = lineHeight * lines.length;

    const blockTop = Math.max(0, height - margin - blockHeight);
    const blockLeft = Math.max(0, Math.round(width * 0.4));
    const onDark = this.meanLuminance(
      ctx, blockLeft, blockTop, width - margin - blockLeft, blockHeight
    ) < 140;

    ctx.save();
    ctx.textAlign = 'right';
    ctx.textBaseline = 'alphabetic';
    ctx.font = `700 ${fontSize}px "Segoe UI", Roboto, Helvetica, Arial, sans-serif`;
    ctx.fillStyle = onDark ? '#ffffff' : '#170338';
    ctx.shadowColor = onDark ? 'rgba(0, 0, 0, 0.55)' : 'rgba(255, 255, 255, 0.65)';
    ctx.shadowBlur = Math.round(unit * 0.014);

    const right = width - margin;
    lines.forEach((line, index) => {
      // The last line sits on the bottom margin; the rest stack above it.
      const baseline = height - margin - (lines.length - 1 - index) * lineHeight;
      ctx.fillText(line, right, baseline);
    });
    ctx.restore();
  }

  // Average brightness of one region, sampled coarsely — enough to tell a dark
  // corner from a light one. Returns mid-grey if the pixels can't be read.
  private meanLuminance(
    ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number
  ): number {
    let data: Uint8ClampedArray;
    try {
      data = ctx.getImageData(
        Math.max(0, Math.round(x)), Math.max(0, Math.round(y)),
        Math.max(1, Math.round(w)), Math.max(1, Math.round(h))
      ).data;
    } catch (e) {
      return 128;
    }

    let sum = 0, count = 0;
    // Every 4th pixel: 4x fewer samples, same verdict.
    for (let i = 0; i < data.length; i += 16) {
      sum += 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
      count++;
    }
    return count ? sum / count : 128;
  }

  private loadImage(src: string): Promise<HTMLImageElement> {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error('image load failed'));
      img.src = src;
    });
  }

  // Decode a stored `data:image/…;base64,…` URL into the original bytes.
  private toBlob(dataUrl: string): Blob {
    const match = /^data:(image\/[a-zA-Z0-9+.-]+);base64,(.+)$/.exec(dataUrl || '');
    if (!match) throw new Error('not an image data URL');

    const binary = atob(match[2]);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return new Blob([bytes], { type: match[1] });
  }

  // Last resort for browsers with no file sharing (most desktops).
  private download(blob: Blob, filename: string): boolean {
    try {
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
      return true;
    } catch (e) {
      console.warn('Post share: download failed', e);
      return false;
    }
  }
}
