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
    const customPrices = this.currentDealer?.customPrices || {};
    const storageKey = `dealer_prices_${this.dealerId}`;
    let savedPrices: Record<string, number> = { ...customPrices };

    try {
      const stored = localStorage.getItem(storageKey);
      if (stored) {
        const parsed = JSON.parse(stored);
        savedPrices = { ...savedPrices, ...parsed };
      }
    } catch (e) {
      console.error('Error loading custom pricing from localStorage', e);
    }

    const mult = this.currentDealer?.multiplier || 1.0;

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
    if (variant.type && variant.type.trim()) parts.push(variant.type.trim());
    if (variant.dimension && variant.dimension.trim() && variant.dimension.trim() !== '-') parts.push(variant.dimension.trim());
    const colour = variant.bodyColour || variant.colorSize;
    if (colour && colour.trim()) parts.push(colour.trim());
    if (variant.pricePerMtr) parts.push('per mtr');
    if (parts.length === 0) parts.push(variant.model || 'Variant');
    return parts.join(' · ');
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
    const pricingMap: Record<string, number> = {};

    this.pricingGroups.forEach(group => {
      group.rows.forEach(row => {
        pricingMap[row.key] = row.customPrice;
      });
    });

    const mult = this.discountPercent !== null ? (100 - this.discountPercent) / 100 : (this.currentDealer?.multiplier || 1.0);

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
