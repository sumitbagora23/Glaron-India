import { Injectable } from '@angular/core';

/**
 * A dealer's own, device-local price preferences for the catalog cards.
 *
 * These are display settings the dealer controls from their profile — they do
 * NOT touch the contracted pricing the Glaron admin sets on the dealer record
 * (Dealer.multiplier / Dealer.customPrices), and they are never written to
 * Firestore. A dealer typically uses them when showing the catalog to their own
 * customer: hide the prices entirely, or show their own selling price instead of
 * the Glaron rate. Their own orders to Glaron still go out at the contracted
 * price, which is why nothing here is read by the cart or checkout.
 *
 * Everything is stored under a key that includes the signed-in mobile number, so
 * two dealers sharing one device never see each other's prices.
 */
/**
 * What the product cards show:
 *  - 'mrp'  the catalog price the admin set on the product itself
 *  - 'my'   the price the admin set for this particular dealer (contracted rate)
 *  - 'hide' no prices at all
 */
export type DealerPriceMode = 'mrp' | 'my' | 'hide';

export interface DealerPricePrefs {
  /** Which of the three prices the product cards show. */
  priceMode: DealerPriceMode;
  /** The last blanket discount the dealer applied, kept so the field repopulates. */
  discountPercent: number;
  /** productId (or `productId#variantIndex`) -> the dealer's own price. */
  customPrices: Record<string, number>;
}

@Injectable({ providedIn: 'root' })
export class DealerPricePrefsService {
  private readonly PREFIX = 'glaron_dealer_price_prefs_';

  // The dealer these prefs belong to (bare 10 digits), and their loaded prefs.
  // Held in memory because the catalog reads them for every product on every
  // change-detection tick — re-parsing localStorage there would be far too slow.
  private mobile = '';
  private prefs: DealerPricePrefs = DealerPricePrefsService.blank();

  private static blank(): DealerPricePrefs {
    return { priceMode: 'my', discountPercent: 0, customPrices: {} };
  }

  private static normalize(mobile: string | null | undefined): string {
    const digits = (mobile || '').replace(/\D/g, '');
    return digits.length > 10 ? digits.slice(-10) : digits;
  }

  /**
   * Point the service at a dealer and load their saved prefs. Called whenever
   * the catalog resolves the signed-in dealer; a no-op when it is the same one.
   * An empty mobile (signed out) resets to defaults.
   */
  use(mobile: string | null | undefined) {
    const key = DealerPricePrefsService.normalize(mobile);
    if (key === this.mobile) return;
    this.mobile = key;
    this.prefs = key ? this.read(key) : DealerPricePrefsService.blank();
  }

  get priceMode(): DealerPriceMode {
    return this.prefs.priceMode;
  }

  setPriceMode(mode: DealerPriceMode) {
    this.prefs.priceMode = mode;
    this.write();
  }

  /** Convenience for the cards: anything but 'hide' shows a price. */
  get showPrices(): boolean {
    return this.prefs.priceMode !== 'hide';
  }

  get discountPercent(): number {
    return this.prefs.discountPercent;
  }

  /** How many products/variants carry a dealer-set price right now. */
  get overrideCount(): number {
    return Object.keys(this.prefs.customPrices).length;
  }

  /** True when anything has been changed from the default contracted view. */
  get isCustomised(): boolean {
    return this.overrideCount > 0 || this.prefs.discountPercent > 0 || this.prefs.priceMode !== 'my';
  }

  /**
   * The dealer's own price for a product/variant key, or null when they haven't
   * set one (so the caller falls back to the contracted Glaron price).
   */
  override(key: string): number | null {
    const value = this.prefs.customPrices[key];
    return typeof value === 'number' && isFinite(value) ? value : null;
  }

  /** Replace the whole override map — the custom-price editor saves in one go. */
  saveOverrides(prices: Record<string, number>, discountPercent: number) {
    this.prefs.customPrices = { ...prices };
    this.prefs.discountPercent = discountPercent > 0 ? discountPercent : 0;
    this.write();
  }

  /** Clear every custom price and the discount, keeping the chosen view. */
  reset() {
    const priceMode = this.prefs.priceMode;
    this.prefs = DealerPricePrefsService.blank();
    // Resetting prices shouldn't silently un-hide them mid-demo.
    this.prefs.priceMode = priceMode;
    this.write();
  }

  private read(mobile: string): DealerPricePrefs {
    const fallback = DealerPricePrefsService.blank();
    try {
      const raw = localStorage.getItem(this.PREFIX + mobile);
      if (!raw) return fallback;
      const parsed = JSON.parse(raw);
      const saved = parsed?.priceMode;
      return {
        priceMode: (saved === 'mrp' || saved === 'my' || saved === 'hide')
          ? saved
          // Prefs written before the three-way selector only had a show/hide
          // flag; those dealers were seeing their contracted price.
          : (parsed?.showPrices === false ? 'hide' : 'my'),
        discountPercent: Number(parsed?.discountPercent) || 0,
        customPrices: (parsed && typeof parsed.customPrices === 'object' && parsed.customPrices) || {}
      };
    } catch (e) {
      return fallback;
    }
  }

  private write() {
    if (!this.mobile) return;
    try {
      localStorage.setItem(this.PREFIX + this.mobile, JSON.stringify(this.prefs));
    } catch (e) {}
  }
}
