import { Component, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { IonContent } from '@ionic/angular/standalone';
import { OrderService } from '../admin/order.service';
import { DealerService, Dealer } from '../admin/dealer.service';
import { DealerI18nService } from '../dealer-i18n.service';
import { DealerAuthService } from '../dealer-auth.service';
import { ActivityLogService } from '../admin/activity-log.service';
import { orderRefLabel } from '../order-ref';
import { lightColourSwatch, splitLightColourLabel } from '../admin/light-colours';
import { LightColourService } from '../admin/light-colour.service';

export interface CheckoutCartItem {
  id: string;
  name: string;
  sku: string;
  image?: string;
  quantity: number;
  unitPrice: number;
  mrp: number;
  totalPrice: number;
  variantInfo?: string;
}

@Component({
  selector: 'app-dealer-checkout',
  templateUrl: './dealer-checkout.page.html',
  styleUrls: ['./dealer-checkout.page.scss'],
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    IonContent
  ]
})
export class DealerCheckoutPage implements OnInit {

  // The box of colour drawn before a light colour name. Worked out from the
  // name itself, so a shade added today is painted without a code change.
  swatch(colour: string): string {
    return lightColourSwatch(colour);
  }

  // A saved line keeps what was ordered as one string — "7W · 2ft · Cool
  // White". These two split the shade off its end so the box of colour sits
  // right before the shade, not in front of the wattage.
  private lightColourNames = inject(LightColourService);

  labelHead(label?: string): string {
    return splitLightColourLabel(label || '', this.lightColourNames.names).head;
  }

  labelColour(label?: string): string {
    return splitLightColourLabel(label || '', this.lightColourNames.names).colour;
  }

  // Editable delivery address
  deliveryAddress = '';

  // Delivery state / city / pincode (prefilled from the dealer profile; the
  // pincode stays editable at checkout).
  deliveryState = '';
  deliveryCity = '';
  deliveryPincode = '';

  // Cart items state
  cartItems: CheckoutCartItem[] = [];
  isSubmitting = false;
  orderSuccessId = '';
  orderSuccessDate = '';

  // Static checkout UI strings, translated the same way as the catalog page.
  private readonly translations: Record<string, { en: string; hi: string }> = {
    checkout: { en: 'Checkout', hi: 'चेकआउट' },
    orderConfirmed: { en: 'Order Confirmed', hi: 'ऑर्डर पुष्ट हुआ' },
    orderRefId: { en: 'Order reference ID:', hi: 'ऑर्डर संदर्भ आईडी:' },
    orderDate: { en: 'Order date:', hi: 'ऑर्डर दिनांक:' },
    backToHome: { en: 'Back to Home', hi: 'होम पर वापस जाएँ' },
    orderSummary: { en: 'Order Summary', hi: 'ऑर्डर सारांश' },
    emptyCart: { en: 'Your cart is empty.', hi: 'आपका कार्ट खाली है।' },
    browseCatalog: { en: 'Browse catalog', hi: 'कैटलॉग ब्राउज़ करें' },
    deliveryAddress: { en: 'Delivery Address', hi: 'डिलीवरी पता' },
    editDeliveryAddress: { en: 'TYPE / EDIT DELIVERY ADDRESS', hi: 'डिलीवरी पता लिखें / संपादित करें' },
    addressPlaceholder: { en: 'Enter full delivery address, landmark, city, state and pincode...', hi: 'पूरा डिलीवरी पता, लैंडमार्क, शहर, राज्य और पिनकोड दर्ज करें...' },
    address: { en: 'Address', hi: 'पता' },
    city: { en: 'City', hi: 'शहर' },
    state: { en: 'State', hi: 'राज्य' },
    pincode: { en: 'Pincode', hi: 'पिनकोड' },
    pincodePlaceholder: { en: '6-digit pincode', hi: '6-अंकीय पिनकोड' },
    profileTip: { en: 'Tip: set your City & State in your Profile so they appear here automatically.', hi: 'सुझाव: अपनी प्रोफ़ाइल में शहर और राज्य सेट करें ताकि वे यहाँ स्वतः दिखें।' },
    paymentSummary: { en: 'Payment Summary', hi: 'भुगतान सारांश' },
    subtotal: { en: 'Subtotal', hi: 'उप-योग' },
    items: { en: 'items', hi: 'आइटम' },
    totalAmount: { en: 'Total Amount', hi: 'कुल राशि' },
    createOrder: { en: 'CREATE ORDER', hi: 'ऑर्डर बनाएँ' },
    placingOrder: { en: 'Placing Order...', hi: 'ऑर्डर दिया जा रहा है...' },
    terms: { en: 'By creating this order, you agree to Glaron India B2B Terms.', hi: 'यह ऑर्डर बनाकर, आप ग्लैरोन इंडिया B2B शर्तों से सहमत होते हैं।' },
    removeItem: { en: 'Remove item', hi: 'आइटम हटाएँ' },
    emptyCartAlert: { en: 'Your cart is empty. Please add products to proceed.', hi: 'आपका कार्ट खाली है। कृपया आगे बढ़ने के लिए उत्पाद जोड़ें।' }
  };

  constructor(
    private router: Router,
    private orderService: OrderService,
    private dealerService: DealerService,
    public i18n: DealerI18nService,
    private dealerAuth: DealerAuthService,
    private activity: ActivityLogService
  ) {}

  get lang(): 'en' | 'hi' {
    return this.i18n.lang;
  }

  // Translate a static UI key to the selected language.
  t(key: string): string {
    const entry = this.translations[key];
    if (!entry) return key;
    return entry[this.lang] || entry.en;
  }

  // MEANING translation for descriptive text.
  td(text: string | null | undefined): string {
    return this.i18n.td(text);
  }

  // NAME transliteration for proper names (cart product titles).
  tn(text: string | null | undefined): string {
    return this.i18n.tn(text);
  }

  get currentDealer(): Dealer | null {
    // Resolve strictly by the signed-in mobile number. Never fall back to
    // another dealer (e.g. dealers[0]) — that placed the order under whichever
    // dealer happened to be first in the synced list, with their address on it.
    const loggedMobile = this.dealerAuth.getSession();
    return loggedMobile ? (this.dealerService.findByMobile(loggedMobile) || null) : null;
  }

  ngOnInit() {
    this.prefillDeliveryFromProfile();
    this.loadCartFromSession();
  }

  // Ionic reuses this page instance, so re-read the profile on every entry —
  // and re-run it once the dealer list arrives, since checkout can be opened
  // before the first Firestore sync has landed.
  ionViewWillEnter() {
    this.prefillDeliveryFromProfile();
  }

  // Copy the signed-in dealer's own address into the editable delivery fields.
  // Only fills blanks, so anything the dealer has already typed here survives a
  // late sync. There is deliberately no sample address: an unresolved profile
  // leaves the field empty for them to fill in.
  private prefillDeliveryFromProfile() {
    const dealer = this.currentDealer;
    if (!dealer) return;
    if (!this.deliveryAddress) this.deliveryAddress = dealer.address || '';
    if (!this.deliveryState) this.deliveryState = dealer.state || '';
    if (!this.deliveryCity) this.deliveryCity = dealer.city || '';
    if (!this.deliveryPincode) this.deliveryPincode = dealer.pincode || '';
  }

  // Human-readable one-line location (City, State - Pincode) for the order.
  get deliveryLocationLine(): string {
    const cityState = [this.deliveryCity, this.deliveryState].filter(Boolean).join(', ');
    return cityState + (this.deliveryPincode ? ' - ' + this.deliveryPincode : '');
  }

  // Comma-joined City, State, Pincode summary shown under the address (no labels).
  get deliverySummary(): string {
    return [this.deliveryCity, this.deliveryState, this.deliveryPincode].filter(Boolean).join(', ');
  }

  private loadCartFromSession() {
    try {
      const stored = sessionStorage.getItem('glaron_checkout_cart');
      if (stored) {
        this.cartItems = JSON.parse(stored);
      }
    } catch (e) {}
    // No fallback sample cart — an empty cart stays empty.
  }

  get totalQuantity(): number {
    return this.cartItems.reduce((sum, item) => sum + item.quantity, 0);
  }

  get subtotal(): number {
    return this.cartItems.reduce((sum, item) => sum + item.totalPrice, 0);
  }

  get grandTotal(): number {
    return this.subtotal;
  }

  incrementQty(index: number) {
    this.cartItems[index].quantity += 1;
    this.cartItems[index].totalPrice = this.cartItems[index].quantity * this.cartItems[index].unitPrice;
    this.saveCartSession();
  }

  decrementQty(index: number) {
    if (this.cartItems[index].quantity > 1) {
      this.cartItems[index].quantity -= 1;
      this.cartItems[index].totalPrice = this.cartItems[index].quantity * this.cartItems[index].unitPrice;
      this.saveCartSession();
    } else {
      this.removeItem(index);
    }
  }

  removeItem(index: number) {
    const removed = this.cartItems[index];
    this.cartItems.splice(index, 1);
    this.saveCartSession();
    if (removed) {
      this.activity.log('cart-remove', `Removed ${removed.name} at checkout`, {
        productId: removed.id,
        productName: removed.name,
        sku: removed.sku || removed.id,
        ...(removed.variantInfo ? { variant: removed.variantInfo } : {}),
        qty: removed.quantity
      });
    }
  }

  private saveCartSession() {
    try {
      sessionStorage.setItem('glaron_checkout_cart', JSON.stringify(this.cartItems));
    } catch (e) {}
  }

  confirmOrder() {
    if (this.cartItems.length === 0) {
      alert(this.t('emptyCartAlert'));
      return;
    }

    this.finishOrderPlacement();
  }

  finishOrderPlacement() {
    this.isSubmitting = true;
    // Timestamped id: two dealers checking out at once can't collide, so an
    // order can never overwrite another dealer's Firestore document.
    const orderId = 'ORD-' + Date.now().toString(36).toUpperCase() +
      '-' + Math.floor(1000 + Math.random() * 9000);
    // Whoever placed it. With no profile resolved yet, the signed-in mobile is
    // still an identity their own Orders tab can match on — a generic label
    // would leave the order invisible to them.
    const dealerName = this.currentDealer?.name || this.dealerAuth.getSession() || 'Dealer Order';
    // Compose a full delivery location: address line + City, State - Pincode.
    const addressLine = this.deliveryAddress || this.currentDealer?.address || '';
    const locLine = this.deliveryLocationLine;
    const location = [addressLine, locLine].filter(Boolean).join(', ');

    // Snapshot the line items so the order detail can show them later
    const orderLineItems = this.cartItems.map(it => ({
      name: it.name,
      variant: it.variantInfo || '',
      quantity: it.quantity,
      unitPrice: it.unitPrice,
      totalPrice: it.totalPrice
    }));

    // Kept for the success screen, which shows the date next to the reference.
    const orderDate = new Date().toISOString();

    // Add Order to Firestore & OrderService
    this.orderService.addOrder({
      id: orderId,
      dealer: dealerName,
      location: location,
      value: this.grandTotal,
      stage: 'Order Received',
      date: orderDate,
      itemsCount: this.totalQuantity,
      items: orderLineItems,
      state: this.deliveryState,
      city: this.deliveryCity,
      pincode: this.deliveryPincode,
      // Tags the order as dealer-placed, which is what makes the admin PWA
      // raise a "new order received" notification for it.
      source: 'dealer'
    });

    // Record it before the cart is emptied, so the entry can name what was in it.
    this.activity.log('order-placed', `Placed ${orderRefLabel(orderId)}`, {
      orderId,
      qty: this.totalQuantity,
      amount: this.grandTotal,
      // A readable summary of the basket, trimmed so a 30-line order doesn't
      // turn the console's activity row into a wall of text.
      detail: orderLineItems
        .slice(0, 6)
        .map(i => `${i.name}${i.variant ? ' (' + i.variant + ')' : ''} ×${i.quantity}`)
        .join(', ') + (orderLineItems.length > 6 ? ` +${orderLineItems.length - 6} more` : '')
    });

    // Clear Cart
    sessionStorage.removeItem('glaron_checkout_cart');
    this.cartItems = [];

    setTimeout(() => {
      this.isSubmitting = false;
      this.orderSuccessId = orderId;
      this.orderSuccessDate = orderDate;
    }, 600);
  }

  /** Short order label, e.g. `ORD - 417` — same number the admin console shows. */
  orderRef(id: string): string {
    return orderRefLabel(id);
  }

  goToCatalog() {
    this.router.navigate(['/dealer/catalog'], { queryParams: { tab: 'home' } });
  }
}
