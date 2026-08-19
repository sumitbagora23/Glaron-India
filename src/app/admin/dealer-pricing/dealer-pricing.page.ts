import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { IonContent } from '@ionic/angular/standalone';
import { ProductService, Product, ProductVariant } from '../product.service';
import { DealerService, Dealer } from '../dealer.service';

interface PricingRow {
  key: string;          // productId (no-variant) or productId#<variantIndex>
  variantLabel?: string;
  catalogPrice: number;
  customPrice: number;
}

interface PricingGroup {
  productId: string;
  name: string;         // product name (shown once)
  rows: PricingRow[];   // variants (or a single base row)
}

@Component({
  selector: 'app-dealer-pricing',
  templateUrl: './dealer-pricing.page.html',
  styleUrls: ['./dealer-pricing.page.scss'],
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    IonContent
  ]
})
export class DealerPricingPage implements OnInit {
  dealerId = '';
  dealerName = '';
  dealerLocation = '';
  dealerStatus = '';
  dealerPhone = '';
  currentDealer: Dealer | null = null;

  pricingGroups: PricingGroup[] = [];
  discountPercent: number | null = null;
  isLoading = false;

  constructor(
    private route: ActivatedRoute,
    private router: Router,
    private productService: ProductService,
    private dealerService: DealerService
  ) {}

  ngOnInit() {
    this.route.paramMap.subscribe(params => {
      const id = params.get('id');
      if (id) {
        this.dealerId = id;
        this.loadDealerDetails();
        this.loadPricingData();
      }
    });
  }

  loadDealerDetails() {
    const dealers = this.dealerService.dealers;
    const matched = dealers.find(d => d.id === this.dealerId || d.name === this.dealerId);
    if (matched) {
      this.currentDealer = matched;
      this.dealerName = matched.name;
      this.dealerLocation = matched.location || matched.address || 'India';
      this.dealerStatus = matched.status;
      this.dealerPhone = matched.phone || 'N/A';
      if (matched.multiplier && matched.multiplier < 1.0) {
        this.discountPercent = Math.round((1 - matched.multiplier) * 100);
      }
    } else {
      this.dealerName = this.dealerId;
      this.dealerLocation = 'General HQ';
      this.dealerStatus = 'Active';
      this.dealerPhone = 'N/A';
    }
  }

  loadPricingData() {
    const products = this.productService.products;
    let savedPrices: Record<string, number> = { ...(this.currentDealer?.customPrices || {}) };

    // localStorage only stands in for a dealer record that hasn't synced — it is
    // never merged on top of one that has. Older builds cached every product's
    // price there, and letting that copy win would re-pin lines the dealer
    // record has since released back to the catalog.
    if (Object.keys(savedPrices).length === 0) {
      try {
        const stored = localStorage.getItem(`dealer_prices_${this.dealerId}`);
        if (stored) savedPrices = { ...JSON.parse(stored) };
      } catch (e) {
        console.error('Error loading custom pricing from localStorage', e);
      }
    }

    const mult = this.effectiveMultiplier;

    this.pricingGroups = products.map(product => {
      const rows: PricingRow[] = [];
      if (product.variants && product.variants.length > 0) {
        product.variants.forEach((variant, idx) => {
          const key = `${product.id}#${idx}`;
          const catalogPrice = variant.price || variant.pricePerMtr || product.price;
          const customPrice = savedPrices[key] !== undefined ? savedPrices[key] : Math.round(catalogPrice * mult);
          rows.push({ key, variantLabel: this.buildVariantLabel(variant), catalogPrice, customPrice });
        });
      } else {
        const customPrice = savedPrices[product.id] !== undefined ? savedPrices[product.id] : Math.round(product.price * mult);
        rows.push({ key: product.id, catalogPrice: product.price, customPrice });
      }
      return { productId: product.id, name: product.name, rows };
    });
  }

  private buildVariantLabel(variant: ProductVariant): string {
    const parts: string[] = [];
    const bad = (v?: string) => !v || !v.trim() || /dimension/i.test(v);
    if (!bad(variant.wattage)) parts.push(variant.wattage!.trim());
    if (variant.dimension && variant.dimension.trim() && variant.dimension.trim() !== '-') parts.push(variant.dimension.trim());
    if (variant.pricePerMtr) parts.push('per mtr');
    if (parts.length === 0) parts.push('Variant');
    return parts.join(' · ');
  }

  /**
   * The rate that will be saved: the discount box when it holds a usable
   * percentage, otherwise the rate already on the dealer's record.
   */
  private get effectiveMultiplier(): number {
    const pct = this.discountPercent;
    return (pct !== null && pct >= 0 && pct <= 100)
      ? (100 - pct) / 100
      : (this.currentDealer?.multiplier || 1.0);
  }

  /** What a line shows when it simply follows the catalog at the blanket rate. */
  discountedPrice(row: PricingRow): number {
    return Math.round(row.catalogPrice * this.effectiveMultiplier);
  }

  /**
   * True when the line carries a hand-typed rate rather than the blanket
   * discount. Only these get written to the dealer record; every other line is
   * left to be recomputed from the catalog, so a later price edit in Products
   * reaches the dealer at the same discount. A blank or nonsense box counts as
   * following the catalog rather than pinning them to Rs. 0.
   */
  isPinned(row: PricingRow): boolean {
    const typed = Number(row.customPrice);
    if (!isFinite(typed) || typed <= 0) return false;
    return Math.round(typed) !== this.discountedPrice(row);
  }

  /** Drop a line's typed rate so it tracks the catalog again. */
  followCatalog(row: PricingRow) {
    row.customPrice = this.discountedPrice(row);
  }

  applyDiscount() {
    if (this.discountPercent === null || this.discountPercent < 0 || this.discountPercent > 100) {
      alert('Please enter a valid discount percentage between 0 and 100.');
      return;
    }

    const factor = (100 - this.discountPercent) / 100;
    this.pricingGroups.forEach(group => {
      group.rows.forEach(row => {
        row.customPrice = Math.round(row.catalogPrice * factor);
      });
    });
  }

  savePricing() {
    // The rows on screen replace the dealer's whole custom-price map. If the
    // dealer or the catalog hadn't synced when this page loaded, those rows are
    // catalog defaults for a subset of products — saving them would wipe the
    // dealer's real prices. Refuse rather than destroy them.
    if (!this.currentDealer) {
      alert('This dealer\'s record has not loaded yet. Please go back and open their pricing again.');
      return;
    }
    if (this.pricingGroups.length === 0) {
      alert('The product catalog has not loaded yet. Please go back and open their pricing again.');
      return;
    }

    this.isLoading = true;
    const storageKey = `dealer_prices_${this.dealerId}`;
    const mult = this.effectiveMultiplier;
    const pricingMap: Record<string, number> = {};

    // Only hand-typed rates are written down. A line still sitting at the blanket
    // discount is left out on purpose: the dealer panel recomputes that line from
    // whatever the catalog says at the time, so editing a price in Products
    // reaches the dealer at the same discount instead of the amount frozen here.
    this.pricingGroups.forEach(group => {
      group.rows.forEach(row => {
        if (this.isPinned(row)) pricingMap[row.key] = Math.round(Number(row.customPrice));
      });
    });

    // Save to DealerService & Firestore
    const targetId = this.currentDealer?.id || this.dealerId;
    this.dealerService.updateDealerMultiplier(targetId, mult, pricingMap);

    try {
      localStorage.setItem(storageKey, JSON.stringify(pricingMap));
    } catch (e) {
      console.error('Error saving custom pricing to localStorage', e);
    }

    setTimeout(() => {
      this.isLoading = false;
      this.router.navigate(['/admin/dealers']);
    }, 600);
  }

  discard() {
    this.router.navigate(['/admin/dealers']);
  }
}
