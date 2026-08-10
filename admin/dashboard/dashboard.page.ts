import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { IonContent } from '@ionic/angular/standalone';
import { Router } from '@angular/router';
import { SearchService } from '../search.service';
import { ProductService, Product } from '../product.service';
import { DealerService } from '../dealer.service';
import { OrderService } from '../order.service';

@Component({
  selector: 'app-dashboard',
  templateUrl: './dashboard.page.html',
  styleUrls: ['./dashboard.page.scss'],
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    IonContent
  ]
})
export class DashboardPage implements OnInit {
  currentPage = 1;
  totalPages = 3;

  constructor(
    private router: Router,
    private searchService: SearchService,
    private productService: ProductService,
    private dealerService: DealerService,
    private orderService: OrderService
  ) {}

  ngOnInit() {}

  // Fetch stats dynamically on real-time data
  get stats() {
    const totalSKU = this.allProducts.length;
    const activeDealers = this.dealerService.dealers.length;
    
    // Count orders that are not 'Delivered'
    const pendingOrders = this.orderService.orders.filter(o => o.stage !== 'Delivered').length;
    
    // Sum values of active orders
    const totalRevenue = this.orderService.orders.reduce((sum, o) => sum + o.value, 0);
    const monthlyRevenue = totalRevenue >= 100000 
      ? `Rs. ${(totalRevenue / 100000).toFixed(2)}L` 
      : `Rs. ${totalRevenue.toLocaleString('en-IN')}`;

    return {
      totalSKU,
      totalSKUChange: totalSKU > 0 ? '+100%' : '0%',
      activeDealers,
      activeDealersChange: activeDealers > 0 ? `+${activeDealers}` : '0',
      pendingOrders,
      monthlyRevenue
    };
  }

  // Fetch products from the shared ProductService
  get allProducts(): Product[] {
    return this.productService.products;
  }

  // Filter products in real-time
  get filteredProducts(): Product[] {
    const searchVal = this.searchService.searchKeyword();
    if (!searchVal.trim()) {
      return this.allProducts;
    }
    const keyword = searchVal.toLowerCase().trim();
    return this.allProducts.filter(product => 
      product.name.toLowerCase().includes(keyword) || 
      product.id.toLowerCase().includes(keyword) ||
      product.category.toLowerCase().includes(keyword) ||
      product.status.toLowerCase().includes(keyword)
    );
  }

  // Button Actions
  addProduct() {
    this.router.navigate(['/admin/products/new']);
  }

  editProduct(product: Product) {
    this.router.navigate(['/admin/products/edit', product.id]);
  }

  setPage(page: number) {
    if (page >= 1 && page <= this.totalPages) {
      this.currentPage = page;
      console.log('Pagination Page changed to:', page);
    }
  }

  exportCSV() {
    alert('UX Microcopy: "Downloading Inventory Overview CSV sheet. Saving details to local device."');
  }
}
