import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { IonContent } from '@ionic/angular/standalone';
import { ProductService } from '../product.service';

interface DealerProductPricing {
  productId: string;
  name: string;
  catalogPrice: number;
  customPrice: number;
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
  dealerName = '';
  dealerLocation = '';
  dealerStatus = '';
  dealerPhone = '';

  pricingList: DealerProductPricing[] = [];
  discountPercent: number | null = null;
  isLoading = false;

  private dealersMock = [
    { name: 'Apex Lighting Solutions', location: 'Mumbai, MH', status: 'Active', phone: '+91 98200 12345' },
    { name: 'Bright Solutions Ltd.', location: 'Bangalore, KA', status: 'Active', phone: '+91 80234 56789' },
    { name: 'Lumina Industrial', location: 'New Delhi, DL', status: 'Pending Approval', phone: '+91 11256 78901' },
    { name: 'Crest Electricals', location: 'Pune, MH', status: 'Active', phone: '+91 20267 89012' }
  ];

  constructor(
    private route: ActivatedRoute,
    private router: Router,
    private productService: ProductService
  ) {}

  ngOnInit() {
    this.route.paramMap.subscribe(params => {
      const id = params.get('id');
      if (id) {
        this.dealerName = id;
        this.loadDealerDetails();
        this.loadPricingData();
      }
    });
  }

  loadDealerDetails() {
    const matched = this.dealersMock.find(d => d.name === this.dealerName);
    if (matched) {
      this.dealerLocation = matched.location;
      this.dealerStatus = matched.status;
      this.dealerPhone = matched.phone;
    } else {
      this.dealerLocation = 'General HQ';
      this.dealerStatus = 'Active';
      this.dealerPhone = 'N/A';
    }
  }

  loadPricingData() {
    const products = this.productService.products;
    const storageKey = `dealer_prices_${this.dealerName}`;
    let savedPrices: Record<string, number> = {};

    try {
      const stored = localStorage.getItem(storageKey);
      if (stored) {
        savedPrices = JSON.parse(stored);
      }
    } catch (e) {
      console.error('Error loading custom pricing from localStorage', e);
    }

    this.pricingList = products.map(product => {
      const customPrice = savedPrices[product.id] !== undefined ? savedPrices[product.id] : product.price;
      return {
        productId: product.id,
        name: product.name,
        catalogPrice: product.price,
        customPrice: customPrice
      };
    });
  }

  applyDiscount() {
    if (this.discountPercent === null || this.discountPercent < 0 || this.discountPercent > 100) {
      alert('Please enter a valid discount percentage between 0 and 100.');
      return;
    }

    const factor = (100 - this.discountPercent) / 100;
    this.pricingList = this.pricingList.map(item => ({
      ...item,
      customPrice: Math.round(item.catalogPrice * factor)
    }));
    console.log(`Applied ${this.discountPercent}% discount to all catalog prices.`);
  }

  savePricing() {
    this.isLoading = true;
    const storageKey = `dealer_prices_${this.dealerName}`;
    const pricingMap: Record<string, number> = {};

    this.pricingList.forEach(item => {
      pricingMap[item.productId] = item.customPrice;
    });

    try {
      localStorage.setItem(storageKey, JSON.stringify(pricingMap));
      console.log(`Saved custom prices for ${this.dealerName}`);
    } catch (e) {
      console.error('Error saving custom pricing to localStorage', e);
    }

    setTimeout(() => {
      this.isLoading = false;
      this.router.navigate(['/admin/dealers']);
    }, 1000);
  }

  discard() {
    this.router.navigate(['/admin/dealers']);
  }
}
