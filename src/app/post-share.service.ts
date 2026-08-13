import { Injectable, inject } from '@angular/core';
import { SharePost } from './admin/post.service';
import { ShareBusinessService } from './share-business.service';

/** What actually happened when the dealer tapped Share. */
export type ShareOutcome = 'shared' | 'downloaded' | 'cancelled' | 'failed';

/**
 * Hands an admin post to the device's share sheet.
 *
 * Nothing is drawn ON the artwork. A black footer strip is added BELOW it and
 * the canvas grows to make room, so the design the admin made is never covered.
 * The strip carries this device's own business details (see
 * ShareBusinessService): mobile number in the left corner, shop name in the
 * middle, email in the right corner.
 *
 * With no details saved the post is forwarded byte-for-byte, with no
 * re-encoding at all.
 *
 * Browsers without file sharing (most desktops) save the image instead.
 */
@Injectable({
  providedIn: 'root'
})
export class PostShareService {
  // Wide enough to stay sharp on any phone, small enough to send instantly.
  private readonly MAX_WIDTH = 1080;

  private business = inject(ShareBusinessService);

  async share(post: SharePost): Promise<ShareOutcome> {
    const { shop, mobile, email } = this.business.business;
    const needsFooter = !!(shop || mobile || email);

    let blob: Blob;
    try {
      blob = needsFooter ? await this.compose(post) : this.toBlob(post.image);
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

  // The artwork on top, untouched, with the footer strip added underneath it.
  private async compose(post: SharePost): Promise<Blob> {
    const picture = await this.loadImage(post.image);

    const scale = picture.width > this.MAX_WIDTH ? this.MAX_WIDTH / picture.width : 1;
    const width = Math.max(1, Math.round(picture.width * scale));
    const height = Math.max(1, Math.round(picture.height * scale));

    // Sized off the width so the strip keeps the same proportions whatever
    // shape the post is, and floored so it stays readable on small artwork.
    const footerHeight = Math.max(58, Math.round(width * 0.085));

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height + footerHeight;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('canvas unavailable');

    ctx.drawImage(picture, 0, 0, width, height);
    this.drawFooter(ctx, width, height, footerHeight);

    return await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(
        (b) => (b ? resolve(b) : reject(new Error('toBlob failed'))),
        'image/jpeg',
        0.92
      );
    });
  }

  /**
   * The black band under the artwork: mobile hard left, shop name centred and
   * bold, email hard right. One flat block of black, edge to edge, the way a
   * printed brand strip looks — no gradient and no rule across the join.
   */
  private drawFooter(
    ctx: CanvasRenderingContext2D, width: number, top: number, height: number
  ) {
    const { shop, email } = this.business.business;
    const mobile = this.business.printedMobile;

    // Near-black rather than flat #000 — it sits under any artwork without
    // looking like a printing fault.
    ctx.fillStyle = '#121212';
    ctx.fillRect(0, top, width, height);

    const padding = Math.round(width * 0.035);
    const gap = Math.round(padding * 0.6);
    const middle = top + height / 2;
    const shopSize = Math.round(height * 0.30);
    const shopFont = `800 ${shopSize}px ${this.FONT}`;
    const room = width - 2 * padding;

    // The corners are measured first and the middle gets what's left, so the
    // shop name can never run into them. The email is never cut short — an
    // address is only any use whole — so when the three together are too wide
    // for the strip, the corner type steps down a size at a time until they
    // fit, and the shop name gives way before the email does.
    let sideSize = Math.round(height * 0.235);
    let sideFont = `600 ${sideSize}px ${this.FONT}`;
    let emailWidth = email ? this.measure(ctx, email, sideFont) : 0;
    let mobileWidth = mobile ? this.measure(ctx, mobile, sideFont) : 0;

    const floor = Math.round(height * 0.15);
    const shopMin = shop ? room * 0.26 : 0;
    while (
      sideSize > floor &&
      emailWidth + mobileWidth + shopMin + 2 * gap > room
    ) {
      sideSize -= 1;
      sideFont = `600 ${sideSize}px ${this.FONT}`;
      emailWidth = email ? this.measure(ctx, email, sideFont) : 0;
      mobileWidth = mobile ? this.measure(ctx, mobile, sideFont) : 0;
    }

    // Whatever the corners still ask for beyond their share is taken out of the
    // middle. Both are drawn with a maxWidth, so at the very worst the glyphs
    // condense a little — the whole address is always there to read.
    const corners = Math.min(emailWidth + mobileWidth, room - 2 * gap - 40);
    const shopRoom = Math.max(40, room - corners - 2 * gap);

    ctx.save();
    ctx.textBaseline = 'middle';

    if (shop) {
      ctx.textAlign = 'center';
      ctx.font = shopFont;
      ctx.fillStyle = '#ffffff';
      ctx.fillText(shop, width / 2, middle, shopRoom);
    }

    ctx.font = sideFont;
    ctx.fillStyle = '#f1f1f1';

    if (mobile) {
      ctx.textAlign = 'left';
      ctx.fillText(mobile, padding, middle, Math.max(40, mobileWidth));
    }

    if (email) {
      ctx.textAlign = 'right';
      ctx.fillText(email, width - padding, middle, Math.max(40, emailWidth));
    }

    ctx.restore();
  }

  private readonly FONT = '"Segoe UI", Roboto, Helvetica, Arial, sans-serif';

  private measure(ctx: CanvasRenderingContext2D, text: string, font: string): number {
    ctx.save();
    ctx.font = font;
    const w = ctx.measureText(text).width;
    ctx.restore();
    return w;
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
