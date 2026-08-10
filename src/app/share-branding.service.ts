import { Injectable, signal } from '@angular/core';

/** A logo and a few detail lines, stamped onto a post when it is shared. */
export interface ShareBranding {
  /** PNG data URL, so a transparent background survives. Null = none set. */
  logo: string | null;
  /** Up to four lines — shop name, phone, address, whatever they want. */
  details: string;
}

/**
 * The branding this device stamps onto admin posts when sharing them.
 *
 * It belongs to whoever is holding the phone, not to the post: the admin
 * publishes plain artwork, and each dealer forwards it carrying their OWN shop
 * logo and details. So it lives in localStorage on the device rather than in
 * Firestore — nothing here needs to reach the admin, and a logo is far too
 * large to be worth syncing.
 */
@Injectable({
  providedIn: 'root'
})
export class ShareBrandingService {
  private readonly STORAGE_KEY = 'glaron_share_branding_v1';

  // A signal so a template reading it re-renders the moment a logo is picked.
  private state = signal<ShareBranding>(this.load());

  get branding(): ShareBranding {
    return this.state();
  }

  get logo(): string | null {
    return this.state().logo;
  }

  get details(): string {
    return this.state().details;
  }

  /** True once there is something worth stamping. */
  get hasBranding(): boolean {
    const { logo, details } = this.state();
    return !!logo || !!details.trim();
  }

  setLogo(logo: string | null) {
    this.persist({ ...this.state(), logo: logo || null });
  }

  setDetails(details: string) {
    this.persist({ ...this.state(), details: details || '' });
  }

  clear() {
    this.persist({ logo: null, details: '' });
  }

  /**
   * Read a picked file into a logo: fitted inside a square bound and kept as a
   * PNG, because a JPEG has no transparency and this sits straight on the
   * artwork with nothing behind it. Resolves to an error message, or null on
   * success.
   */
  async readLogoFile(file: File): Promise<string | null> {
    if (!file.type.startsWith('image/')) return 'Please choose an image file.';

    let img: HTMLImageElement;
    try {
      img = await this.loadImage(file);
    } catch (e) {
      return 'That logo could not be read.';
    }

    // It is drawn at roughly a fifth of the post's width, so a few hundred
    // pixels is already more than enough detail. localStorage is the limit
    // here, hence the step down through smaller bounds until it fits.
    const budget = 260_000;
    for (const bound of [420, 320, 240]) {
      const dataUrl = this.scaleToPng(img, bound);
      if (dataUrl && dataUrl.length <= budget) {
        this.setLogo(dataUrl);
        return null;
      }
    }
    return 'That logo is too detailed. Please use a simpler one.';
  }

  // ---- internals ----

  private loadImage(file: File): Promise<HTMLImageElement> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = () => reject(new Error('decode failed'));
        img.src = reader.result as string;
      };
      reader.onerror = () => reject(new Error('read failed'));
      reader.readAsDataURL(file);
    });
  }

  // Fit an image inside a square bound and return it as a PNG data URL.
  private scaleToPng(img: HTMLImageElement, bound: number): string {
    let width = img.width, height = img.height;
    if (width > bound || height > bound) {
      const scale = Math.min(bound / width, bound / height);
      width = Math.max(1, Math.round(width * scale));
      height = Math.max(1, Math.round(height * scale));
    }
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return '';
    ctx.drawImage(img, 0, 0, width, height);
    return canvas.toDataURL('image/png');
  }

  private load(): ShareBranding {
    try {
      const stored = localStorage.getItem(this.STORAGE_KEY);
      if (stored) {
        const parsed = JSON.parse(stored) as Partial<ShareBranding>;
        return {
          logo: typeof parsed.logo === 'string' && parsed.logo ? parsed.logo : null,
          details: typeof parsed.details === 'string' ? parsed.details : ''
        };
      }
    } catch (e) {
      console.warn('Share branding load notice:', e);
    }
    return { logo: null, details: '' };
  }

  private persist(next: ShareBranding) {
    this.state.set(next);
    try {
      localStorage.setItem(this.STORAGE_KEY, JSON.stringify(next));
    } catch (e) {
      // A logo that won't fit in storage still works for this session.
      console.warn('Share branding save notice:', e);
    }
  }
}
