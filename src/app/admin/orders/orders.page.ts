import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { IonContent } from '@ionic/angular/standalone';
import { SearchService } from '../search.service';
import { OrderService, Order, OrderStage, OrderItemLine, normalizeStage } from '../order.service';
import { ProductService, Product, ProductVariant } from '../product.service';
import { DealerService, Dealer } from '../dealer.service';
import { orderRefLabel } from '../../order-ref';

interface StageDef {
  key: OrderStage;
  label: string;
  dotClass: string;
}

// A line in the admin "create order" cart (card-based product picker)
interface CreateCartLine {
  productId: string;
  productName: string;
  variantIndex: number; // -1 = base price (no variant)
  variantLabel?: string;
  unitPrice: number;
  quantity: number;
}

@Component({
  selector: 'app-orders',
  templateUrl: './orders.page.html',
  styleUrls: ['./orders.page.scss'],
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    IonContent
  ]
})
export class OrdersPage implements OnInit {
  // Pipeline stages (data-driven)
  stages: StageDef[] = [
    { key: 'Order Received', label: 'ORDER RECEIVED', dotClass: 'dot-new' },
    { key: 'Confirmed', label: 'CONFIRMED', dotClass: 'dot-confirmed' },
    { key: 'Dispatched', label: 'DISPATCHED', dotClass: 'dot-dispatched' },
    { key: 'Delivered', label: 'DELIVERED', dotClass: 'dot-delivered' },
    { key: 'Paid', label: 'PAID', dotClass: 'dot-paid' }
  ];

  // Filters ('' = all)
  statusFilter: OrderStage | '' = '';
  dealerFilter = '';          // free-text dealer name search
  dateFilter = '';            // YYYY-MM-DD from a date input
  filtersOpen = false;        // single filter dropdown panel

  // Order detail popup (opened from three-dot menu)
  selectedOrder: Order | null = null;
  editItems: OrderItemLine[] = [];

  // Add-product form (shared by the detail popup and the create-order modal)
  newItemProductId = '';
  newItemVariantIndex = -1;
  newItemQty = 1;
  newItemPrice: number | null = null;

  // Create-order modal state
  showCreateOrder = false;
  createDealer = '';           // selected dealer name (only set on pick)
  createDealerSearch = '';     // text typed in the searchable dealer box
  createDealerOpen = false;    // dealer dropdown open state
  createSearch = '';           // product search
  createCart: CreateCartLine[] = [];

  constructor(
    private router: Router,
    private searchService: SearchService,
    private productService: ProductService,
    private dealerService: DealerService,
    private orderService: OrderService
  ) {}

  ngOnInit() {}

  get orders(): Order[] {
    return this.orderService.orders;
  }

  get stats() {
    const totalVal = this.orders.reduce((sum, o) => sum + (o.value || 0), 0);
    const pending = this.orders.filter(o => {
      const s = normalizeStage(o.stage);
      return s !== 'Delivered' && s !== 'Paid';
    }).length;
    const uniqueDealers = new Set(this.orders.map(o => o.dealer)).size;
    return {
      dailyRevenue: totalVal > 0 ? `₹${(totalVal / 100000).toFixed(2)}L` : '₹0.00L',
      pendingOrders: pending,
      activeDealers: uniqueDealers,
      fulfillmentRate: '100%'
    };
  }

  // Number of active filters (for the button badge)
  get activeFilterCount(): number {
    return (this.statusFilter ? 1 : 0) + (this.dealerFilter.trim() ? 1 : 0) + (this.dateFilter ? 1 : 0);
  }

  toggleFilters() { this.filtersOpen = !this.filtersOpen; }
  closeFilters() { this.filtersOpen = false; }

  // Local YYYY-MM-DD for an order's date (matches the date input's format)
  private orderDateStr(o: Order): string {
    if (!o.date) return '';
    const d = new Date(o.date);
    if (isNaN(d.getTime())) return '';
    const m = `${d.getMonth() + 1}`.padStart(2, '0');
    const day = `${d.getDate()}`.padStart(2, '0');
    return `${d.getFullYear()}-${m}-${day}`;
  }

  // Prevents Angular rebuilding every order row (and losing open dropdown/input
  // state) whenever a Firestore snapshot replaces the orders array.
  trackByOrderId(_index: number, order: Order): string {
    return order.id;
  }

  /** Short order label, e.g. `ORD - 417` — the same number the dealer sees. */
  orderRef(id: string): string {
    return orderRefLabel(id);
  }

  get filteredOrders(): Order[] {
    let list = this.orders;

    // Filter by selected status stage
    if (this.statusFilter) {
      list = list.filter(order => normalizeStage(order.stage) === this.statusFilter);
    }

    // Filter by dealer name (free-text, case-insensitive contains)
    if (this.dealerFilter.trim()) {
      const q = this.dealerFilter.toLowerCase().trim();
      list = list.filter(order => (order.dealer || '').toLowerCase().includes(q));
    }

    // Filter by date
    if (this.dateFilter) {
      list = list.filter(order => this.orderDateStr(order) === this.dateFilter);
    }

    // Filter by search keyword
    const searchVal = this.searchService.searchKeyword();
    if (searchVal.trim()) {
      const keyword = searchVal.toLowerCase().trim();
      list = list.filter(order =>
        order.id.toLowerCase().includes(keyword) ||
        order.dealer.toLowerCase().includes(keyword) ||
        order.location.toLowerCase().includes(keyword)
      );
    }

    // Newest orders first (top of the table)
    return [...list].sort((a, b) => this.orderTime(b) - this.orderTime(a));
  }

  clearFilters() {
    this.statusFilter = '';
    this.dealerFilter = '';
    this.dateFilter = '';
  }

  // Millisecond timestamp for an order (0 if missing/invalid) — used for sorting
  private orderTime(o: Order): number {
    const t = o.date ? new Date(o.date).getTime() : 0;
    return isNaN(t) ? 0 : t;
  }

  getOrdersByStage(stage: OrderStage): Order[] {
    return this.filteredOrders.filter(order => normalizeStage(order.stage) === stage);
  }

  stageOf(order: Order): OrderStage {
    return normalizeStage(order.stage);
  }

  isFinalStage(order: Order): boolean {
    return this.stageOf(order) === 'Paid';
  }

  // Advance an order to the next pipeline stage
  moveNext(order: Order) {
    const flow: OrderStage[] = ['Order Received', 'Confirmed', 'Dispatched', 'Delivered', 'Paid'];
    const cur = this.stageOf(order);
    const idx = flow.indexOf(cur);
    if (idx >= 0 && idx < flow.length - 1) {
      this.orderService.updateOrderStage(order.id, flow[idx + 1]);
    }
  }

  // Change an order's stage via the dropdown selector
  changeStage(order: Order, newStage: string) {
    const stage = newStage as OrderStage;
    if (stage && stage !== this.stageOf(order)) {
      this.orderService.updateOrderStage(order.id, stage);
    }
  }

  // dot colour class for a given stage (used in the list badge)
  dotClassFor(order: Order): string {
    const def = this.stages.find(s => s.key === this.stageOf(order));
    return def ? def.dotClass : 'dot-new';
  }

  // ---- Order detail popup (view / edit / delete items) ----
  openOrderDetail(order: Order, event?: Event) {
    if (event) event.stopPropagation();
    this.selectedOrder = order;
    // deep copy items so edits are not applied until saved
    this.editItems = (order.items || []).map(it => ({ ...it }));
    this.resetNewItem();
  }

  closeOrderDetail() {
    this.selectedOrder = null;
    this.editItems = [];
    this.resetNewItem();
  }

  incItem(i: number) {
    this.editItems[i].quantity += 1;
    this.recalcItem(i);
  }

  decItem(i: number) {
    if (this.editItems[i].quantity > 1) {
      this.editItems[i].quantity -= 1;
      this.recalcItem(i);
    }
  }

  private recalcItem(i: number) {
    const it = this.editItems[i];
    it.totalPrice = (it.unitPrice || 0) * it.quantity;
  }

  deleteItem(i: number) {
    this.editItems.splice(i, 1);
  }

  get editItemsTotal(): number {
    return this.editItems.reduce((s, it) => s + (it.totalPrice || (it.unitPrice || 0) * it.quantity), 0);
  }

  // ---- Add product to the order ----
  get productList(): Product[] {
    return this.productService.products;
  }

  get selectedNewProduct(): Product | undefined {
    return this.productList.find(p => p.id === this.newItemProductId);
  }

  get newProductVariants(): ProductVariant[] {
    return this.selectedNewProduct?.variants || [];
  }

  variantLabel(v: ProductVariant): string {
    return [v.model, v.wattage, v.type, v.dimension].filter(Boolean).join(' · ') || 'Variant';
  }

  onNewProductChange() {
    this.newItemVariantIndex = -1;
    this.newItemPrice = this.selectedNewProduct?.price || null;
  }

  onNewVariantChange() {
    const v = this.newItemVariantIndex >= 0 ? this.newProductVariants[this.newItemVariantIndex] : undefined;
    this.newItemPrice = (v ? (v.price || v.pricePerMtr) : this.selectedNewProduct?.price) || null;
  }

  private buildNewItem(): OrderItemLine | null {
    const p = this.selectedNewProduct;
    if (!p) return null;
    const qty = Math.max(1, Number(this.newItemQty) || 1);
    const unit = Math.max(0, Number(this.newItemPrice) || 0);
    const v = this.newItemVariantIndex >= 0 ? this.newProductVariants[this.newItemVariantIndex] : undefined;
    return {
      name: p.name,
      variant: v ? this.variantLabel(v) : undefined,
      quantity: qty,
      unitPrice: unit,
      totalPrice: unit * qty
    };
  }

  addNewItem() {
    const it = this.buildNewItem();
    if (!it) return;
    this.editItems.push(it);
    this.resetNewItem();
  }

  private resetNewItem() {
    this.newItemProductId = '';
    this.newItemVariantIndex = -1;
    this.newItemQty = 1;
    this.newItemPrice = null;
  }

  // ---- Create new order (admin, card-based product picker) ----
  get dealerOptions(): Dealer[] {
    return this.dealerService.dealers;
  }

  // Searchable dealer dropdown
  get filteredDealerOptions(): Dealer[] {
    const q = this.createDealerSearch.trim().toLowerCase();
    const list = this.dealerService.dealers;
    return q ? list.filter(d => d.name.toLowerCase().includes(q)) : list;
  }

  onDealerSearchChange() {
    this.createDealerOpen = true;
    // Selection is only valid once an option is actually picked
    if (this.createDealerSearch !== this.createDealer) this.createDealer = '';
  }

  selectCreateDealer(name: string) {
    this.createDealer = name;
    this.createDealerSearch = name;
    this.createDealerOpen = false;
  }

  get createProducts(): Product[] {
    const q = this.createSearch.trim().toLowerCase();
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

  get createCartTotal(): number {
    return this.createCart.reduce((s, l) => s + l.unitPrice * l.quantity, 0);
  }

  get createCartCount(): number {
    return this.createCart.reduce((s, l) => s + l.quantity, 0);
  }

  openCreateOrder() {
    this.showCreateOrder = true;
    this.createDealer = '';
    this.createDealerSearch = '';
    this.createDealerOpen = false;
    this.createSearch = '';
    this.createCart = [];
  }

  closeCreateOrder() {
    this.showCreateOrder = false;
    this.createDealerOpen = false;
    this.createCart = [];
  }

  // Delete an order straight from the list (removes it for admin + dealer via Firestore)
  deleteOrderFromList(order: Order, event?: Event) {
    if (event) event.stopPropagation();
    if (confirm(`Delete order #${order.id}? This removes it for the dealer too and cannot be undone.`)) {
      this.orderService.deleteOrder(order.id);
    }
  }

  // Unit price for a product's variant (or base price when variantIndex < 0)
  variantUnitPrice(product: Product, variantIndex: number): number {
    if (variantIndex >= 0 && product.variants && product.variants[variantIndex]) {
      const v = product.variants[variantIndex];
      return v.price || v.pricePerMtr || product.price || 0;
    }
    return product.price || 0;
  }

  cartQtyFor(product: Product, variantIndex: number): number {
    const line = this.createCart.find(l => l.productId === product.id && l.variantIndex === variantIndex);
    return line ? line.quantity : 0;
  }

  incCartItem(product: Product, variantIndex: number) {
    const line = this.createCart.find(l => l.productId === product.id && l.variantIndex === variantIndex);
    if (line) {
      line.quantity += 1;
    } else {
      const v = variantIndex >= 0 && product.variants ? product.variants[variantIndex] : undefined;
      this.createCart.push({
        productId: product.id,
        productName: product.name,
        variantIndex,
        variantLabel: v ? this.variantLabel(v) : undefined,
        unitPrice: this.variantUnitPrice(product, variantIndex),
        quantity: 1
      });
    }
  }

  decCartItem(product: Product, variantIndex: number) {
    const idx = this.createCart.findIndex(l => l.productId === product.id && l.variantIndex === variantIndex);
    if (idx < 0) return;
    if (this.createCart[idx].quantity > 1) this.createCart[idx].quantity -= 1;
    else this.createCart.splice(idx, 1);
  }

  createOrder() {
    if (!this.createDealer || this.createCart.length === 0) return;
    const dealer = this.dealerService.dealers.find(d => d.name === this.createDealer);
    const location = dealer?.address || dealer?.location || 'Warehouse';
    const items: OrderItemLine[] = this.createCart.map(l => ({
      name: l.productName,
      variant: l.variantLabel,
      quantity: l.quantity,
      unitPrice: l.unitPrice,
      totalPrice: l.unitPrice * l.quantity
    }));
    this.orderService.addOrder({
      dealer: this.createDealer,
      location,
      value: this.createCartTotal,
      itemsCount: this.createCartCount,
      items,
      stage: 'Order Received',
      date: new Date().toISOString(),
      source: 'admin'
    });
    this.closeCreateOrder();
  }

  saveOrderChanges() {
    if (!this.selectedOrder) return;
    // An order with no items is removed from the list entirely.
    if (this.editItems.length === 0) {
      this.orderService.deleteOrder(this.selectedOrder.id);
      this.closeOrderDetail();
      return;
    }
    this.orderService.updateOrder({
      ...this.selectedOrder,
      items: this.editItems.map(it => ({ ...it }))
    });
    this.closeOrderDetail();
  }

  deleteWholeOrder() {
    if (!this.selectedOrder) return;
    if (confirm(`Delete order #${this.selectedOrder.id}? This cannot be undone.`)) {
      this.orderService.deleteOrder(this.selectedOrder.id);
      this.closeOrderDetail();
    }
  }

  openFilters() {
    alert('Filter options: filter by region, dealer, or stage.');
  }

  // Hide a broken product image so a clean placeholder shows instead
  onImgError(event: any) {
    if (event?.target) event.target.style.display = 'none';
  }

  // Open the full-page create-order screen
  goToCreateOrder() {
    this.router.navigate(['/admin/orders/create']);
  }

  // Open the full-page add-products screen for the currently viewed order
  goToAddProducts() {
    if (!this.selectedOrder) return;
    const id = this.selectedOrder.id;
    this.closeOrderDetail();
    this.router.navigate(['/admin/orders/add', id]);
  }
}
