import { Component, OnInit, OnDestroy, ViewChild, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { IonContent } from '@ionic/angular/standalone';
import { ActivatedRoute } from '@angular/router';
import { Title } from '@angular/platform-browser';
import { SwUpdate } from '@angular/service-worker';
import { ProductService, Product, ProductVariant } from '../admin/product.service';
import { CategoryService, Category } from '../admin/category.service';
import { QuotationService, QuotationItem } from '../admin/quotation.service';
import { CatalogShareService } from '../catalog-share.service';

/** One line a visitor has put on their list. */
export interface PublicCartItem {
  /** Product + variant identity, so the same variant increments instead of repeating. */
  key: string;
  productId: string;
  name: string;
  image?: string;
  /** Variant descriptor, blank for a product that has none. */
  variant: string;
  quantity: number;
}

/**
 * Public catalogue — the page a shared "Share Catalogue" link opens.
 *
 * It is deliberately outside every guard (no install wall, no sign-in), because
 * the whole point is that a customer can open it in a plain browser tab.
 *
 * The one thing this page never shows is money. A visitor here is not a dealer
 * and has no rate: they browse the range, put what they want on a list, and ask
 * for a quotation. So there is a cart, but no price beside a product, no line
 * total, no basket total, and nothing anywhere that adds up. The list they send
 * carries what they picked and how many — the price comes back from Glaron
 * afterwards, off this page entirely.
 *
 * The :ref segment makes each shared link unique to the account that shared it.
 * It is only ever carried along (so a link can be told apart later); the page
 * itself renders the same catalogue whatever the code is, and never resolves it
 * back to a person.
 *
 * Unlike the installed app, this page keeps itself up to date on its own. The
 * app must never update behind a dealer's back — that rule is about somebody's
 * working tool changing under them mid-job. Nobody works in here: a link that
 * has been sitting in a chat thread for a month must open on whatever the
 * catalogue is today, and there is no one to ask to tap "check for update".
 */
@Component({
  selector: 'app-public-catalog',
  templateUrl: './public-catalog.page.html',
  styleUrls: ['./public-catalog.page.scss'],
  standalone: true,
  imports: [CommonModule, FormsModule, IonContent]
})
export class PublicCatalogPage implements OnInit, OnDestroy {
  @ViewChild(IonContent) private content?: IonContent;

  private swUpdate = inject(SwUpdate);

  // Four destinations: browse by category, the whole range, the list you have
  // built and want priced, or a quotation you already hold and want bettered.
  activeTab: 'home' | 'products' | 'cart' | 'compare' = 'home';
  // Set while a single category is being viewed from the Home tab.
  homeCategory: string | null = null;

  searchQuery = '';
  selectedCategory = 'All Categories';

  // Image lightbox
  selectedModalImage: string | null = null;
  selectedModalImageTitle = '';

  // Description of the card that has been tapped open (only one at a time).
  expandedDescId: string | null = null;

  /** The code from the link. Kept so the visit can be attributed to a link. */
  ref = '';

  // ---- Compare Quotation tab ----
  /** The uploaded quote, as a JPEG data URL. */
  quoteImage: string | null = null;
  quoteName = '';
  quoteMobile = '';
  quoteError = '';
  quoteReading = false;
  quoteSending = false;
  quoteSent = false;

  // ---- Quotation list (the cart) ----
  /** What the visitor has picked. Quantities only — never a price. */
  cart: PublicCartItem[] = [];
  /** Set once the "Request Quotation" button reveals the callback details. */
  askDetails = false;
  reqName = '';
  reqMobile = '';
  reqError = '';
  reqSending = false;
  reqSent = false;
  /** Short flash under the top bar when something is added, so a tap has a reply. */
  addedFlash = '';
  private addedFlashTimer: any = null;

  /** Survives a reload, so a half-built list is not lost by closing the tab. */
  private readonly CART_KEY = 'glaron_catalogue_quote_list';

  // ---- Keeping the link current ----
  /** A newer build is downloaded and waiting for a safe moment to be applied. */
  private updateReady = false;
  private updateTimer: any = null;
  private onVisible: (() => void) | null = null;

  constructor(
    private productService: ProductService,
    private categoryService: CategoryService,
    private quotationService: QuotationService,
    private catalogShare: CatalogShareService,
    private route: ActivatedRoute,
    private title: Title
  ) {}

  /**
   * Whether this link may ask Glaron for a price.
   *
   * Only links shared from the admin console can. A dealer or agent sharing the
   * catalogue is handing it to their own customer, and that customer asking
   * Glaron directly for a quotation would cut the dealer out of their own sale.
   * On their links there is no list, no request form and no compare tab — just
   * the catalogue, which is all they meant to send.
   */
  get quotationsAllowed(): boolean {
    return this.catalogShare.isOfficeRef(this.ref);
  }

  ngOnInit() {
    this.ref = this.route.snapshot.paramMap.get('ref') || '';
    // The link is shared as "Glaron India Catalogue"; the page it opens says so
    // too, in the browser tab and in whatever preview a chat app renders.
    this.title.setTitle('Glaron India Catalogue');
    // A list saved on an office link must not reappear on a dealer's, where
    // there is nowhere to send it and nothing to show it in.
    if (this.quotationsAllowed) this.loadCart();
    this.startAutoUpdate();
  }

  ngOnDestroy() {
    if (this.updateTimer) clearInterval(this.updateTimer);
    if (this.addedFlashTimer) clearTimeout(this.addedFlashTimer);
    if (this.onVisible) document.removeEventListener('visibilitychange', this.onVisible);
  }

  // ---- Keeping the link current ----

  /**
   * Pull a newer build whenever one has been deployed.
   *
   * The service worker serves this page from cache, so without this a customer
   * who opened the link last week would keep getting last week's catalogue —
   * new products, new sections, fixes and all missing — with nothing on screen
   * to tell them so and no one to tap "check for update".
   *
   * Three moments are worth looking: when the page opens, when a backgrounded
   * tab comes forward, and periodically for a tab left open all day.
   */
  private startAutoUpdate() {
    if (!this.swUpdate.isEnabled) return;

    this.swUpdate.versionUpdates.subscribe(event => {
      if (event.type !== 'VERSION_READY') return;
      // If this tab has already reloaded itself into this exact build, taking
      // it again would reload forever. One reload per version, ever.
      if (this.alreadyReloadedInto(event.latestVersion.hash)) return;
      this.pendingHash = event.latestVersion.hash;
      this.updateReady = true;
      this.applyUpdateWhenSafe();
    });

    this.checkForUpdate();

    this.onVisible = () => {
      if (document.visibilityState !== 'visible') return;
      // A version that downloaded while the tab was in the background is still
      // waiting; a returning visitor is also the moment to look for a new one.
      this.applyUpdateWhenSafe();
      this.checkForUpdate();
    };
    document.addEventListener('visibilitychange', this.onVisible);

    this.updateTimer = setInterval(() => this.checkForUpdate(), 15 * 60_000);
  }

  private checkForUpdate() {
    this.swUpdate.checkForUpdate().catch(e =>
      console.warn('Catalogue update check notice:', (e as any)?.message || e)
    );
  }

  /**
   * Swap in the new version — but never out from under someone.
   *
   * A reload here costs nothing while browsing (the list is in local storage
   * and the same URL comes back), but it would wipe a half-typed name or
   * interrupt a request being sent. In that case the new version simply waits;
   * the next safe moment applies it.
   */
  private applyUpdateWhenSafe() {
    if (!this.updateReady) return;
    if (this.askDetails || this.reqSending || this.quoteSending || this.quoteReading) return;
    // An uploaded quotation only lives in the page — a reload would lose the
    // file they picked and they would have to find it again.
    if (this.quoteImage) return;

    this.updateReady = false;
    this.rememberReload(this.pendingHash);
    this.swUpdate.activateUpdate()
      .then(() => document.location.reload())
      .catch(e => console.warn('Catalogue update notice:', (e as any)?.message || e));
  }

  /** The build this tab is about to reload into. */
  private pendingHash = '';
  private readonly RELOAD_KEY = 'glaron_catalogue_reloaded_into';

  private alreadyReloadedInto(hash: string): boolean {
    try {
      return !!hash && sessionStorage.getItem(this.RELOAD_KEY) === hash;
    } catch (e) {
      return false;
    }
  }

  private rememberReload(hash: string) {
    try {
      if (hash) sessionStorage.setItem(this.RELOAD_KEY, hash);
    } catch (e) {}
  }

  // ---- Data ----

  get products(): Product[] {
    return this.productService.products;
  }

  get categoryCards(): Category[] {
    return this.categoryService.categories;
  }

  get categories(): string[] {
    return ['All Categories', ...this.categoryService.categories.map(c => c.name)];
  }

  // A product can sit in several categories; the legacy field is a joined string.
  private productCategories(p: Product): string[] {
    if (p.categories && p.categories.length) return p.categories.map(c => c.trim()).filter(Boolean);
    return (p.category || '').split(',').map(c => c.trim()).filter(Boolean);
  }

  get filteredProducts(): Product[] {
    let list = this.products;
    if (this.selectedCategory !== 'All Categories') {
      const target = this.selectedCategory.toLowerCase();
      list = list.filter(p => p.category.toLowerCase().includes(target));
    }
    const q = this.searchQuery.trim().toLowerCase();
    if (q) {
      list = list.filter(p =>
        p.name.toLowerCase().includes(q) ||
        p.id.toLowerCase().includes(q) ||
        p.category.toLowerCase().includes(q)
      );
    }
    return list;
  }

  get displayedProducts(): Product[] {
    if (this.activeTab === 'home' && this.homeCategory) {
      const target = this.homeCategory.trim().toLowerCase();
      return this.products.filter(p =>
        this.productCategories(p).some(c => c.toLowerCase() === target)
      );
    }
    return this.filteredProducts;
  }

  // ---- Navigation ----

  get tabIndex(): number {
    if (this.activeTab === 'products') return 1;
    if (this.activeTab === 'cart') return 2;
    if (this.activeTab === 'compare') return 3;
    return 0;
  }

  /** Two destinations on a dealer's link, four on the office's. */
  get tabCount(): number {
    return this.quotationsAllowed ? 4 : 2;
  }

  // Only the category browser wears the brand bar; every other view gets the
  // plain back + title bar, same as the panels.
  get isHomeBar(): boolean {
    return this.activeTab === 'home' && !this.homeCategory;
  }

  get topBarTitle(): string {
    if (this.activeTab === 'compare') return 'Compare Quotation';
    if (this.activeTab === 'cart') return 'Your Quotation List';
    if (this.activeTab === 'home' && this.homeCategory) return this.homeCategory;
    return 'All Products';
  }

  showHome() {
    this.activeTab = 'home';
    this.homeCategory = null;
    this.scrollTop();
  }

  showProducts() {
    this.activeTab = 'products';
    this.homeCategory = null;
    this.scrollTop();
  }

  showCart() {
    if (!this.quotationsAllowed) return;
    this.activeTab = 'cart';
    this.homeCategory = null;
    this.scrollTop();
  }

  showCompare() {
    if (!this.quotationsAllowed) return;
    this.activeTab = 'compare';
    this.homeCategory = null;
    this.scrollTop();
  }

  openCategory(name: string) {
    this.homeCategory = name;
    this.scrollTop();
  }

  topBarBack() {
    if (this.homeCategory) {
      this.homeCategory = null;
    } else {
      this.activeTab = 'home';
    }
    this.scrollTop();
  }

  private scrollTop() {
    this.content?.scrollToTop(0);
  }

  clearSearch() {
    this.searchQuery = '';
  }

  // ---- Cards ----

  onImgError(event: any) {
    if (event?.target) event.target.style.display = 'none';
  }

  trackByCategoryId(_index: number, category: Category): string {
    return category.id;
  }

  trackByProductId(_index: number, product: Product): string {
    return product.id;
  }

  trackByVariantIndex(index: number): number {
    return index;
  }

  // Same label the panels build: whatever descriptors the variant carries,
  // minus anything to do with price.
  getVariantLabel(variant: ProductVariant): string {
    const parts: string[] = [];
    const isBad = (v?: string) => !v || !v.trim() || /dimension/i.test(v);

    if (!isBad(variant.wattage)) parts.push(variant.wattage!.trim());
    if (variant.type && variant.type.trim()) parts.push(variant.type.trim());

    if (variant.dimension && variant.dimension.trim() && variant.dimension.trim() !== '-') {
      const d = variant.dimension.trim();
      parts.push(/mm/i.test(d) ? d : `${d} mm`);
    }

    const colour = variant.bodyColour || variant.colorSize;
    if (colour && colour.trim()) parts.push(colour.trim());

    if (parts.length === 0) parts.push(variant.model || 'Variant');
    return parts.join(' · ');
  }

  productDescription(product: Product): string {
    return product.description || 'High-performance lighting solution designed for modern spaces.';
  }

  toggleDesc(product: Product) {
    this.expandedDescId = this.expandedDescId === product.id ? null : product.id;
  }

  openImageModal(imgUrl: string | undefined, name: string) {
    if (imgUrl) {
      this.selectedModalImage = imgUrl;
      this.selectedModalImageTitle = name;
    }
  }

  closeImageModal() {
    this.selectedModalImage = null;
    this.selectedModalImageTitle = '';
  }

  // ---- Quotation list ----

  /** Total pieces on the list — what the tab badge counts. */
  get cartCount(): number {
    return this.cart.reduce((sum, item) => sum + item.quantity, 0);
  }

  private cartKey(product: Product, variant?: ProductVariant): string {
    return product.id + '::' + (variant ? this.getVariantLabel(variant) : '');
  }

  /** How many of this exact line are already on the list (0 if none). */
  qtyInCart(product: Product, variant?: ProductVariant): number {
    const key = this.cartKey(product, variant);
    return this.cart.find(item => item.key === key)?.quantity || 0;
  }

  /** Put one more of this line on the list, or start it at one. */
  addToCart(product: Product, variant?: ProductVariant) {
    if (!this.quotationsAllowed) return;
    const key = this.cartKey(product, variant);
    const existing = this.cart.find(item => item.key === key);
    if (existing) {
      existing.quantity += 1;
    } else {
      this.cart.push({
        key,
        productId: product.id,
        name: product.name,
        image: product.image,
        variant: variant ? this.getVariantLabel(variant) : '',
        quantity: 1
      });
    }
    this.saveCart();
    this.flashAdded(product.name);
  }

  /** Step a line down, dropping it off the list at zero. */
  removeOneFromCart(product: Product, variant?: ProductVariant) {
    const index = this.cart.findIndex(item => item.key === this.cartKey(product, variant));
    if (index === -1) return;
    if (this.cart[index].quantity > 1) {
      this.cart[index].quantity -= 1;
    } else {
      this.cart.splice(index, 1);
    }
    this.saveCart();
  }

  incrementLine(index: number) {
    this.cart[index].quantity += 1;
    this.saveCart();
  }

  decrementLine(index: number) {
    if (this.cart[index].quantity > 1) {
      this.cart[index].quantity -= 1;
    } else {
      this.cart.splice(index, 1);
    }
    this.saveCart();
  }

  removeLine(index: number) {
    this.cart.splice(index, 1);
    this.saveCart();
  }

  trackByCartKey(_index: number, item: PublicCartItem): string {
    return item.key;
  }

  /** A brief "added" line, so tapping + on a long page visibly does something. */
  private flashAdded(name: string) {
    this.addedFlash = `${name} added to your list`;
    if (this.addedFlashTimer) clearTimeout(this.addedFlashTimer);
    this.addedFlashTimer = setTimeout(() => (this.addedFlash = ''), 1800);
  }

  private saveCart() {
    try {
      localStorage.setItem(this.CART_KEY, JSON.stringify(this.cart));
    } catch (e) {}
  }

  private loadCart() {
    try {
      const stored = localStorage.getItem(this.CART_KEY);
      if (!stored) return;
      const parsed = JSON.parse(stored);
      if (Array.isArray(parsed)) {
        this.cart = parsed.filter(item => item && item.key && item.quantity > 0);
      }
    } catch (e) {}
  }

  // ---- Requesting a quotation for that list ----

  /** The bottom button: reveal the two fields needed to call the visitor back. */
  openQuoteRequest() {
    this.askDetails = true;
    this.reqError = '';
  }

  async submitQuoteRequest() {
    if (this.reqSending) return;
    this.reqError = '';

    if (!this.cart.length) {
      this.reqError = 'Your list is empty — add a few products first.';
      return;
    }
    if (this.reqName.trim().length < 2) {
      this.reqError = 'Please enter your name.';
      return;
    }
    const mobile = this.normalizeMobile(this.reqMobile);
    if (mobile.length !== 10) {
      this.reqError = 'Please enter a valid 10-digit mobile number.';
      return;
    }

    const items: QuotationItem[] = this.cart.map(item => ({
      name: item.name,
      quantity: item.quantity,
      ...(item.variant ? { variant: item.variant } : {}),
      ...(item.productId ? { sku: item.productId } : {}),
      // The service drops anything that is the picture rather than a path to it.
      ...(item.image ? { image: item.image } : {})
    }));

    this.reqSending = true;
    try {
      await this.quotationService.submitRequest(this.reqName.trim(), mobile, items, this.ref);
      this.reqSent = true;
      // The list has been sent, so it is no longer theirs to edit — clearing it
      // is also what stops a second tap sending the same request twice.
      this.cart = [];
      this.saveCart();
      this.askDetails = false;
      this.scrollTop();
    } catch (e) {
      console.warn('Quotation request notice:', (e as any)?.message || e);
      this.reqError = 'Could not send that just now. Please try again.';
    }
    this.reqSending = false;
  }

  /** Back to browsing, with the sent state cleared so a new list can be built. */
  startNewList() {
    this.reqSent = false;
    this.reqName = '';
    this.reqMobile = '';
    this.reqError = '';
    this.showHome();
    // Leaving the confirmation is the first safe moment to take a version that
    // arrived while they were filling the form in.
    this.applyUpdateWhenSafe();
  }

  // ---- Compare Quotation ----

  /**
   * Read the picked quotation and downscale it to a data URL.
   *
   * A quotation is a page of small print, so it keeps far more resolution than a
   * banner would — but it still has to fit inside a single Firestore document
   * (there is no Storage bucket in this project), hence the step down through
   * lower JPEG qualities until it does.
   */
  onQuoteSelected(event: Event) {
    const input = event.target as HTMLInputElement;
    const file = input.files && input.files[0];
    input.value = '';
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      this.quoteError = 'Please choose a photo or screenshot of the quotation.';
      return;
    }
    this.quoteError = '';
    this.quoteReading = true;

    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        // Generous bounds: text has to stay readable when the admin opens it.
        const maxSide = 1600;
        let width = img.width, height = img.height;
        if (width > maxSide || height > maxSide) {
          const scale = Math.min(maxSide / width, maxSide / height);
          width = Math.round(width * scale);
          height = Math.round(height * scale);
        }
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        if (ctx) {
          // JPEG has no alpha channel: a transparent PNG would encode as black.
          ctx.fillStyle = '#ffffff';
          ctx.fillRect(0, 0, width, height);
          ctx.drawImage(img, 0, 0, width, height);
        }

        // A Firestore document caps out at 1 MB, so leave clear headroom.
        const budget = 700_000;
        let dataUrl = '';
        for (const quality of [0.82, 0.72, 0.62, 0.5, 0.4]) {
          dataUrl = canvas.toDataURL('image/jpeg', quality);
          if (dataUrl.length <= budget) break;
        }
        this.quoteReading = false;
        if (dataUrl.length > budget) {
          this.quoteError = 'That file is too large. Please send a smaller photo.';
          return;
        }
        this.quoteImage = dataUrl;
      };
      img.onerror = () => {
        this.quoteReading = false;
        this.quoteError = 'That file could not be read. Please try another one.';
      };
      img.src = reader.result as string;
    };
    reader.onerror = () => {
      this.quoteReading = false;
      this.quoteError = 'That file could not be read. Please try another one.';
    };
    reader.readAsDataURL(file);
  }

  removeQuoteImage() {
    this.quoteImage = null;
    this.quoteError = '';
  }

  // Indian mobile numbers, however they were typed (spaces, +91, leading 0).
  private normalizeMobile(input: string): string {
    const digits = (input || '').replace(/\D/g, '');
    if (digits.length === 12 && digits.startsWith('91')) return digits.slice(2);
    if (digits.length === 11 && digits.startsWith('0')) return digits.slice(1);
    return digits;
  }

  async submitQuote() {
    if (this.quoteSending) return;
    this.quoteError = '';

    if (!this.quoteImage) {
      this.quoteError = 'Please attach the quotation first.';
      return;
    }
    if (this.quoteName.trim().length < 2) {
      this.quoteError = 'Please enter your name.';
      return;
    }
    const mobile = this.normalizeMobile(this.quoteMobile);
    if (mobile.length !== 10) {
      this.quoteError = 'Please enter a valid 10-digit mobile number.';
      return;
    }

    this.quoteSending = true;
    try {
      await this.quotationService.submit(this.quoteName.trim(), mobile, this.quoteImage, this.ref);
      this.quoteSent = true;
      this.scrollTop();
    } catch (e) {
      console.warn('Quotation submit notice:', (e as any)?.message || e);
      this.quoteError = 'Could not send that just now. Please try again.';
    }
    this.quoteSending = false;
  }

  /** Reset the form so the same visitor can send a second quotation. */
  sendAnotherQuote() {
    this.quoteSent = false;
    this.quoteImage = null;
    this.quoteName = '';
    this.quoteMobile = '';
    this.quoteError = '';
    this.scrollTop();
    this.applyUpdateWhenSafe();
  }
}
