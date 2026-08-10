import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { IonContent } from '@ionic/angular/standalone';
import { ProductService } from '../product.service';
import { DealerService } from '../dealer.service';
import { OrderService, normalizeStage } from '../order.service';

@Component({
  selector: 'app-admin-home',
  templateUrl: './home.page.html',
  styleUrls: ['./home.page.scss'],
  standalone: true,
  imports: [CommonModule, IonContent]
})
export class AdminHomePage {
  constructor(
    private productService: ProductService,
    private dealerService: DealerService,
    private orderService: OrderService
  ) {}

  // Live overview stats, computed from the shared services.
  get stats() {
    const totalSKU = this.productService.products.length;
    const activeDealers = this.dealerService.dealers.length;

    // Pending = orders not yet Delivered/Paid
    const pendingOrders = this.orderService.orders.filter(o => {
      const s = normalizeStage(o.stage);
      return s !== 'Delivered' && s !== 'Paid';
    }).length;

    // Revenue counts ONLY orders whose status is 'Paid'
    const paidRevenue = this.orderService.orders
      .filter(o => normalizeStage(o.stage) === 'Paid')
      .reduce((sum, o) => sum + (o.value || 0), 0);
    const monthlyRevenue = paidRevenue >= 100000
      ? `Rs. ${(paidRevenue / 100000).toFixed(2)}L`
      : `Rs. ${paidRevenue.toLocaleString('en-IN')}`;

    return { totalSKU, activeDealers, pendingOrders, monthlyRevenue };
  }
}
