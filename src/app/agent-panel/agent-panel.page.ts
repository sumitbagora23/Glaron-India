import { Component, OnInit, OnDestroy, ViewChild } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { IonContent } from '@ionic/angular/standalone';
import { Router, ActivatedRoute } from '@angular/router';
import { SwUpdate } from '@angular/service-worker';
import { ProductService, Product, ProductVariant } from '../admin/product.service';
import { CategoryService, Category } from '../admin/category.service';
import { SettingsService } from '../admin/settings.service';
import { AgentService, Agent } from '../agent.service';
import { AgentAuthService } from '../agent-auth.service';
import { AgentCommissionService, CommissionEntry, CommissionPayment } from '../agent-commission.service';
import { PostService, SharePost } from '../admin/post.service';
import { PostShareService } from '../post-share.service';
import { ShareBrandingService } from '../share-branding.service';
import { NotificationService } from '../admin/notification.service';
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
    public shareBranding: ShareBrandingService,
    private notificationService: NotificationService,
    private pricePrefs: DealerPricePrefsService,
    private swUpdate: SwUpdate
  ) {}

  ngOnInit() {
    this.agentAuth.ensureFirebaseSession();
    // Which of the three prices the cards show is this person's own choice,
    // kept on this device against their mobile number.
    this.pricePrefs.use(this.agentAuth.getSession());
    this.applyTabFromQuery();
    // Bind this device to the agent side of the broadcast machinery: it
    // registers in the agent token collection and shows only what the admin
    // addressed to agents. Called here as well as at app launch because the
    // shared sign-in screen starts the dealer side before anyone has signed in.
    this.notificationService.startAgentListener();
    // Live feed of the pictures the admin publishes — the same `posts`
    // collection the dealer app reads.
    this.postService.start();

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
    window.location.href = `tel:${digits}`;
  }

  openWhatsAppChat() {
    const digits = this.callNumber.replace(/[^\d]/g, '');
    if (!digits) return;
    const wa = digits.length === 10 ? '91' + digits : digits;
    window.open(`https://wa.me/${wa}`, '_blank');
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

  private get filteredProducts(): Product[] {
    let list = this.products;

    if (this.selectedCategory && this.selectedCategory !== 'All Categories') {
      const target = this.selectedCategory.trim().toLowerCase();
      list = list.filter(p => this.productCategories(p).some(c => c.toLowerCase() === target));
    }

    const q = this.searchQuery.trim().toLowerCase();
    if (q) {
      list = list.filter(p =>
        (p.name || '').toLowerCase().includes(q) ||
        (p.category || '').toLowerCase().includes(q) ||
        (p.description || '').toLowerCase().includes(q) ||
        (p.variants || []).some(v => this.getVariantLabel(v).toLowerCase().includes(q))
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

  clearSearch() {
    this.searchQuery = '';
  }

  // Build a label from whatever descriptors the variant has: wattage, type,
  // dimension, colour and (per-)meter.
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

    if (variant.pricePerMtr) parts.push('per mtr');

    if (parts.length === 0) parts.push(variant.model || 'Variant');
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

  // Anything published in the last three days still wears the "New" pill.
  isNewPost(post: SharePost): boolean {
    return Date.now() - (post.createdAt || 0) < 3 * 24 * 60 * 60 * 1000;
  }

  // ---- Your branding ----
  //
  // The agent's own logo and detail lines, stamped onto every post they share.
  // Kept on this device (see ShareBrandingService) — Glaron publishes plain
  // artwork, and each agent forwards it carrying their own branding.

  brandingError = '';

  get brandingLogo(): string | null {
    return this.shareBranding.logo;
  }

  get brandingDetails(): string {
    return this.shareBranding.details;
  }

  set brandingDetails(value: string) {
    this.shareBranding.setDetails(value);
  }

  async onBrandingLogoSelected(event: Event) {
    const input = event.target as HTMLInputElement;
    const file = input.files && input.files[0];
    input.value = '';
    if (!file) return;
    this.brandingError = (await this.shareBranding.readLogoFile(file)) || '';
    if (!this.brandingError) this.flashToast('Branding saved.');
  }

  removeBrandingLogo() {
    this.shareBranding.setLogo(null);
    this.brandingError = '';
  }

  // Stamps this agent's own logo and details onto the picture, then opens the
  // device share sheet — identical to the dealer app, so a post forwarded by
  // an agent behaves the same as one forwarded by a dealer.
  async sharePost(post: SharePost) {
    if (this.sharingPostId) return;
    this.sharingPostId = post.id;
    try {
      const outcome = await this.postShare.share(post);
      if (outcome === 'downloaded') this.flashToast('Saved to your device.');
      else if (outcome === 'failed') this.flashToast('Could not prepare the post. Please try again.');
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
  }

  showProducts() {
    this.activeTab = 'products';
    this.homeCategory = null;
    this.scrollTop();
  }

  showCommission() {
    this.activeTab = 'commission';
    this.homeCategory = null;
    this.scrollTop();
  }

  openCategory(cat: string) {
    this.homeCategory = cat;
    this.scrollTop();
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
  }

  closeProfile() { this.showProfile = false; }

  signOut() {
    this.agentAuth.clearSession();
    // The one shared sign-in screen — there is no separate agent login any more.
    this.router.navigateByUrl('/dealer/login', { replaceUrl: true });
  }

  // ---------------- Modals ----------------

  openDescModal(product: Product) {
    this.selectedDescProduct = product;
  }

  closeDescModal() {
    this.selectedDescProduct = null;
  }

  openImageModal(image: string | undefined, title: string) {
    if (!image) return;
    this.selectedModalImage = image;
    this.selectedModalImageTitle = title;
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
