import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { IonContent } from '@ionic/angular/standalone';
import { ProductService, Product, ProductVariant } from '../product.service';
import { DealerService, Dealer } from '../dealer.service';
import { OrderService, Order, OrderItemLine } from '../order.service';
import { orderRefLabel } from '../order-ref';
import { SpecDetail, SpecTab, SpecTabState, specDetails, orderableLightColours, lightColourCatalogPrice, lightColourSwatch } from '../product-spec-tabs';

interface CartLine {
  productId: string;
  productName: string;
  variantIndex: number; // -1 = base price
  /** The shade this line is for, when the product is sold in several. */
  lightColour?: string;
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

  // The box of colour drawn before a light colour name. Worked out from the
  // name itself, so a shade added today is painted without a code change.
  swatch(colour: string): string {
    return lightColourSwatch(colour);
  }

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

  /** Date the order was placed — shown next to its reference in the subtitle. */
  get orderDate(): string {
    return this.existingOrder?.date || '';
  }

  /** Short order label, e.g. `ORD - 417` — the same number the dealer sees. */
  orderRef(id: string): string {
    return orderRefLabel(id);
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
  // ---- Wattage tabs ----
  // The same card the dealer app and the catalogue link show: the wattages as
  // tabs, and under the open one every light colour with its own price and its
  // own quantity. The cut-out, the body colour and the rest of the sheet sit
  // behind the ⓘ beside the tab name. A product with no wattage and no
  // dimension keeps the plain rows below.
  // with no wattage and no dimension keeps the plain rows below.
  private specTabState = new SpecTabState();
  trackBySpecTab = this.specTabState.trackByKey;
  trackByColour = (_: number, colour: string) => colour;

  specTabs(product: Product): SpecTab[] {
    return this.specTabState.tabs(product);
  }

  openSpecTab(product: Product): SpecTab | null {
    return this.specTabState.openTab(product);
  }

  isSpecTabOpen(product: Product, tab: SpecTab): boolean {
    return this.specTabState.isOpen(product, tab);
  }

  selectSpecTab(tab: SpecTab) {
    this.specTabState.toggle(tab);
  }

  /** The ⓘ sheet of the open option: dimension, cut-out and the rest. */
  specRows(tab: SpecTab): SpecDetail[] {
    return specDetails(tab.variant);
  }

  isSpecSheetOpen(product: Product): boolean {
    return this.specTabState.isSheetOpen(product);
  }

  toggleSpecSheet(product: Product) {
    this.specTabState.toggleSheet(product);
  }

  /** The light colours the admin picked for this product, if any. */
  productLightColours(product: Product, variant?: ProductVariant): string[] {
    return orderableLightColours(product, variant);
  }

  /** Everything on order for one wattage tab, across all of its shades. */
  tabTotalQty(product: Product, tab: SpecTab): number {
    const colours = this.productLightColours(product, tab.variant);
    if (!colours.length) return this.cartQtyFor(product, tab.index);
    return colours.reduce((sum, c) => sum + this.cartQtyFor(product, tab.index, c), 0);
  }

  // ---- product cards / cart ----
  variantLabel(v: ProductVariant): string {
    return [v.wattage, v.dimension].filter(Boolean).join(' · ') || 'Variant';
  }

  /** The option and the shade together — what the order line ends up reading. */
  private lineLabel(v: ProductVariant | undefined, lightColour?: string): string | undefined {
    const label = v ? this.variantLabel(v) : '';
    const full = lightColour ? (label ? label + ' · ' + lightColour : lightColour) : label;
    return full || undefined;
  }

  variantUnitPrice(product: Product, variantIndex: number, lightColour?: string): number {
    const variant = variantIndex >= 0 && product.variants ? product.variants[variantIndex] : undefined;
    let base = product.price || 0;
    if (variant) base = variant.price || variant.pricePerMtr || product.price || 0;
    // A shade priced on its own IS the price, not a surcharge on top of the
    // option's — the same rule the dealer card and the cart follow. An option
    // that prices the shade itself wins over the product's price for it.
    const own = lightColour ? lightColourCatalogPrice(product, lightColour, variant) : 0;
    return own > 0 ? own : base;
  }

  private findLine(product: Product, variantIndex: number, lightColour?: string): number {
    return this.cart.findIndex(l =>
      l.productId === product.id &&
      l.variantIndex === variantIndex &&
      (l.lightColour || '') === (lightColour || '')
    );
  }

  cartQtyFor(product: Product, variantIndex: number, lightColour?: string): number {
    const idx = this.findLine(product, variantIndex, lightColour);
    return idx > -1 ? this.cart[idx].quantity : 0;
  }

  inc(product: Product, variantIndex: number, lightColour?: string) {
    const idx = this.findLine(product, variantIndex, lightColour);
    if (idx > -1) {
      this.cart[idx].quantity += 1;
    } else {
      const v = variantIndex >= 0 && product.variants ? product.variants[variantIndex] : undefined;
      this.cart.push({
        productId: product.id,
        productName: product.name,
        variantIndex,
        lightColour,
        variantLabel: this.lineLabel(v, lightColour),
        unitPrice: this.variantUnitPrice(product, variantIndex, lightColour),
        quantity: 1
      });
    }
  }

  dec(product: Product, variantIndex: number, lightColour?: string) {
    const idx = this.findLine(product, variantIndex, lightColour);
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
        date: new Date().toISOString()
      });
    }

    this.router.navigate(['/admin/orders']);
  }

  cancel() {
    this.router.navigate(['/admin/orders']);
  }
}
