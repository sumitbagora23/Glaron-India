import { Component, OnInit, OnDestroy, ViewChild } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { IonContent } from '@ionic/angular/standalone';
import { Router, ActivatedRoute } from '@angular/router';
import { SwUpdate } from '@angular/service-worker';
import { ProductService, Product, ProductVariant } from '../admin/product.service';
import { SpecDetail, SpecTab, SpecTabState, specDetails, orderableLightColours, lightColourCatalogPrice, lightColourSwatch } from '../product-spec-tabs';
import { CategoryService, Category } from '../admin/category.service';
import { SettingsService } from '../admin/settings.service';
import { AgentService, Agent } from '../agent.service';
import { AgentAuthService } from '../agent-auth.service';
import { AgentCommissionService, CommissionEntry, CommissionPayment } from '../agent-commission.service';
import { PostService, SharePost } from '../admin/post.service';
import { PostShareService } from '../post-share.service';
import { ShareBusinessService } from '../share-business.service';
import { CatalogShareService } from '../catalog-share.service';
import { NotificationService } from '../admin/notification.service';
import { ActivityLogService } from '../admin/activity-log.service';
import { DealerPricePrefsService, DealerPriceMode } from '../dealer-price-prefs.service';
import { APP_VERSION } from '../version';

/**
 * The agent panel — three tabs and nothing else.
 *
 *   Home        browse the catalogue by category
 *   Products    the full catalogue with search
 *   Commission  the ledger the admin records against this agent
 *
 * Prices are shown, and follow the same three-way choice the dealer panel
 * offers in Profile: the catalog MRP, the rate the admin set for this agent, or
 * nothing at all (for when the catalogue is being shown to a customer).
 *
 * Deliberately absent: quantity steppers, a cart, checkout and orders. An agent
 * shows the range and earns commission; they never transact here, so every
 * control that would imply they can is left out rather than disabled.
 */
@Component({
  selector: 'app-agent-panel',
  templateUrl: './agent-panel.page.html',
  styleUrls: ['./agent-panel.page.scss'],
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    IonContent
  ]
})
export class AgentPanelPage implements OnInit, OnDestroy {

  // The box of colour drawn before a light colour name. Worked out from the
  // name itself, so a shade added today is painted without a code change.
  swatch(colour: string): string {
    return lightColourSwatch(colour);
  }

  readonly appVersion = APP_VERSION;

  // The scroll container, so switching tabs resets the view to the top rather
  // than keeping the previous tab's scroll position.
  @ViewChild(IonContent) private content?: IonContent;

  activeTab: 'home' | 'products' | 'commission' = 'home';
  // When set (in the Home tab), shows the products of that one category.
  homeCategory: string | null = null;

  searchQuery = '';
  selectedCategory = 'All Categories';

  showSidebar = false;
  showProfile = false;

  // Description / image modals
  selectedDescProduct: Product | null = null;
  selectedModalImage: string | null = null;
  selectedModalImageTitle = '';

  // Manual update check (side menu)
  updateChecking = false;
  updateMessage = '';

  // Share-a-post state (home tab)
  sharingPostId: string | null = null;
  toastMessage = '';
  private toastTimer: any;

  private popStateHandler = () => this.handleDeviceBack();

  constructor(
    private router: Router,
    private route: ActivatedRoute,
    private productService: ProductService,
    private categoryService: CategoryService,
    private settings: SettingsService,
    private agentService: AgentService,
    private agentAuth: AgentAuthService,
    private commissions: AgentCommissionService,
    private postService: PostService,
    private postShare: PostShareService,
    public shareBusiness: ShareBusinessService,
    private notificationService: NotificationService,
    private activity: ActivityLogService,
    private pricePrefs: DealerPricePrefsService,
    private swUpdate: SwUpdate,
    private catalogShare: CatalogShareService
  ) {}

  ngOnInit() {
    this.agentAuth.ensureFirebaseSession();
    // Which of the three prices the cards show is this person's own choice,
    // kept on this device against their mobile number.
    this.pricePrefs.use(this.agentAuth.getSession());
    // The details printed under a shared post belong to THIS account, not to
    // whoever used the app on this device before — one shared slot meant a post
    // sent from here went out under the other panel's name and number.
    this.shareBusiness.useAccount('agent', this.agentAuth.getSession() || '');
    this.applyTabFromQuery();
    // Bind this device to the agent side of the broadcast machinery: it
    // registers in the agent token collection and shows only what the admin
    // addressed to agents. Called here as well as at app launch because the
    // shared sign-in screen starts the dealer side before anyone has signed in.
    this.notificationService.startAgentListener();
    // Live feed of the pictures the admin publishes — the same `posts`
    // collection the dealer app reads.
    this.postService.start();

    // One 'opened the app' entry per launch for the admin's activity log.
    this.activity.logAppOpen();

    // Android's hardware Back should step back through the panel's own views
    // (category → categories, tab → home) before leaving the app.
    history.pushState({ agentPanel: true }, '');
    window.addEventListener('popstate', this.popStateHandler);
  }

  ngOnDestroy() {
    window.removeEventListener('popstate', this.popStateHandler);
  }

  // Opens the tab requested via ?tab= (used by the manifest shortcuts).
  private applyTabFromQuery() {
    const tab = this.route.snapshot.queryParamMap.get('tab');
    if (!tab) return;

    // Consume it, so the address bar can't keep yanking the agent back to that
    // tab long after they moved on.
    this.router.navigate([], { relativeTo: this.route, queryParams: {}, replaceUrl: true });

    if (tab === 'products' || tab === 'commission' || tab === 'home') {
      this.activeTab = tab;
      this.homeCategory = null;
      this.showProfile = false;
      this.showPosts = false;
    }
  }

  private handleDeviceBack() {
    // Always re-arm the history entry so the next Back press lands here too.
    history.pushState({ agentPanel: true }, '');

    if (this.selectedModalImage) { this.closeImageModal(); return; }
    if (this.selectedDescProduct) { this.closeDescModal(); return; }
    if (this.showSidebar) { this.closeSidebar(); return; }
    if (this.showBusinessEditor) { this.closeBusinessEditor(); return; }
    if (this.showPosts) { this.closePosts(); return; }
    if (this.showProfile) { this.closeProfile(); return; }
    if (this.activeTab === 'home' && this.homeCategory) { this.backToCategories(); return; }
    if (this.activeTab !== 'home') { this.showHome(); return; }
    // Already at the top of the panel — let the next press leave the app.
    history.back();
  }

  // ---------------- Identity ----------------

  // Looked up once per sign-in and per agent-list refresh rather than on every
  // change-detection tick: the price on every card and variant reads this.
  private cachedAgent: Agent | undefined;
  private cachedAgentMobile = '';
  private cachedAgentList: Agent[] | null = null;

  get currentAgent(): Agent | undefined {
    const mobile = this.agentAuth.getSession() || '';
    const list = this.agentService.agents;
    if (list !== this.cachedAgentList || mobile !== this.cachedAgentMobile) {
      this.cachedAgentList = list;
      this.cachedAgentMobile = mobile;
      this.cachedAgent = mobile ? this.agentService.findByMobile(mobile) : undefined;
    }
    return this.cachedAgent;
  }

  get callNumber(): string {
    return (this.settings.callNumber || '').trim();
  }

  makeCall() {
    const digits = this.callNumber.replace(/[^\d]/g, '');
    if (!digits) return;
    this.activity.log('call', 'Called Glaron', { detail: this.callNumber });
    window.location.href = `tel:${digits}`;
  }

  openWhatsAppChat() {
    const digits = this.callNumber.replace(/[^\d]/g, '');
    if (!digits) return;
    const wa = digits.length === 10 ? '91' + digits : digits;
    this.activity.log('whatsapp', 'Messaged Glaron on WhatsApp', { detail: this.callNumber });
    window.open(`https://wa.me/${wa}`, '_blank');
  }

  // ---- Per-product WhatsApp enquiry & share ---------------------------------
  // Both mirror the dealer panel exactly: the green button asks the shop about
  // one product, the dark button hands the product to the device share sheet.

  // The configured number in wa.me form (91-prefixed for a bare 10-digit one).
  private whatsappDigits(): string {
    let digits = this.callNumber.replace(/[^\d]/g, '');
    if (!digits) return '';
    if (digits.length === 10) digits = '91' + digits;
    else if (digits.length === 11 && digits.startsWith('0')) digits = '91' + digits.slice(1);
    return digits;
  }

  // Opens a WhatsApp chat with the number the admin configured in Settings,
  // prefilled with an enquiry that names the product and links its image so
  // WhatsApp renders a preview. Sending the image as a file isn't possible from
  // a wa.me link — the share button beside this one does that.
  openWhatsApp(product: Product, event?: Event) {
    // Don't let the click bubble to the card (which opens the image modal).
    event?.stopPropagation();
    const digits = this.whatsappDigits();
    if (!digits) return;

    const name = product.name || '';
    const lines = ['Hello, I would like to know more about this product.'];
    if (name) lines.push(`Product: ${name}`);
    const shareableImage = this.toShareableImageUrl(product.image);
    if (shareableImage) lines.push(shareableImage);

    this.activity.log('product-enquiry', `Enquired about ${product.name} on WhatsApp`, this.productMeta(product));

    const url = `https://wa.me/${digits}?text=${encodeURIComponent(lines.join('\n'))}`;
    window.open(url, '_blank');
  }

  // Turns a product image reference into a link WhatsApp can preview, or returns
  // '' when there's nothing shareable (missing image or an inline data: URI,
  // which WhatsApp can't render and which would bloat the message text).
  private toShareableImageUrl(image?: string): string {
    const src = (image || '').trim();
    if (!src || /^data:/i.test(src)) return '';
    if (/^https?:\/\//i.test(src)) return src;
    return `${window.location.origin}/${src.replace(/^\/+/, '')}`;
  }

  // Hands the OS share sheet a real image FILE plus the product's title,
  // variants and description. The card being prepared is tracked so its button
  // can show a spinner — re-encoding the image takes a moment on slow phones.
  sharingProductId: string | null = null;

  async shareProduct(product: Product, event?: Event) {
    event?.stopPropagation();
    if (this.sharingProductId) return;
    this.sharingProductId = product.id;
    this.activity.log('product-share', `Shared ${product.name}`, this.productMeta(product));

    const title = product.name || '';
    try {
      const text = this.buildShareText(product);
      const file = await this.buildShareImageFile(product);
      const nav = navigator as any;

      // Best case (all phones): share sheet with the image attached.
      if (file && nav.canShare?.({ files: [file] })) {
        await nav.share({ files: [file], title, text });
        return;
      }
      // Share sheet available but no file support → send the details alone.
      if (nav.share) {
        await nav.share({ title, text });
        return;
      }
      // No share sheet at all (most desktop browsers): save the image and put
      // the details on the clipboard so they can be pasted into any chat.
      if (file) this.downloadFile(file);
      await this.copyToClipboard(text);
      this.flashToast(file ? 'Image saved and details copied.' : 'Details copied.');
    } catch (err: any) {
      // Dismissing the share sheet rejects with AbortError — not a failure.
      if (err?.name === 'AbortError') return;
      this.flashToast('Could not share this product. Please try again.');
    } finally {
      this.sharingProductId = null;
    }
  }

  // Title, variant list and description, formatted for a chat message.
  private buildShareText(product: Product): string {
    const lines: string[] = [];
    const name = product.name || '';
    // *bold* is WhatsApp's markup and reads fine as plain text elsewhere.
    if (name) lines.push(`*${name}*`);
    if (product.category) lines.push(product.category);

    // Skip labels that are just the product name repeated (variants with no
    // distinguishing specs fall back to the model/name).
    const variants = (product.variants || [])
      .map(v => this.getVariantLabel(v))
      .filter(label => !!label && label !== product.name);
    if (variants.length) {
      lines.push('', 'Variants:');
      variants.forEach(label => lines.push(`• ${label}`));
    }

    // Same fallback copy the card shows when a product has no description.
    const description = product.description || 'High-performance lighting solution designed for modern spaces.';
    if (description) lines.push('', description);

    return lines.join('\n');
  }

  // Turns the product image into a real File ready for the share sheet, or null
  // when there's no usable image.
  private async buildShareImageFile(product: Product): Promise<File | null> {
    const src = (product.image || '').trim();
    if (!src) return null;
    const url = /^(https?:|data:|blob:)/i.test(src)
      ? src
      : `${window.location.origin}/${src.replace(/^\/+/, '')}`;

    // Flatten through a canvas first: catalog images are PNGs with transparent
    // backgrounds, which WhatsApp renders as solid black. A white-backed JPEG
    // also keeps the attachment small enough to send over mobile data.
    let blob = await this.flattenImage(url, 'image/jpeg');
    if (!blob) {
      // Canvas route failed (e.g. a cross-origin host that blocks CORS, which
      // taints the canvas) — fall back to sending the original bytes.
      try {
        const res = await fetch(url);
        if (res.ok) blob = await res.blob();
      } catch (e) {}
    }
    if (!blob || !blob.type.startsWith('image/')) return null;

    const ext = (blob.type.split('/')[1] || 'jpg').split('+')[0].replace('jpeg', 'jpg');
    const base = (product.name || product.id)
      .replace(/[^\w-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'product';
    return new File([blob], `${base}.${ext}`, { type: blob.type });
  }

  // Draws the image on a white canvas (capped at 1600px on the long edge) and
  // encodes it as `type`. Resolves null if the image can't be loaded or the
  // canvas is tainted by a cross-origin source.
  private flattenImage(url: string, type: string): Promise<Blob | null> {
    return new Promise(resolve => {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => {
        try {
          const max = 1600;
          const scale = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight) || 1);
          const canvas = document.createElement('canvas');
          canvas.width = Math.max(1, Math.round(img.naturalWidth * scale));
          canvas.height = Math.max(1, Math.round(img.naturalHeight * scale));
          const ctx = canvas.getContext('2d');
          if (!ctx) return resolve(null);
          ctx.fillStyle = '#FFFFFF';
          ctx.fillRect(0, 0, canvas.width, canvas.height);
          ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
          canvas.toBlob(blob => resolve(blob), type, 0.92);
        } catch (e) {
          resolve(null);
        }
      };
      img.onerror = () => resolve(null);
      img.src = url;
    });
  }

  private downloadFile(file: File) {
    const url = URL.createObjectURL(file);
    const link = document.createElement('a');
    link.href = url;
    link.download = file.name;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  private async copyToClipboard(text: string) {
    try {
      await navigator.clipboard.writeText(text);
    } catch (e) {
      // Clipboard API needs a secure context; fall back to the legacy path.
      const area = document.createElement('textarea');
      area.value = text;
      area.style.position = 'fixed';
      area.style.opacity = '0';
      document.body.appendChild(area);
      area.select();
      try { document.execCommand('copy'); } catch (e2) {}
      area.remove();
    }
  }

  // ---------------- Catalogue ----------------

  get products(): Product[] {
    return this.productService.products;
  }

  // The category list a product belongs to (new array field, falling back to the
  // legacy comma-joined string).
  private productCategories(p: Product): string[] {
    if (p.categories && p.categories.length) return p.categories.map(c => c.trim()).filter(Boolean);
    return (p.category || '').split(',').map(c => c.trim()).filter(Boolean);
  }

  // Filter options come from the managed Categories, not from whatever strings
  // happen to be sitting on products.
  get categories(): string[] {
    return ['All Categories', ...this.categoryService.categories.map(c => c.name)];
  }

  get categoryCards(): Category[] {
    return this.categoryService.categories;
  }

  // ---- The fixed catalogue bar ----

  // Which category the list is narrowed to, however it was reached: the
  // Products tab's own filter, or a category opened from the Home grid.
  get activeCategory(): string {
    return this.activeTab === 'home' && this.homeCategory ? this.homeCategory : this.selectedCategory;
  }

  // The categories open in a sheet over the page, laid out as the Home
  // browser lays them out, so the bar itself stays one line.
  categorySheetOpen = false;

  openCategorySheet() {
    this.categorySheetOpen = true;
  }

  closeCategorySheet() {
    this.categorySheetOpen = false;
  }

  // Whether there is a category to clear. "All Categories" is not a filter,
  // it is the absence of one, so it shows no cross.
  get hasCategoryFilter(): boolean {
    return !this.isCategoryOn('All Categories');
  }

  // The filter's cross, the twin of the one in the search field.
  clearCategory() {
    this.pickCategory('All Categories');
  }

  isCategoryOn(name: string): boolean {
    return this.activeCategory.trim().toLowerCase() === name.trim().toLowerCase();
  }

  // Every category is one tap away from anywhere in the catalogue: picking
  // one lands on the single product list, narrowed to it. "All Categories"
  // hands back the whole range, which is where a dealer who already knows the
  // fitting starts.
  pickCategory(name: string) {
    this.categorySheetOpen = false;
    this.selectedCategory = name;
    this.homeCategory = null;
    this.activeTab = 'products';
    this.scrollTop();
  }

  private get filteredProducts(): Product[] {
    let list = this.products;

    if (this.selectedCategory && this.selectedCategory !== 'All Categories') {
      const target = this.selectedCategory.trim().toLowerCase();
      list = list.filter(p => this.productCategories(p).some(c => c.toLowerCase() === target));
    }

    return this.searchIn(list);
  }

  // What the search field narrows a list to. Lifted out of the filter above so
  // a category opened from Home is searched exactly the same way — the bar over
  // it carries the same field.
  private searchIn(list: Product[]): Product[] {
    const q = this.searchQuery.trim().toLowerCase();
    if (!q) return list;
    return list.filter(p =>
      (p.name || '').toLowerCase().includes(q) ||
      (p.category || '').toLowerCase().includes(q) ||
      (p.description || '').toLowerCase().includes(q) ||
      (p.variants || []).some(v => this.getVariantLabel(v).toLowerCase().includes(q))
    );
  }

  get displayedProducts(): Product[] {
    if (this.activeTab === 'home' && this.homeCategory) {
      const target = this.homeCategory.trim().toLowerCase();
      return this.searchIn(this.products.filter(p =>
        this.productCategories(p).some(c => c.toLowerCase() === target)
      ));
    }
    return this.filteredProducts;
  }

  clearSearch() {
    this.searchQuery = '';
    clearTimeout(this.searchLogTimer);
  }

  // The product fields that ride along on an activity log entry. The product id
  // IS the SKU here (GLR-DELT-3), so it doubles as both.
  private productMeta(product: Product) {
    const cat = this.productCategories(product)[0] || '';
    return {
      productId: product.id,
      productName: product.name,
      sku: product.id,
      ...(cat ? { category: cat } : {})
    };
  }

  // Search is logged once typing stops, so one search is one entry rather than
  // one per keystroke. Fragments under three characters are mid-word noise.
  private searchLogTimer: any;
  onSearchChange(value: string) {
    clearTimeout(this.searchLogTimer);
    const term = (value || '').trim();
    if (term.length < 3) return;
    this.searchLogTimer = setTimeout(() => {
      this.activity.log('search', `Searched for "${term}"`, { detail: term, tab: this.activeTab });
    }, 1200);
  }

  // Build a label from whatever descriptors the variant has: wattage, type,
  // dimension, colour and (per-)meter.
  // ---- Wattage tabs ----
  // The wattages read as small tabs across the card. The open one lists every
  // light colour this product is sold in, priced per shade, and the ⓘ beside
  // its name opens the size, the cut-out and the rest of the sheet. A product
  // whose variants carry no wattage and no dimension has no tabs at all.
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

  // The light colours the admin picked, for this option or — with no option,
  // or one that carries none of its own — for the product.
  productLightColours(product: Product, variant?: ProductVariant): string[] {
    return orderableLightColours(product, variant);
  }

  // Only the name of the light is shown — no swatch, no colour temperature.

  /**
   * What an option costs in a given shade.
   *
   * A price set against a colour IS the price of that colour — it replaces the
   * option's price rather than adding to it. What the admin typed is a *catalog*
   * price though, so the agent's own rate still has to come off it. Without that
   * a shade priced by hand quietly showed full MRP while every other shade of
   * the same product carried the discount.
   *
   * `base` is the option at the agent's rate and `catalogBase` is the same option
   * at catalog price, so the ratio between them is exactly that rate — a blanket
   * discount, or a hand-typed line rate — and applying it to the colour keeps the
   * same discount whichever shade is picked. In the MRP view the two are equal,
   * the ratio is 1, and the colour shows its catalog price untouched.
   */
  colourPrice(base: number, product: Product, colour: string, catalogBase?: number, variant?: ProductVariant): number {
    // The option's own price for the shade wins over the product's.
    const own = lightColourCatalogPrice(product, colour, variant);
    if (!own || own <= 0) return base;
    if (!catalogBase || catalogBase <= 0 || !isFinite(base)) return own;
    return Math.round(own * (base / catalogBase));
  }

  getVariantLabel(variant: ProductVariant): string {
    const parts: string[] = [];
    const isBad = (v?: string) => !v || !v.trim() || /dimension/i.test(v);

    if (!isBad(variant.wattage)) parts.push(variant.wattage!.trim());
    if (variant.type && variant.type.trim()) parts.push(variant.type.trim());

    if (variant.dimension && variant.dimension.trim() && variant.dimension.trim() !== '-') {
      const d = variant.dimension.trim();
      parts.push(/mm/i.test(d) ? d : `${d} mm`);
    }

    if (variant.pricePerMtr) parts.push('per mtr');

    if (parts.length === 0) parts.push('Variant');
    return parts.join(' · ');
  }

  // ---------------- Prices ----------------
  //
  // One choice of three, made in Profile > Price Settings and kept on this
  // device: the catalog MRP, the rate the Glaron admin set for this agent, or
  // no prices at all. Identical to the dealer panel, including the wording.

  get priceMode(): DealerPriceMode {
    return this.pricePrefs.priceMode;
  }

  setPriceMode(mode: DealerPriceMode) {
    this.pricePrefs.setPriceMode(mode);
    this.activity.log('price-mode', 'Changed how prices are shown', { detail: mode });
  }

  get showPrices(): boolean {
    return this.pricePrefs.showPrices;
  }

  // Heading above the prices, so which one is on show is never ambiguous.
  get cardPriceLabel(): string {
    return this.priceMode === 'mrp' ? 'MRP' : 'My Price';
  }

  get cardPriceVariantLabel(): string {
    return this.priceMode === 'mrp' ? 'MRP per variant' : 'My price per variant';
  }

  // Effective catalog price for a variant, accounting for per-meter pricing.
  getVariantBasePrice(product: Product, variant: ProductVariant): number {
    return variant.price || variant.pricePerMtr || product.price;
  }

  // The rate the admin set for this agent (Admin > Agents > Custom Rate): a
  // per-product price if one exists, otherwise the catalog price times their
  // multiplier. Falls back to the catalog price for an agent with no rate set.
  private getAgentPrice(basePrice: number, productId?: string): number {
    const agent = this.currentAgent;
    if (agent && productId && agent.customPrices && agent.customPrices[productId] !== undefined) {
      return agent.customPrices[productId];
    }
    const mult = (agent && agent.multiplier !== undefined) ? agent.multiplier : 1.0;
    return Math.round(basePrice * mult);
  }

  private getVariantAgentPrice(product: Product, variant: ProductVariant, index: number): number {
    const agent = this.currentAgent;
    const key = `${product.id}#${index}`;
    if (agent && agent.customPrices && agent.customPrices[key] !== undefined) {
      return agent.customPrices[key];
    }
    const mult = (agent && agent.multiplier !== undefined) ? agent.multiplier : 1.0;
    return Math.round(this.getVariantBasePrice(product, variant) * mult);
  }

  getCardPrice(product: Product): number {
    if (this.priceMode === 'mrp') return product.price;
    return this.getAgentPrice(product.price, product.id);
  }

  getVariantCardPrice(product: Product, variant: ProductVariant, index: number): number {
    if (this.priceMode === 'mrp') return this.getVariantBasePrice(product, variant);
    return this.getVariantAgentPrice(product, variant, index);
  }

  onImgError(event: any) {
    if (event?.target) event.target.style.display = 'none';
  }

  trackByProductId(_index: number, product: Product): string {
    return product.id;
  }

  trackByCategoryId(_index: number, category: Category): string {
    return category.id;
  }

  trackByVariantIndex(index: number): number {
    return index;
  }

  trackByPostId(_index: number, post: SharePost): string {
    return post.id;
  }

  // ---------------- Commission ----------------

  get commissionEntries(): CommissionEntry[] {
    const id = this.currentAgent?.id || '';
    return this.commissions.entriesFor(id);
  }

  get commissionPayments(): CommissionPayment[] {
    const id = this.currentAgent?.id || '';
    return this.commissions.paymentsFor(id);
  }

  get totalSales(): number {
    return this.commissionEntries.reduce((sum, e) => sum + (e.salesAmount || 0), 0);
  }

  get totalCommission(): number {
    return this.commissionEntries.reduce((sum, e) => sum + (e.commissionAmount || 0), 0);
  }

  // Blended rate across everything recorded — not an average of the rates: a
  // ₹10L entry at 2% and a ₹10k entry at 20% is not "11%".
  get blendedRate(): number {
    if (!this.totalSales) return 0;
    return Math.round((this.totalCommission / this.totalSales) * 10000) / 100;
  }

  get totalPaid(): number {
    return this.commissionPayments.reduce((sum, p) => sum + (p.amount || 0), 0);
  }

  /** What is still owed: everything earned, less everything already paid. */
  get remaining(): number {
    return Math.round((this.totalCommission - this.totalPaid) * 100) / 100;
  }

  trackByEntryId(_index: number, entry: CommissionEntry): string {
    return entry.id;
  }

  trackByPaymentId(_index: number, payment: CommissionPayment): string {
    return payment.id;
  }

  // ---------------- Shareable posts ----------------

  showPosts = false;

  // Newest createdAt this device has already been shown. Keeping it means the
  // home nudge appears once per new post instead of sitting there for good.
  // Same key as the dealer panel: one app, one device, one person — they are
  // never both, so a second key would only ever duplicate this one.
  private readonly POSTS_SEEN_KEY = 'glaron_last_seen_post_ts';
  private postsSeenTs = this.readPostsSeenTs();

  private readPostsSeenTs(): number {
    try {
      return Number(localStorage.getItem(this.POSTS_SEEN_KEY)) || 0;
    } catch (e) {
      return 0;
    }
  }

  get sharePosts(): SharePost[] {
    return this.postService.posts;
  }

  get latestPost(): SharePost | null {
    return this.postService.latest;
  }

  // True while the newest post is one this device hasn't opened yet. The home
  // card is always there; this only decides whether it wears the "new" dot and
  // the livelier wording.
  get showPostNotice(): boolean {
    const latest = this.latestPost;
    return !!latest && (latest.createdAt || 0) > this.postsSeenTs;
  }

  private markPostsSeen() {
    const latest = this.latestPost;
    if (!latest) return;
    this.postsSeenTs = Math.max(this.postsSeenTs, latest.createdAt || 0);
    try {
      localStorage.setItem(this.POSTS_SEEN_KEY, String(this.postsSeenTs));
    } catch (e) {}
  }

  // Reached from the side menu and from the Home card. Opening the page counts
  // as seeing every post, so the "new" dot clears.
  openPosts() {
    this.showSidebar = false;
    this.showPosts = true;
    this.markPostsSeen();
    // Arm the Back guard so device Back closes the page rather than the app.
    history.pushState({ agentPanel: true }, '');
  }

  closePosts() {
    this.showPosts = false;
  }

  // Hands this account's own catalogue link to the device share sheet (or the
  // clipboard where there isn't one). The link opens the public catalogue: the
  // range only, with no prices and nothing orderable.
  async shareCatalogue() {
    this.showSidebar = false;
    const outcome = await this.catalogShare.share(this.agentAuth.getSession() || '');
    if (outcome === 'copied') this.flashToast('Catalogue link copied.');
    else if (outcome === 'failed') this.flashToast('Could not share the link. Please try again.');
  }

  // Anything published in the last three days still wears the "New" pill.
  isNewPost(post: SharePost): boolean {
    return Date.now() - (post.createdAt || 0) < 3 * 24 * 60 * 60 * 1000;
  }

  // ---- Your business details ----
  //
  // Tapping a post asks for the shop name, mobile and email, then prints them
  // in a black footer strip under the artwork. Kept on this device (see
  // ShareBusinessService) — identical to the dealer app, so a post forwarded by
  // an agent behaves the same as one forwarded by a dealer.

  showBusinessEditor = false;
  businessForm = { shop: '', mobile: '', email: '' };
  businessError = '';

  openBusinessEditor() {
    const saved = this.shareBusiness.business;
    this.businessForm = {
      shop: saved.shop,
      mobile: saved.mobile || this.agentAuth.getSession() || '',
      email: saved.email
    };
    this.businessError = '';
    this.showBusinessEditor = true;
    history.pushState({ agentPanel: true }, '');
  }

  closeBusinessEditor() {
    this.showBusinessEditor = false;
    this.businessError = '';
  }

  saveBusiness() {
    const shop = this.businessForm.shop.trim();
    const mobile = this.businessForm.mobile.trim();
    const email = this.businessForm.email.trim();

    if (!shop) {
      this.businessError = 'Please enter your shop name.';
      return;
    }
    // Spaces, +91 and dashes are all fine — it just has to hold a real number.
    if (mobile.replace(/\D/g, '').length < 10) {
      this.businessError = 'Please enter a valid 10-digit mobile number.';
      return;
    }
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      this.businessError = 'Please enter a valid email address.';
      return;
    }

    this.shareBusiness.save({ shop, mobile, email });
    this.closeBusinessEditor();
    this.flashToast('Business details saved.');
  }

  /** The number as the footer will print it — with its +91 in front. */
  printedMobile(raw: string): string {
    return ShareBusinessService.withDialCode(raw);
  }

  // Tapping a post shares it straight away, with the saved details printed
  // underneath. With nothing saved yet the editor opens instead, so no post
  // goes out bare by accident.
  async sharePost(post: SharePost) {
    if (this.sharingPostId) return;
    if (!this.shareBusiness.hasBusiness) {
      this.openBusinessEditor();
      return;
    }

    this.sharingPostId = post.id;
    try {
      const outcome = await this.postShare.share(post);
      if (outcome === 'downloaded') this.flashToast('Saved to your device.');
      else if (outcome === 'failed') this.flashToast('Could not prepare the post. Please try again.');
      this.activity.log('post-share', 'Shared a Glaron post', {
        detail: (post.caption || '').trim() || outcome
      });
    } finally {
      this.sharingPostId = null;
    }
  }

  private flashToast(message: string) {
    this.toastMessage = message;
    clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => { this.toastMessage = ''; }, 3200);
  }

  // ---------------- Tabs & navigation ----------------

  get tabIndex(): number {
    return this.activeTab === 'products' ? 1 : this.activeTab === 'commission' ? 2 : 0;
  }

  // The wordmark and contact buttons belong to the Home category browser only.
  // Every other view wears the same plain bar: back button + title.
  get isHomeBar(): boolean {
    return this.activeTab === 'home' && !this.homeCategory;
  }

  get topBarTitle(): string {
    if (this.activeTab === 'commission') return 'My Commission';
    if (this.activeTab === 'home' && this.homeCategory) return this.homeCategory;
    return 'All Products';
  }

  private scrollTop() {
    this.content?.scrollToTop(0);
  }

  topBarBack() {
    if (this.activeTab === 'home' && this.homeCategory) {
      this.backToCategories();
    } else {
      this.showHome();
    }
  }

  showHome() {
    this.activeTab = 'home';
    this.homeCategory = null;
    this.scrollTop();
    this.activity.log('tab', 'Opened the Home tab', { tab: 'home' });
  }

  showProducts() {
    this.activeTab = 'products';
    this.homeCategory = null;
    this.scrollTop();
    this.activity.log('tab', 'Opened the Products tab', { tab: 'products' });
  }

  showCommission() {
    this.activeTab = 'commission';
    this.homeCategory = null;
    this.scrollTop();
    this.activity.log('tab', 'Opened the Commission tab', { tab: 'commission' });
  }

  openCategory(cat: string) {
    this.homeCategory = cat;
    this.scrollTop();
    this.activity.log('category', `Browsed the ${cat} category`, { category: cat, tab: 'home' });
  }

  backToCategories() {
    this.homeCategory = null;
    this.scrollTop();
  }

  // ---------------- Side menu & profile ----------------

  openSidebar() { this.showSidebar = true; }
  closeSidebar() { this.showSidebar = false; }

  openProfileFromMenu() {
    this.showSidebar = false;
    this.showProfile = true;
    this.activity.log('profile-open', 'Opened their profile');
  }

  closeProfile() { this.showProfile = false; }

  signOut() {
    // Logged first: once the session is cleared there is no actor to attribute
    // the entry to and it would be dropped.
    this.activity.log('sign-out', 'Signed out');
    this.agentAuth.clearSession();
    // The one shared sign-in screen — there is no separate agent login any more.
    this.router.navigateByUrl('/dealer/login', { replaceUrl: true });
  }

  // ---------------- Modals ----------------

  openDescModal(product: Product) {
    this.selectedDescProduct = product;
    this.activity.log('product-detail', `Viewed ${product.name} details`, this.productMeta(product));
  }

  closeDescModal() {
    this.selectedDescProduct = null;
  }

  openImageModal(image: string | undefined, title: string) {
    if (!image) return;
    this.selectedModalImage = image;
    this.selectedModalImageTitle = title;
    this.activity.log('product-image', `Zoomed the ${title} image`, { productName: title });
  }

  closeImageModal() {
    this.selectedModalImage = null;
    this.selectedModalImageTitle = '';
  }

  // ---------------- Manual update check ----------------

  // The installed app never updates itself (see AppComponent) — this button is
  // the only path to a new version, so it reports honestly either way.
  async checkForAppUpdate() {
    if (this.updateChecking) return;
    this.updateChecking = true;
    this.updateMessage = '';

    if (!this.swUpdate.isEnabled) {
      this.updateChecking = false;
      this.updateMessage = 'Updates are not available in this browser.';
      return;
    }

    try {
      const found = await this.swUpdate.checkForUpdate();
      if (found) {
        await this.swUpdate.activateUpdate();
        document.location.reload();
        return;
      }
      this.updateMessage = 'You are on the latest version.';
    } catch (e) {
      console.warn('Agent update check notice:', e);
      this.updateMessage = 'Could not check right now. Please try again.';
    } finally {
      this.updateChecking = false;
      setTimeout(() => { this.updateMessage = ''; }, 5000);
    }
  }
}
