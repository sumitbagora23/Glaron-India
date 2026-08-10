import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { IonContent } from '@ionic/angular/standalone';
import { ProductService, Product, ProductVariant } from '../product.service';
import { DealerService, Dealer } from '../dealer.service';
import { OrderService, Order, OrderItemLine } from '../order.service';

interface CartLine {
  productId: string;
  productName: string;
  variantIndex: number; // -1 = base price
  variantLabel?: string;
  unitPrice: number;
  quantity: number;
}

@Component({
  selector: 'app-order-compose',
  templateUrl: './order-compose.page.html',
  styleUrls: ['./order-compose.page.scss'],
  standalone: true,
  imports: [CommonModule, FormsModule, IonContent]
})
export class OrderComposePage implements OnInit {
  mode: 'create' | 'add' = 'create';
  orderId = '';

  // create-mode dealer selection
  dealer = '';
  dealerSearch = '';
  dealerOpen = false;

  productSearch = '';
  cart: CartLine[] = [];

  constructor(
    private route: ActivatedRoute,
    private router: Router,
    private productService: ProductService,
    private dealerService: DealerService,
    private orderService: OrderService
  ) {}

  ngOnInit() {
    this.orderId = this.route.snapshot.paramMap.get('id') || '';
    if (this.orderId) {
      this.mode = 'add';
      this.dealer = this.existingOrder?.dealer || '';
    }
  }

  // trackBy avoids rebuilding every product card (and re-downloading its image)
  // when the products list is recomputed by the search getter or replaced by a
  // Firestore sync.
  trackByProductId(_index: number, product: Product): string {
    return product.id;
  }

  trackByVariantIndex(index: number): number {
    return index;
  }

  // ---- data ----
  get existingOrder(): Order | undefined {
    return this.orderId ? this.orderService.orders.find(o => o.id === this.orderId) : undefined;
  }

  get dealerName(): string {
    return this.mode === 'add' ? (this.existingOrder?.dealer || '') : this.dealer;
  }

  get dealerOptions(): Dealer[] {
    const q = this.dealerSearch.trim().toLowerCase();
    const list = this.dealerService.dealers;
    return q ? list.filter(d => d.name.toLowerCase().includes(q)) : list;
  }

  get products(): Product[] {
    const q = this.productSearch.trim().toLowerCase();
    let list = this.productService.products;
    if (q) {
      list = list.filter(p =>
        p.name.toLowerCase().includes(q) ||
        p.id.toLowerCase().includes(q) ||
        (p.category || '').toLowerCase().includes(q)
      );
    }
    return list;
  }

  get cartTotal(): number {
    return this.cart.reduce((s, l) => s + l.unitPrice * l.quantity, 0);
  }

  get cartCount(): number {
    return this.cart.reduce((s, l) => s + l.quantity, 0);
  }

  // ---- dealer combobox ----
  onDealerSearchChange() {
    this.dealerOpen = true;
    if (this.dealerSearch !== this.dealer) this.dealer = '';
  }
  selectDealer(name: string) {
    this.dealer = name;
    this.dealerSearch = name;
    this.dealerOpen = false;
  }

  // ---- product cards / cart ----
  variantLabel(v: ProductVariant): string {
    return [v.model, v.wattage, v.type, v.dimension].filter(Boolean).join(' · ') || 'Variant';
  }

  variantUnitPrice(product: Product, variantIndex: number): number {
    if (variantIndex >= 0 && product.variants && product.variants[variantIndex]) {
      const v = product.variants[variantIndex];
      return v.price || v.pricePerMtr || product.price || 0;
    }
    return product.price || 0;
  }

  cartQtyFor(product: Product, variantIndex: number): number {
    const line = this.cart.find(l => l.productId === product.id && l.variantIndex === variantIndex);
    return line ? line.quantity : 0;
  }

  inc(product: Product, variantIndex: number) {
    const line = this.cart.find(l => l.productId === product.id && l.variantIndex === variantIndex);
    if (line) {
      line.quantity += 1;
    } else {
      const v = variantIndex >= 0 && product.variants ? product.variants[variantIndex] : undefined;
      this.cart.push({
        productId: product.id,
        productName: product.name,
        variantIndex,
        variantLabel: v ? this.variantLabel(v) : undefined,
        unitPrice: this.variantUnitPrice(product, variantIndex),
        quantity: 1
      });
    }
  }

  dec(product: Product, variantIndex: number) {
    const idx = this.cart.findIndex(l => l.productId === product.id && l.variantIndex === variantIndex);
    if (idx < 0) return;
    if (this.cart[idx].quantity > 1) this.cart[idx].quantity -= 1;
    else this.cart.splice(idx, 1);
  }

  onImgError(event: any) {
    if (event?.target) event.target.style.display = 'none';
  }

  private cartToItems(): OrderItemLine[] {
    return this.cart.map(l => ({
      name: l.productName,
      variant: l.variantLabel,
      quantity: l.quantity,
      unitPrice: l.unitPrice,
      totalPrice: l.unitPrice * l.quantity
    }));
  }

  get canSubmit(): boolean {
    if (this.cart.length === 0) return false;
    return this.mode === 'add' ? !!this.existingOrder : !!this.dealer;
  }

  submit() {
    if (!this.canSubmit) return;

    if (this.mode === 'add') {
      const order = this.existingOrder;
      if (!order) return;
      const merged = [...(order.items || []), ...this.cartToItems()];
      this.orderService.updateOrder({ ...order, items: merged });
    } else {
      const dealer = this.dealerService.dealers.find(d => d.name === this.dealer);
      const location = dealer?.address || dealer?.location || 'Warehouse';
      this.orderService.addOrder({
        dealer: this.dealer,
        location,
        value: this.cartTotal,
        itemsCount: this.cartCount,
        items: this.cartToItems(),
        stage: 'Order Received',
        date: new Date().toISOString(),
        source: 'admin'
      });
    }

    this.router.navigate(['/admin/orders']);
  }

  cancel() {
    this.router.navigate(['/admin/orders']);
  }
}
