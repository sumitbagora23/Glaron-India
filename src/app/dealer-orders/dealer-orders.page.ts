import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { IonContent } from '@ionic/angular/standalone';
import { OrderService, Order } from '../admin/order.service';
import { DealerService, Dealer } from '../admin/dealer.service';
import { SettingsService } from '../admin/settings.service';
import { DealerAuthService } from '../dealer-auth.service';

@Component({
  selector: 'app-dealer-orders',
  templateUrl: './dealer-orders.page.html',
  styleUrls: ['./dealer-orders.page.scss'],
  standalone: true,
  imports: [
    CommonModule,
    IonContent
  ]
})
export class DealerOrdersPage implements OnInit {
  expandedOrderId: string | null = null;

  constructor(
    private router: Router,
    private orderService: OrderService,
    private dealerService: DealerService,
    private settingsService: SettingsService,
    private dealerAuth: DealerAuthService
  ) {}

  // ---- Direct call (number configured by admin in Settings) ----
  get callNumber(): string {
    return this.settingsService.callNumber;
  }

  makeCall() {
    const number = (this.callNumber || '').trim();
    if (!number) return;
    // Strip spaces/dashes/parens so the tel: URI dials cleanly.
    const clean = number.replace(/[^\d+]/g, '');
    window.location.href = `tel:${clean}`;
  }

  ngOnInit() {}

  get currentDealer(): Dealer | null {
    // Resolve strictly by the signed-in mobile number. Never fall back to
    // another dealer (e.g. dealers[0]) — that showed, and filtered orders by,
    // whichever dealer happened to be first in the synced list.
    const loggedMobile = this.dealerAuth.getSession();
    return loggedMobile ? (this.dealerService.findByMobile(loggedMobile) || null) : null;
  }

  get myOrders(): Order[] {
    const allOrders = this.orderService.orders;
    const dealerName = (this.currentDealer?.name || '').toLowerCase().trim();
    const dealerMobile = (this.currentDealer?.phone || this.dealerAuth.getSession() || '').trim();

    // Signed in but no identity we can match on → show no orders rather than
    // exposing every dealer's orders.
    if (!dealerName && !dealerMobile) return [];

    const filtered = allOrders.filter(o => {
      const oDealer = (o.dealer || '').toLowerCase().trim();
      if (!oDealer) return false;
      // Guard against empty match terms (an empty string matches everything).
      return (!!dealerName && oDealer.includes(dealerName)) ||
             (!!dealerMobile && oDealer.includes(dealerMobile)) ||
             (!!dealerName && dealerName.includes(oDealer));
    });

    // Newest orders first
    return [...filtered].sort((a, b) => {
      const ta = a.date ? new Date(a.date).getTime() : 0;
      const tb = b.date ? new Date(b.date).getTime() : 0;
      return tb - ta;
    });
  }

  toggleOrder(id: string) {
    this.expandedOrderId = this.expandedOrderId === id ? null : id;
  }

  isExpanded(id: string): boolean {
    return this.expandedOrderId === id;
  }

  getStageStep(stage: string): number {
    switch (stage) {
      case 'New':
      case 'Pending':
      case 'Order Received': return 1;
      case 'Confirmed':
      case 'Packed': return 2;
      case 'Dispatched': return 3;
      case 'Delivered': return 4;
      case 'Paid': return 5;
      default: return 1;
    }
  }

  goToCatalog() {
    this.router.navigate(['/dealer/catalog'], { queryParams: { tab: 'home' } });
  }

  goToProducts() {
    this.router.navigate(['/dealer/catalog'], { queryParams: { tab: 'products' } });
  }

  goToCheckout() {
    this.router.navigate(['/dealer/checkout']);
  }
}
