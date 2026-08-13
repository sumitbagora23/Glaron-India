import { Injectable } from '@angular/core';

/** What actually happened when a link was handed to the device. */
export type CatalogShareOutcome = 'shared' | 'copied' | 'cancelled' | 'failed';

/**
 * Builds and shares the public-catalogue link that sits in the side menu of both
 * panels.
 *
 * Each account gets its own link, derived from the mobile number it signs in
 * with, so the same account always produces the same URL and two accounts never
 * produce the same one. The code is a pair of one-way hashes of the digits, not
 * an encoding of them: a recipient can't read a number back out of the link, and
 * nothing in the app ever tries to. It exists so a shared link can be told
 * apart, not so whoever opens it can be identified.
 *
 * A bare link lands in a chat as a grey strip of text, so the link travels with
 * a branded card drawn here on a canvas — pendant lamps lighting the Glaron mark.
 * Nothing on it identifies the sender: unlike a shared post, which each shop
 * stamps with its own details, this card is the brand's own advertisement and the
 * link beneath it is what makes it theirs. The card is the picture; the link
 * rides along as the caption. Devices without file sharing (most desktops) fall
 * back to the plain link, then to the clipboard.
 */
@Injectable({ providedIn: 'root' })
export class CatalogShareService {
  /** The caption that travels with the card. */
  private readonly CAPTION =
    'The Glaron India lighting catalogue — designer lights, profiles and fixtures, ' +
    'the whole range in one place. Open it here:';

  /**
   * Marks a link the Glaron office shared itself.
   *
   * A dealer's or agent's link opens a plain catalogue — their customer must not
   * be able to ask Glaron for a price directly, because that is the dealer's own
   * sale to make and quoting over their head would cut them out of it. Only a
   * link shared from the admin console carries the quotation flow, and this
   * prefix is the whole of what tells the two apart.
   *
   * It is a feature marker, not a secret: guessing it reveals no prices, only a
   * form that asks Glaron to quote.
   *
   * The '-' is what makes it safe to test for. The codes below are base-36
   * hashes — digits and letters only — so one can never begin with 'q-' by
   * accident, however many accounts exist.
   */
  private readonly OFFICE_PREFIX = 'q-';

  /** True when this link came from the office, so it may ask for a quotation. */
  isOfficeRef(ref: string): boolean {
    return (ref || '').startsWith(this.OFFICE_PREFIX);
  }

  /** Stable per-account code. Falls back to a generic one with no seed. */
  linkCode(seed: string): string {
    const digits = (seed || '').replace(/\D/g, '');
    if (!digits) return 'glaron';

    // Two FNV-1a passes from different offsets — 64 bits of code, which is far
    // more than enough to keep every account's link distinct.
    const a = this.hash(digits, 0x811c9dc5).toString(36).padStart(7, '0');
    const b = this.hash(digits, 0x2545f491).toString(36).padStart(7, '0');
    return a + b;
  }

  /** FNV-1a, 32-bit. */
  private hash(text: string, offset: number): number {
    let h = offset >>> 0;
    for (let i = 0; i < text.length; i++) {
      h ^= text.charCodeAt(i);
      h = Math.imul(h, 16777619) >>> 0;
    }
    return h >>> 0;
  }

  /**
   * The catalogue's own address.
   *
   * It gets a site to itself so that what a customer receives reads as a
   * catalogue and nothing else. A link sent from a dealer's phone used to carry
   * the word "dealer" in it, and one sent from the console pointed at a host
   * with the company's project id on it — neither is anything to hand a
   * stranger. The code after the slash is unchanged: same per-account hash, same
   * `q-` on the office's own link.
   */
  private readonly CATALOGUE_ORIGIN = 'https://glaron-catalogue.web.app';

  /**
   * Where a shared link should point.
   *
   * `ng serve` has no catalogue site to reach, so links made while testing stay
   * on the dev server where they can actually be opened.
   */
  private origin(override?: string): string {
    if (override) return override;
    const host = window.location.hostname;
    if (host === 'localhost' || host === '127.0.0.1') return window.location.origin;
    return this.CATALOGUE_ORIGIN;
  }

  /** Absolute URL of this account's catalogue, ready to paste into a chat. */
  linkFor(seed: string, origin?: string): string {
    return `${this.origin(origin)}/${this.linkCode(seed)}`;
  }

  /** The office's own link — the only one carrying the quotation flow. */
  officeLinkFor(seed: string, origin?: string): string {
    return `${this.origin(origin)}/${this.OFFICE_PREFIX}${this.linkCode(seed)}`;
  }

  /**
   * Hands the card and the link to the device share sheet, falling back to the
   * link alone and then to the clipboard.
   */
  async share(seed: string, opts?: { office?: boolean; origin?: string }): Promise<CatalogShareOutcome> {
    const url = opts?.office
      ? this.officeLinkFor(seed, opts?.origin)
      : this.linkFor(seed, opts?.origin);
    const caption = `${this.CAPTION}\n${url}`;
    const nav = navigator as any;

    // Preferred path: the branded card with the link as its caption.
    let file: File | null = null;
    try {
      file = await this.buildCard();
    } catch (e) {
      console.warn('Catalogue share: could not draw the card', e);
    }

    if (file && nav.canShare && nav.canShare({ files: [file] })) {
      try {
        await nav.share({ files: [file], text: caption });
        return 'shared';
      } catch (e: any) {
        if (e?.name === 'AbortError') return 'cancelled';
        console.warn('Catalogue share: card share failed, sending the link', e);
      }
    }

    if (navigator.share) {
      try {
        await navigator.share({ title: 'Glaron India Catalogue', text: this.CAPTION, url });
        return 'shared';
      } catch (e: any) {
        // Dismissing the sheet is not an error worth reporting.
        if (e?.name === 'AbortError') return 'cancelled';
      }
    }

    return (await this.copyToClipboard(url)) ? 'copied' : 'failed';
  }

  // ---- The share card ----

  private readonly FONT = '"Outfit", "Segoe UI", Roboto, Helvetica, Arial, sans-serif';
  private readonly W = 1080;
  private readonly H = 1350;

  /**
   * Draws the 4:5 portrait card WhatsApp and Instagram both show without
   * cropping: a dark room, three pendant lamps hanging into the top of it, and
   * the Glaron mark standing in the light they throw. Nothing about the sender
   * goes on it — the card is the brand's, the link underneath is theirs.
   */
  private async buildCard(): Promise<File> {
    // Outfit is a web font: without this the first card of a session would be
    // drawn in the fallback face.
    try { await (document as any).fonts?.ready; } catch (e) {}

    const canvas = document.createElement('canvas');
    canvas.width = this.W;
    canvas.height = this.H;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('canvas unavailable');

    this.drawBackground(ctx);
    this.drawPendants(ctx);
    await this.drawLogo(ctx);
    this.drawCopy(ctx);
    this.drawFrame(ctx);

    const blob = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(b => (b ? resolve(b) : reject(new Error('toBlob failed'))), 'image/jpeg', 0.92);
    });
    return new File([blob], 'glaron-catalogue.jpg', { type: 'image/jpeg' });
  }

  /** The unlit room the lamps hang in: deep purple, darkest at the corners. */
  private drawBackground(ctx: CanvasRenderingContext2D) {
    const { W, H } = this;

    const ground = ctx.createLinearGradient(0, 0, W * 0.3, H);
    ground.addColorStop(0, '#2a0a5c');
    ground.addColorStop(0.5, '#170338');
    ground.addColorStop(1, '#08010f');
    ctx.fillStyle = ground;
    ctx.fillRect(0, 0, W, H);

    // Vignette. The corners have to fall away or the lamps have nothing to be
    // brighter than.
    const vignette = ctx.createRadialGradient(W * 0.5, H * 0.34, W * 0.2, W * 0.5, H * 0.5, H * 0.78);
    vignette.addColorStop(0, 'rgba(0,0,0,0)');
    vignette.addColorStop(1, 'rgba(0,0,0,.55)');
    ctx.fillStyle = vignette;
    ctx.fillRect(0, 0, W, H);

    // The pool the light lands in, low and centred, so the card has a floor.
    const floor = ctx.createRadialGradient(W * 0.5, H * 0.78, 0, W * 0.5, H * 0.78, W * 0.62);
    floor.addColorStop(0, 'rgba(254,179,0,.13)');
    floor.addColorStop(0.5, 'rgba(254,179,0,.035)');
    floor.addColorStop(1, 'rgba(254,179,0,0)');
    ctx.fillStyle = floor;
    ctx.fillRect(0, 0, W, H);
  }

  /**
   * Three pendant lamps on gold flex, hanging in from the top edge at different
   * drops, each throwing a cone of light down the card. This is the whole idea
   * of the piece: the product is doing the lighting, and everything below reads
   * because of it.
   */
  private drawPendants(ctx: CanvasRenderingContext2D) {
    const lamps = [
      { x: 236, drop: 168, scale: 0.78 },
      { x: 540, drop: 262, scale: 1.0 },
      { x: 848, drop: 132, scale: 0.7 }
    ];
    for (const lamp of lamps) this.drawPendant(ctx, lamp.x, lamp.drop, lamp.scale);
  }

  private drawPendant(ctx: CanvasRenderingContext2D, x: number, drop: number, scale: number) {
    const shadeTop = drop;
    const shadeHeight = 78 * scale;
    const shadeBottom = shadeTop + shadeHeight;
    const topWidth = 26 * scale;
    const bottomWidth = 134 * scale;
    const bulbY = shadeBottom + 12 * scale;

    ctx.save();

    // Flex, from the top edge of the card down to the shade.
    ctx.strokeStyle = 'rgba(254,179,0,.30)';
    ctx.lineWidth = Math.max(1.5, 2.5 * scale);
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, shadeTop + 2);
    ctx.stroke();

    // The cone of light, drawn before the shade so the shade sits on top of it.
    // `lighter` makes overlapping cones build up the way real light does.
    const coneLength = 620 * scale;
    const coneEnd = bulbY + coneLength;
    const cone = ctx.createLinearGradient(0, bulbY, 0, coneEnd);
    cone.addColorStop(0, 'rgba(255,208,102,.38)');
    cone.addColorStop(0.35, 'rgba(254,179,0,.13)');
    cone.addColorStop(1, 'rgba(254,179,0,0)');
    ctx.globalCompositeOperation = 'lighter';
    ctx.fillStyle = cone;
    ctx.beginPath();
    ctx.moveTo(x - bottomWidth / 2, shadeBottom);
    ctx.lineTo(x + bottomWidth / 2, shadeBottom);
    ctx.lineTo(x + bottomWidth * 1.9, coneEnd);
    ctx.lineTo(x - bottomWidth * 1.9, coneEnd);
    ctx.closePath();
    ctx.fill();

    // The bulb, and the halo around it.
    const halo = ctx.createRadialGradient(x, bulbY, 0, x, bulbY, 150 * scale);
    halo.addColorStop(0, 'rgba(255,224,150,.85)');
    halo.addColorStop(0.18, 'rgba(255,196,74,.40)');
    halo.addColorStop(1, 'rgba(254,179,0,0)');
    ctx.fillStyle = halo;
    ctx.beginPath();
    ctx.arc(x, bulbY, 150 * scale, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalCompositeOperation = 'source-over';

    ctx.fillStyle = '#fff7e2';
    ctx.beginPath();
    ctx.arc(x, bulbY, 13 * scale, 0, Math.PI * 2);
    ctx.fill();

    // Brushed-brass shade: lit down its left face, falling into shadow right.
    const brass = ctx.createLinearGradient(x - bottomWidth / 2, 0, x + bottomWidth / 2, 0);
    brass.addColorStop(0, '#8a5f12');
    brass.addColorStop(0.32, '#FEB300');
    brass.addColorStop(0.62, '#c98a15');
    brass.addColorStop(1, '#5d3d08');
    ctx.fillStyle = brass;
    ctx.beginPath();
    ctx.moveTo(x - topWidth / 2, shadeTop);
    ctx.lineTo(x + topWidth / 2, shadeTop);
    ctx.lineTo(x + bottomWidth / 2, shadeBottom);
    ctx.lineTo(x - bottomWidth / 2, shadeBottom);
    ctx.closePath();
    ctx.fill();

    // Hot rim along the open mouth of the shade.
    ctx.strokeStyle = 'rgba(255,231,168,.9)';
    ctx.lineWidth = Math.max(2, 3.5 * scale);
    ctx.beginPath();
    ctx.moveTo(x - bottomWidth / 2, shadeBottom);
    ctx.lineTo(x + bottomWidth / 2, shadeBottom);
    ctx.stroke();

    ctx.restore();
  }

  /** The white wordmark, centred in the light, with the gold eyebrow beneath. */
  private async drawLogo(ctx: CanvasRenderingContext2D) {
    const { W } = this;
    try {
      const logo = await this.loadImage('assets/glaron-logo-white.png');
      // The mark is a tall lockup (roughly 15:8), so it is sized off the width
      // and the height follows.
      const width = Math.round(W * 0.40);
      const height = Math.round((logo.height / logo.width) * width);
      ctx.drawImage(logo, Math.round((W - width) / 2), 480, width, height);
    } catch (e) {
      // No logo file — the name still has to be on the card.
      ctx.save();
      ctx.textAlign = 'center';
      ctx.fillStyle = '#ffffff';
      ctx.font = `800 76px ${this.FONT}`;
      ctx.fillText('GLARON', W / 2, 620);
      ctx.restore();
    }

    this.drawTracked(ctx, 'THE LIGHTING CATALOGUE', W / 2, 790, `700 24px ${this.FONT}`, 7, '#FEB300');
  }

  /** Headline, supporting line, and the call to action. */
  private drawCopy(ctx: CanvasRenderingContext2D) {
    const { W } = this;

    ctx.save();
    ctx.textAlign = 'center';

    // A faint warm glow behind the headline, so it looks lit rather than laid on.
    ctx.shadowColor = 'rgba(254,179,0,.35)';
    ctx.shadowBlur = 40;
    ctx.fillStyle = '#ffffff';
    ctx.font = `800 84px ${this.FONT}`;
    ctx.fillText('Light that', W / 2, 890);
    ctx.fillText('makes the room.', W / 2, 985);
    ctx.shadowBlur = 0;

    // Gold rule between the headline and the detail.
    ctx.fillStyle = '#FEB300';
    ctx.fillRect(W / 2 - 55, 1030, 110, 4);

    ctx.fillStyle = 'rgba(255,255,255,.78)';
    ctx.font = `500 33px ${this.FONT}`;
    this.wrap(
      ctx,
      'Designer lights, profiles and fixtures — the complete Glaron India range, always up to date.',
      W / 2, 1098, W - 300, 46
    );

    ctx.restore();

    this.drawCta(ctx, 1190);
  }

  /** Inset gold hairline — reads as a printed card rather than a screenshot. */
  private drawFrame(ctx: CanvasRenderingContext2D) {
    ctx.save();
    ctx.strokeStyle = 'rgba(254,179,0,.40)';
    ctx.lineWidth = 2;
    this.roundRect(ctx, 30, 30, this.W - 60, this.H - 60, 30);
    ctx.stroke();
    ctx.restore();
  }

  /** Gold pill: the one thing the card is asking anyone to do. */
  private drawCta(ctx: CanvasRenderingContext2D, top: number) {
    const label = 'Open the catalogue  →';
    const font = `700 38px ${this.FONT}`;

    ctx.save();
    ctx.font = font;
    const width = Math.round(ctx.measureText(label).width) + 92;
    const height = 92;
    const left = Math.round((this.W - width) / 2);

    const fill = ctx.createLinearGradient(left, top, left + width, top + height);
    fill.addColorStop(0, '#FEB300');
    fill.addColorStop(1, '#F5941D');
    ctx.fillStyle = fill;
    this.roundRect(ctx, left, top, width, height, height / 2);
    ctx.fill();

    ctx.fillStyle = '#170338';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(label, this.W / 2, top + height / 2 + 2);
    ctx.restore();
  }

  // ---- canvas helpers ----

  /** Letter-spaced text; `ctx.letterSpacing` is still missing on Safari. */
  private drawTracked(
    ctx: CanvasRenderingContext2D, text: string, centerX: number, y: number,
    font: string, spacing: number, color: string
  ) {
    ctx.save();
    ctx.font = font;
    ctx.fillStyle = color;
    ctx.textAlign = 'left';
    const total = [...text].reduce((sum, ch) => sum + ctx.measureText(ch).width + spacing, 0) - spacing;
    let x = centerX - total / 2;
    for (const ch of text) {
      ctx.fillText(ch, x, y);
      x += ctx.measureText(ch).width + spacing;
    }
    ctx.restore();
  }

  /** Centre-aligned word wrap. Returns the y it finished on. */
  private wrap(
    ctx: CanvasRenderingContext2D, text: string, centerX: number, top: number,
    maxWidth: number, lineHeight: number
  ): number {
    let line = '';
    let y = top;
    for (const word of text.split(' ')) {
      const next = line ? `${line} ${word}` : word;
      if (ctx.measureText(next).width > maxWidth && line) {
        ctx.fillText(line, centerX, y);
        line = word;
        y += lineHeight;
      } else {
        line = next;
      }
    }
    if (line) ctx.fillText(line, centerX, y);
    return y;
  }

  private roundRect(
    ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number
  ) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  private loadImage(src: string): Promise<HTMLImageElement> {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error('image load failed'));
      img.src = src;
    });
  }

  private async copyToClipboard(text: string): Promise<boolean> {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch (e) {
      // The Clipboard API needs a secure context; fall back to the legacy path.
      const area = document.createElement('textarea');
      area.value = text;
      area.style.position = 'fixed';
      area.style.opacity = '0';
      document.body.appendChild(area);
      area.select();
      let ok = false;
      try { ok = document.execCommand('copy'); } catch (e2) {}
      area.remove();
      return ok;
    }
  }
}
