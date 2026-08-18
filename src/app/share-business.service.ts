import { Injectable, signal } from '@angular/core';

/** The three lines that go into the footer strip under a shared post. */
export interface ShareBusiness {
  /** Shop name — printed in the middle of the footer. */
  shop: string;
  /** Mobile number — printed in the left-hand corner. */
  mobile: string;
  /** Email address — printed in the right-hand corner. */
  email: string;
}

/**
 * The business details this device prints under an admin post when sharing it.
 *
 * They belong to whoever is holding the phone, not to the post: the admin
 * publishes plain artwork, and each shop forwards it with its OWN name, mobile
 * and email in the footer. So they live in localStorage on the device rather
 * than in Firestore — nothing here needs to reach the admin.
 *
 * They are stored PER ACCOUNT. One device can be signed into either panel, and
 * a single shared slot meant a post forwarded from one panel went out carrying
 * the details typed in the other. `useAccount()` moves the service onto the
 * signed-in account's own slot before anything is read or written.
 */
@Injectable({
  providedIn: 'root'
})
export class ShareBusinessService {
  // The original device-wide slot. Still read once for an account that has
  // nothing of its own yet, so details already typed on this device are not
  // lost the first time it opens after this change.
  private readonly LEGACY_KEY = 'glaron_share_business_v1';

  /** Where the details for the signed-in account are kept. */
  private storageKey = this.LEGACY_KEY;

  // A signal so a template reading it re-renders as soon as it's saved.
  private state = signal<ShareBusiness>(this.load());

  /**
   * Point the service at one account's own details.
   *
   * Called by each panel as it opens. `inheritLegacy` is for the panel whose
   * details the shared slot most likely held — it adopts them once instead of
   * starting blank; every other account starts empty, which is the whole point
   * of the split.
   */
  useAccount(kind: 'dealer' | 'agent', id: string, inheritLegacy = false) {
    const account = (id || '').trim();
    const key = `${this.LEGACY_KEY}::${kind}` + (account ? ':' + account : '');
    if (key === this.storageKey) return;
    this.storageKey = key;
    this.state.set(this.load(inheritLegacy));
  }

  get business(): ShareBusiness {
    return this.state();
  }

  get shop(): string {
    return this.state().shop;
  }

  get mobile(): string {
    return this.state().mobile;
  }

  get email(): string {
    return this.state().email;
  }

  /** The mobile exactly as it is printed on the post, dial code and all. */
  get printedMobile(): string {
    return ShareBusinessService.withDialCode(this.state().mobile);
  }

  /**
   * Puts +91 in front of a plain Indian number so the footer reads like a
   * number someone abroad could dial. A number that already carries its own
   * country code is left alone.
   */
  static withDialCode(raw: string): string {
    const value = (raw || '').trim();
    if (!value) return '';
    if (value.startsWith('+')) return value;

    const digits = value.replace(/\D/g, '');
    if (!digits) return '';
    if (digits.length === 12 && digits.startsWith('91')) return `+91 ${digits.slice(2)}`;
    if (digits.length === 11 && digits.startsWith('0')) return `+91 ${digits.slice(1)}`;
    return `+91 ${digits}`;
  }

  /** True once there is something worth printing in the footer. */
  get hasBusiness(): boolean {
    const { shop, mobile, email } = this.state();
    return !!(shop.trim() || mobile.trim() || email.trim());
  }

  save(next: ShareBusiness) {
    this.persist({
      shop: (next.shop || '').trim(),
      mobile: (next.mobile || '').trim(),
      email: (next.email || '').trim()
    });
  }

  clear() {
    this.persist({ shop: '', mobile: '', email: '' });
  }

  // ---- internals ----

  private load(inheritLegacy = false): ShareBusiness {
    const own = this.read(this.storageKey);
    if (own) return own;
    if (inheritLegacy) {
      const legacy = this.read(this.LEGACY_KEY);
      if (legacy) return legacy;
    }
    return { shop: '', mobile: '', email: '' };
  }

  /** One slot's details, or null when it holds nothing usable. */
  private read(key: string): ShareBusiness | null {
    try {
      const stored = localStorage.getItem(key);
      if (stored) {
        const parsed = JSON.parse(stored) as Partial<ShareBusiness>;
        return {
          shop: typeof parsed.shop === 'string' ? parsed.shop : '',
          mobile: typeof parsed.mobile === 'string' ? parsed.mobile : '',
          email: typeof parsed.email === 'string' ? parsed.email : ''
        };
      }
    } catch (e) {
      console.warn('Share business load notice:', e);
    }
    return null;
  }

  private persist(next: ShareBusiness) {
    this.state.set(next);
    try {
      localStorage.setItem(this.storageKey, JSON.stringify(next));
    } catch (e) {
      // Storage full or blocked — the details still work for this session.
      console.warn('Share business save notice:', e);
    }
  }
}
