import { Component, OnInit, OnDestroy, ViewChild, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { IonContent } from '@ionic/angular/standalone';
import { ActivatedRoute } from '@angular/router';
import { Title } from '@angular/platform-browser';
import { SwUpdate } from '@angular/service-worker';
import { ProductService, Product, ProductVariant } from '../admin/product.service';
import { SpecDetail, SpecTab, SpecTabState, specDetails, orderableLightColours, lightColourSwatch, splitLightColourLabel } from '../product-spec-tabs';
import { CategoryService, Category } from '../admin/category.service';
import { QuotationService, QuotationItem, QuotationArea } from '../admin/quotation.service';
import { CatalogShareService } from '../catalog-share.service';
import { LightColourService } from '../admin/light-colour.service';
import { orderableBodyColours } from '../admin/body-colours';

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

/** One space of the visitor's job, with what they want lighting it. */
export interface PublicArea {
  /** Local id, so two areas named the same are still two areas. */
  id: string;
  /** Whatever they typed: "Kitchen", "Master Bedroom", "Shop Front". */
  name: string;
  items: PublicCartItem[];
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


  // The box of colour drawn before a light colour name. Worked out from the
  // name itself, so a shade added today is painted without a code change.
  swatch(colour: string): string {
    return lightColourSwatch(colour);
  }

  @ViewChild(IonContent) private content?: IonContent;

  private swUpdate = inject(SwUpdate);

  // Four destinations: browse by category, the whole range, the list you have
  // built and want priced, or a quotation you already hold and want bettered.
  activeTab: 'home' | 'products' | 'cart' | 'compare' | 'area' = 'home';
  // Set while a single category is being viewed from the Home tab.
  homeCategory: string | null = null;

  /**
   * Where inside the quotation tabs the visitor is.
   *
   * Asking for a price is three separate screens, not one long scroll: the
   * list, then the two callback fields on their own page, then the confirmation
   * on its own page. On a phone a form that unfolds under a list is half read
   * and half missed — a screen that holds nothing but the two fields is not.
   */
  /**
   * Where inside the List tab the visitor is.
   *
   * On an area-wise link this tab is the whole review: the areas, one area's
   * products when it is opened, then the two callback fields and the
   * confirmation. On every other link it is what it always was.
   */
  cartStep: 'list' | 'area' | 'form' | 'done' = 'list';
  compareStep: 'upload' | 'form' | 'done' = 'upload';

  /**
   * Where inside the Areas tab the visitor is.
   *
   * Two screens, and the tab does one job: name the areas, and fill them.
   * Nothing is reviewed or sent from here — what has been picked is read in the
   * List tab, which is where the request goes off from. Browsing happens inside
   * an area rather than beside it, so a product tapped there can only land in
   * the room that is open.
   */
  areaStep: 'list' | 'browse' = 'list';

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
  /** Name of the file that was picked, shown under the preview. */
  quoteFileName = '';
  /** How many PDF pages were turned into that image (0 for a photo). */
  quotePageCount = 0;
  quoteName = '';
  quoteMobile = '';
  quoteError = '';
  quoteReading = false;
  quoteSending = false;

  // ---- Quotation list (the cart) ----
  /** What the visitor has picked. Quantities only — never a price. */
  cart: PublicCartItem[] = [];
  reqName = '';
  reqMobile = '';
  reqError = '';
  reqSending = false;
  // ---- Quantity keypad ----
  // The same bottom-sheet keypad the installed app uses. Twelve taps on a
  // stepper to reach 12 pieces is how a list gets abandoned; tapping the
  // number and typing it is how the app has always done it, so the shared
  // catalogue does it the same way.
  showNumpad = false;
  numpadValue = '';
  numpadTitle = '';
  /** The line the keypad is editing — an existing one, or one not on the list yet. */
  private numpadLine: Omit<PublicCartItem, 'quantity'> | null = null;

  // ---- Areas (the area-wise link only) ----
  /** The rooms the visitor has named, each with what goes in it. */
  areas: PublicArea[] = [];
  /** Which one is being filled. Everything added while it is set goes into it. */
  activeAreaId: string | null = null;
  /** Which one is open for reading in the List tab. A different question. */
  listAreaId: string | null = null;
  newAreaName = '';
  areaError = '';

  /** Survives a reload, so a half-built list is not lost by closing the tab. */
  private readonly CART_KEY = 'glaron_catalogue_quote_list';
  private readonly AREAS_KEY = 'glaron_catalogue_area_list';

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

  /**
   * Whether this link asks for the list area by area.
   *
   * Only the area-wise link shared from the console does. It can do everything
   * the plain office link can — the flat list, the compare tab — and adds the
   * Areas tab on top, which is the whole difference between the two.
   */
  get areaAllowed(): boolean {
    return this.catalogShare.isAreaRef(this.ref);
  }

  /**
   * Whether the product cards may be added from where the visitor is standing.
   *
   * Everywhere on both links, with one exception: on the area-wise link the
   * Areas tab is a room browser, so it adds only once a room is actually open.
   * The Products and Home tabs there add the ordinary way — see fillingArea.
   */
  get canAddProducts(): boolean {
    if (!this.quotationsAllowed) return false;
    if (!this.areaAllowed) return true;
    if (this.activeTab === 'products' || this.activeTab === 'home') return true;
    return this.activeTab === 'area' && this.areaStep === 'browse' && !!this.activeArea;
  }

  /**
   * The room being filled right now, or null when nothing is — which is every
   * tab but Areas, on either kind of link.
   *
   * This is what makes the area link's Products tab behave like a plain
   * catalogue: a light picked there belongs to no room, so it goes on the flat
   * list exactly as it would on an office link and is sent as an ordinary
   * quotation. Rooms are what the Areas tab is for, and a visitor who never
   * opens that tab never has to think about them.
   */
  private get fillingArea(): PublicArea | null {
    return this.activeTab === 'area' ? this.activeArea : null;
  }

  ngOnInit() {
    this.ref = this.route.snapshot.paramMap.get('ref') || '';
    // The catalogue site's own address carries no link code, and a ref-less
    // visit is otherwise read as a dealer's share — browse only, with no list,
    // no rooms and no compare. But this address is Glaron's, not a dealer's:
    // someone who typed it in is Glaron's own customer and may ask Glaron for
    // a price. So the bare site stands in for the generic area-wise link,
    // which is the one that can do everything.
    if (!this.ref && typeof location !== 'undefined' && location.hostname.includes('catalogue')) {
      this.ref = 'qa-' + this.catalogShare.linkCode('');
    }
    // The link is shared as "Glaron India Catalogue"; the page it opens says so
    // too, in the browser tab and in whatever preview a chat app renders.
    this.title.setTitle('Glaron India Catalogue');
    // A list saved on an office link must not reappear on a dealer's, where
    // there is nowhere to send it and nothing to show it in.
    if (this.quotationsAllowed) this.loadCart();
    if (this.areaAllowed) this.loadAreas();
    this.startAutoUpdate();
  }

  ngOnDestroy() {
    if (this.updateTimer) clearInterval(this.updateTimer);
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
    if (this.cartStep === 'form' || this.compareStep === 'form') return;
    if (this.reqSending || this.quoteSending || this.quoteReading) return;
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
    // Filling an area browses this same list; picking a category there must
    // narrow it, not walk away from the area being filled.
    if (!(this.activeTab === 'area' && this.areaStep === 'browse')) this.activeTab = 'products';
    this.scrollTop();
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
    return this.searchIn(list);
  }

  // What the search field narrows a list to. Lifted out of the filter above so
  // a category opened from Home is searched exactly the same way — the bar over
  // it carries the same field.
  private searchIn(list: Product[]): Product[] {
    const q = this.searchQuery.trim().toLowerCase();
    if (!q) return list;
    return list.filter(p =>
      p.name.toLowerCase().includes(q) ||
      p.id.toLowerCase().includes(q) ||
      p.category.toLowerCase().includes(q)
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

  // ---- Navigation ----

  get tabIndex(): number {
    if (this.activeTab === 'products') return 1;
    // 'area' is no longer a tab of its own — it is the range opened with a room
    // held, reached from that room on the list — so it sits under the list.
    if (this.activeTab === 'area') return 2;
    if (this.activeTab === 'cart') return 2;
    if (this.activeTab === 'compare') return 3;
    return 0;
  }

  /** Two on a dealer's link, four on either of the office's. */
  get tabCount(): number {
    return this.quotationsAllowed ? 4 : 2;
  }

  // Only the category browser wears the brand bar; every other view gets the
  // plain back + title bar, same as the panels.
  get isHomeBar(): boolean {
    return this.activeTab === 'home' && !this.homeCategory;
  }

  /**
   * True on the form and confirmation screens.
   *
   * They are pages in their own right: the tab bar goes away, so the only
   * things on screen are the fields being asked for and the way back.
   */
  get isFocusStep(): boolean {
    if (this.activeTab === 'cart') return this.cartStep === 'form' || this.cartStep === 'done';
    if (this.activeTab === 'compare') return this.compareStep !== 'upload';
    return false;
  }

  get topBarTitle(): string {
    if (this.activeTab === 'area') {
      if (this.areaStep === 'browse') return `Add to ${this.activeArea?.name || 'Area'}`;
      return 'Your Areas';
    }
    if (this.activeTab === 'cart') {
      if (this.cartStep === 'form') return 'Your Details';
      if (this.cartStep === 'done') return 'Request Sent';
      if (this.cartStep === 'area') return this.listArea?.name || 'Area';
      return this.areaAllowed ? 'Your Quotation List' : 'Your Quotation List';
    }
    if (this.activeTab === 'compare') {
      if (this.compareStep === 'form') return 'Your Details';
      if (this.compareStep === 'done') return 'Quotation Sent';
      return 'Compare Quotation';
    }
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
    // Inside a request, back means one screen back through it — never straight
    // out of the tab, which would look like the list had been thrown away.
    if (this.activeTab === 'cart' && this.cartStep === 'form') {
      this.cartStep = 'list';
      this.reqError = '';
      this.scrollTop();
      return;
    }
    // One area, opened for reading — back is the list of them.
    if (this.activeTab === 'cart' && this.cartStep === 'area') {
      this.cartStep = 'list';
      this.listAreaId = null;
      this.scrollTop();
      return;
    }
    if (this.activeTab === 'cart' && this.cartStep === 'done') {
      this.startNewList();
      return;
    }
    if (this.activeTab === 'compare' && this.compareStep === 'form') {
      this.compareStep = 'upload';
      this.quoteError = '';
      this.scrollTop();
      return;
    }
    if (this.activeTab === 'compare' && this.compareStep === 'done') {
      this.sendAnotherQuote();
      return;
    }

    // Filling a room: back means stop filling it, and it lands where Done
    // lands — on the room, on the list. It used to drop the browser on the old
    // Areas tab, which is no longer a screen at all: the rooms were folded into
    // the list, so leaving activeTab on 'area' with nothing open now renders
    // nothing.
    if (this.activeTab === 'area' && this.areaStep === 'browse') {
      this.finishBrowsing();
      return;
    }

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
  // ---- Wattage / dimension tabs ----
  // The two specs a fitting is chosen by read as small tabs across the card.
  // Opening one shows the light colours this product is sold in. A product
  // whose variants carry no wattage and no dimension has no tabs at all.
  private specTabState = new SpecTabState();
  trackBySpecTab = this.specTabState.trackByKey;

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
    return specDetails(tab.variant, this.warrantyFor(tab));
  }

  /** The guarantee on the product a tab belongs to. The key is `productId#i`. */
  private warrantyFor(tab: SpecTab): string | undefined {
    const productId = String(tab.key || '').split('#')[0];
    return this.products.find((p: Product) => p.id === productId)?.warranty;
  }

  isSpecSheetOpen(product: Product): boolean {
    return this.specTabState.isSheetOpen(product);
  }

  toggleSpecSheet(product: Product) {
    this.specTabState.toggleSheet(product);
  }

  trackByColour = (_: number, colour: string) => colour;

  // ---- Body colour: the outer tab ----
  //
  // The finish is chosen ABOVE the wattage, because it is the coarser choice: a
  // customer decides the fitting is going to be black before deciding which
  // wattage of it they want. The wattage tabs, the shade rows and the quantity
  // under them all belong to whichever finish is open.
  //
  // A finish is remembered per product, so opening a second card does not
  // disturb the first. Nothing is stored for a product with only one finish (or
  // none) — there is no choice to make, and the row is not drawn.
  private openBodyColourByProduct: { [productId: string]: string } = {};

  trackByBodyColour = (_: number, colour: string) => colour;

  /** The finishes this product is sold in — empty when it has none to choose. */
  productBodyColours(product: Product): string[] {
    const colours = orderableBodyColours(product);
    return colours.length > 1 ? colours : [];
  }

  /**
   * The finish every quantity on this card is counted against.
   *
   * Undefined when the product has no choice of finish, which keeps the line
   * key and the line label exactly as they were before body colours existed —
   * an untouched product quotes the same way it always did.
   */
  activeBodyColour(product: Product): string | undefined {
    const colours = this.productBodyColours(product);
    if (!colours.length) return undefined;
    const open = this.openBodyColourByProduct[product.id];
    return open && colours.includes(open) ? open : colours[0];
  }

  isBodyColourOpen(product: Product, colour: string): boolean {
    return this.activeBodyColour(product) === colour;
  }

  selectBodyColour(product: Product, colour: string) {
    this.openBodyColourByProduct[product.id] = colour;
  }

  /**
   * Everything asked for in one finish, across every wattage and shade under
   * it — what the finish tab's badge shows.
   */
  bodyColourTotalQty(product: Product, colour: string): number {
    const tabs = this.specTabs(product);
    if (!tabs.length) return this.qtyInCart(product, undefined, undefined, colour);
    return tabs.reduce((sum, tab) => sum + this.specTabTotalQty(product, tab.variant, colour), 0);
  }

  // The light colours the admin picked, for this option or — with no option,
  // or one that carries none of its own — for the product.
  productLightColours(product: Product, variant?: ProductVariant): string[] {
    return orderableLightColours(product, variant);
  }

  // Only the name of the light is shown — no swatch, no colour temperature.

  /**
   * `omitBodyColour` is set once a finish has actually been chosen. The text
   * the import left on the variant is the LIST of finishes ("BK/WH + GBK/RG"),
   * so printing it beside the one that was picked reads as a contradiction:
   * "BK/WH + GBK/RG · BK/GBK". The choice replaces the list.
   */
  getVariantLabel(variant: ProductVariant, omitBodyColour = false): string {
    const parts: string[] = [];
    const isBad = (v?: string) => !v || !v.trim() || /dimension/i.test(v);

    if (!isBad(variant.wattage)) parts.push(variant.wattage!.trim());

    if (variant.dimension && variant.dimension.trim() && variant.dimension.trim() !== '-') {
      const d = variant.dimension.trim();
      parts.push(/mm/i.test(d) ? d : `${d} mm`);
    }

    // The finish is chosen per line and appended by lineLabel(), so it is not
    // part of the option's own descriptor any more.
    if (parts.length === 0) parts.push('Variant');
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

  /**
   * What the List tab's badge counts: everything picked, wherever it was put.
   * On an area link that is the rooms plus whatever was added straight off the
   * Products tab, because both sit on that tab and both get sent.
   */
  get listBadge(): number {
    return this.areaAllowed ? this.areaPieceCount + this.cartCount : this.cartCount;
  }

  // The shade is part of the key, so 7W warm white and 7W cool white are two
  // lines on the list. Appended only when there IS a shade, which leaves keys
  // already saved on a visitor's device matching what they were.
  private cartKey(product: Product, variant?: ProductVariant, lightColour?: string, bodyColour?: string): string {
    const base = product.id + '::' + (variant ? this.getVariantLabel(variant) : '');
    const withShade = lightColour ? base + '::' + lightColour : base;
    // The finish is part of what was asked for, so it parts the lines: six in
    // black and four in white are two rows, never one row of ten.
    return bodyColour ? withShade + '::body:' + bodyColour : withShade;
  }

  /** What the request reads: the option, then the shade asked for. */
  private lineLabel(variant?: ProductVariant, lightColour?: string, bodyColour?: string): string {
    const parts = [variant ? this.getVariantLabel(variant, !!bodyColour) : '', bodyColour || '', lightColour || ''];
    return parts.filter(p => p && p.trim()).join(' · ');
  }

  /**
   * The list a product tapped right now belongs to.
   *
   * With an area open it is that area's own list, so the same product card
   * behaves the same way whichever tab it was reached from — it just lands
   * somewhere else. Everywhere else it is the flat quotation list.
   */
  private get activeItems(): PublicCartItem[] {
    const area = this.fillingArea;
    return area ? area.items : this.cart;
  }

  /** How many of this exact line are already on the list (0 if none). */
  qtyInCart(product: Product, variant?: ProductVariant, lightColour?: string, bodyColour?: string): number {
    const key = this.cartKey(product, variant, lightColour, bodyColour);
    return this.activeItems.find(item => item.key === key)?.quantity || 0;
  }

  /**
   * Everything asked for against one wattage tab, across all its shades — what
   * the tab's badge shows, so a closed tab still says it has something in it.
   */
  specTabTotalQty(product: Product, variant: ProductVariant, bodyColour?: string): number {
    const colours = this.productLightColours(product, variant);
    if (!colours.length) return this.qtyInCart(product, variant, undefined, bodyColour);
    return colours.reduce((sum, c) => sum + this.qtyInCart(product, variant, c, bodyColour), 0);
  }

  /** Put one more of this line on the list, or start it at one. */
  addToCart(product: Product, variant?: ProductVariant, lightColour?: string, bodyColour?: string) {
    if (!this.quotationsAllowed) return;
    const key = this.cartKey(product, variant, lightColour, bodyColour);
    const list = this.activeItems;
    const existing = list.find(item => item.key === key);
    if (existing) {
      existing.quantity += 1;
    } else {
      list.push({
        key,
        productId: product.id,
        name: product.name,
        image: product.image,
        variant: this.lineLabel(variant, lightColour, bodyColour),
        quantity: 1
      });
    }
    this.saveCart();
  }

  /** Step a line down, dropping it off the list at zero. */
  removeOneFromCart(product: Product, variant?: ProductVariant, lightColour?: string, bodyColour?: string) {
    const list = this.activeItems;
    const index = list.findIndex(item => item.key === this.cartKey(product, variant, lightColour, bodyColour));
    if (index === -1) return;
    if (list[index].quantity > 1) {
      list[index].quantity -= 1;
    } else {
      list.splice(index, 1);
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

  // ---- Quantity keypad ----

  /** Set an exact quantity on a line, dropping it off the list at zero. */
  private setLineQuantity(line: Omit<PublicCartItem, 'quantity'>, quantity: number) {
    const qty = Math.max(0, Math.floor(quantity || 0));
    const list = this.numpadItems || this.activeItems;
    const index = list.findIndex(item => item.key === line.key);

    if (qty <= 0) {
      if (index > -1) list.splice(index, 1);
    } else if (index > -1) {
      list[index].quantity = qty;
    } else {
      list.push({ ...line, quantity: qty });
    }
    this.saveCart();
  }

  /**
   * The list the keypad is editing.
   *
   * Fixed when the sheet opens rather than read when Done is tapped: the row
   * that was tapped is the row that must change, whatever the page is showing
   * by then.
   */
  private numpadItems: PublicCartItem[] | null = null;

  /** Tapping the quantity on a product, variant or shade row. */
  openNumpad(product: Product, variant?: ProductVariant, lightColour?: string, bodyColour?: string) {
    if (!this.quotationsAllowed) return;
    this.numpadItems = this.activeItems;
    const label = this.lineLabel(variant, lightColour, bodyColour);
    this.numpadLine = {
      key: this.cartKey(product, variant, lightColour, bodyColour),
      productId: product.id,
      name: product.name,
      image: product.image,
      variant: label
    };
    this.numpadTitle = label && label !== product.name ? `${product.name} · ${label}` : product.name;
    const current = this.qtyInCart(product, variant, lightColour, bodyColour);
    this.numpadValue = current > 0 ? String(current) : '';
    this.showNumpad = true;
  }

  /** Tapping the quantity on a row of the list itself, or of an area's list. */
  openNumpadForLine(index: number, list: PublicCartItem[] = this.cart) {
    const item = list[index];
    if (!item) return;
    this.numpadItems = list;
    const { quantity, ...line } = item;
    this.numpadLine = line;
    this.numpadTitle = item.variant ? `${item.name} · ${item.variant}` : item.name;
    this.numpadValue = String(quantity);
    this.showNumpad = true;
  }

  /** The number currently on the keypad display. */
  get numpadDisplay(): string {
    return this.numpadValue || '0';
  }

  numpadPress(digit: string) {
    if (this.numpadValue.length >= 4) return; // cap at 9999
    if (this.numpadValue === '0') this.numpadValue = '';
    this.numpadValue += digit;
  }

  numpadBackspace() {
    this.numpadValue = this.numpadValue.slice(0, -1);
  }

  numpadClear() {
    this.numpadValue = '';
  }

  numpadConfirm() {
    const qty = parseInt(this.numpadValue || '0', 10) || 0;
    if (this.numpadLine) this.setLineQuantity(this.numpadLine, qty);
    this.closeNumpad();
  }

  closeNumpad() {
    this.showNumpad = false;
    this.numpadLine = null;
    this.numpadItems = null;
    this.numpadValue = '';
    this.numpadTitle = '';
  }

  private saveCart() {
    try {
      localStorage.setItem(this.CART_KEY, JSON.stringify(this.cart));
      // One save for both, because a product tapped on a card goes into
      // whichever of the two the page is currently filling.
      if (this.areaAllowed) localStorage.setItem(this.AREAS_KEY, JSON.stringify(this.areas));
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

  // ---- Areas ----

  private loadAreas() {
    try {
      const stored = localStorage.getItem(this.AREAS_KEY);
      if (!stored) return;
      const parsed = JSON.parse(stored);
      if (!Array.isArray(parsed)) return;
      this.areas = parsed
        .filter(a => a && a.id && a.name)
        .map(a => ({
          id: String(a.id),
          name: String(a.name),
          items: Array.isArray(a.items) ? a.items.filter((i: any) => i && i.key && i.quantity > 0) : []
        }));
    } catch (e) {}
  }

  /** The area currently open, if any. */
  get activeArea(): PublicArea | null {
    if (!this.activeAreaId) return null;
    return this.areas.find(a => a.id === this.activeAreaId) || null;
  }

  /** Every piece across every area — what the tab badge counts. */
  get areaPieceCount(): number {
    return this.areas.reduce(
      (sum, area) => sum + area.items.reduce((n, item) => n + item.quantity, 0), 0
    );
  }

  /**
   * What lines picked outside any room are called once they travel inside an
   * area quotation. Named, not blank, so the console shows a heading rather
   * than an unlabelled block of products.
   */
  private readonly LOOSE_GROUP_NAME = 'Other Items';

  /** Areas that actually have something in them: what can be sent. */
  get filledAreas(): PublicArea[] {
    return this.areas.filter(a => a.items.length > 0);
  }

  pieceCountIn(area: PublicArea): number {
    return area.items.reduce((n, item) => n + item.quantity, 0);
  }

  /** Name a new area. Adding an area that already exists just opens it. */
  addArea() {
    const name = this.newAreaName.trim();
    if (!name) {
      this.areaError = 'Type the name of the area first — Kitchen, Lobby, Bedroom…';
      return;
    }
    this.areaError = '';

    // Typing a name that already exists is not an error and not a second room:
    // it is the shortest way back into the one that is already there.
    const existing = this.areas.find(a => a.name.toLowerCase() === name.toLowerCase());
    if (existing) {
      this.newAreaName = '';
      this.fillArea(existing);
      return;
    }

    const area: PublicArea = { id: this.newAreaId(), name, items: [] };
    this.areas = [...this.areas, area];
    this.newAreaName = '';
    this.saveCart();
    // Straight into the range with the room held, because the next thing wanted
    // after naming a room is always to put lights in it.
    //
    // This used to call openArea, which set the step to 'browse' but left
    // activeTab alone — and since rooms are named from the LIST tab, the tab
    // never changed and naming a room appeared to do nothing but add a row.
    // Filling it then took two more taps: open the room, then Add lights.
    this.fillArea(area);
  }

  private newAreaId(): string {
    return 'a' + Date.now().toString(36) + Math.floor(Math.random() * 1000).toString(36);
  }

  /**
   * Open the range with this room held, so everything added lands in it.
   *
   * This was the Areas tab. A customer's picks lived in two places — rooms on
   * one tab, the list on another, each explaining the other — so the rooms
   * moved onto the list and filling one starts from the room itself.
   */
  fillArea(area: PublicArea) {
    this.activeTab = 'area';
    this.activeAreaId = area.id;
    this.areaStep = 'browse';
    this.searchQuery = '';
    this.scrollTop();
  }

  /**
   * Done adding — back to the room on the list, where it was opened from.
   *
   * The rooms live on the list now, so there is nowhere else to return to:
   * leaving the browser on the old 'area' tab would land on a tab that is no
   * longer in the bar.
   */
  finishBrowsing() {
    const area = this.activeArea;
    this.activeAreaId = null;
    this.areaStep = 'list';
    this.activeTab = 'cart';
    if (area) this.openListArea(area);
    else this.cartStep = 'list';
    this.scrollTop();
  }

  /** Open an area in the List tab, to read what is in it. */
  openListArea(area: PublicArea) {
    this.listAreaId = area.id;
    this.cartStep = 'area';
    this.scrollTop();
  }

  /** The area open for reading, if any. */
  get listArea(): PublicArea | null {
    if (!this.listAreaId) return null;
    return this.areas.find(a => a.id === this.listAreaId) || null;
  }

  removeArea(area: PublicArea, event?: Event) {
    event?.stopPropagation();
    const count = this.pieceCountIn(area);
    if (count > 0 && !confirm(`Remove ${area.name} and the ${count} ${count === 1 ? 'piece' : 'pieces'} in it?`)) return;
    this.areas = this.areas.filter(a => a.id !== area.id);
    if (this.activeAreaId === area.id) {
      this.activeAreaId = null;
      this.areaStep = 'list';
      // The room being filled is the room that just went. There is nowhere
      // inside it to stand, so come out to the list.
      if (this.activeTab === 'area') this.activeTab = 'cart';
    }
    if (this.listAreaId === area.id) {
      this.listAreaId = null;
      this.cartStep = 'list';
    }
    this.saveCart();
  }

  /**
   * Steppers on a row of an area, which are only ever on the List tab — that is
   * where an area is read and corrected.
   */
  incrementAreaLine(index: number) {
    const area = this.listArea;
    if (!area) return;
    area.items[index].quantity += 1;
    this.saveCart();
  }

  decrementAreaLine(index: number) {
    const area = this.listArea;
    if (!area) return;
    if (area.items[index].quantity > 1) area.items[index].quantity -= 1;
    else area.items.splice(index, 1);
    this.saveCart();
  }

  removeAreaLine(index: number) {
    const area = this.listArea;
    if (!area) return;
    area.items.splice(index, 1);
    this.saveCart();
  }

  /** Tap the number on a row inside an area to type an exact quantity. */
  openNumpadForAreaLine(index: number) {
    const area = this.listArea;
    if (area) this.openNumpadForLine(index, area.items);
  }

  trackByAreaId(_index: number, area: PublicArea): string {
    return area.id;
  }

  // ---- Requesting a quotation for that list ----

  /**
   * Whether any room has been named. What splits the List tab in two: with no
   * rooms the flat list is simply the quotation and is titled that way, and the
   * visitor is never shown the word "area" at all.
   *
   * Named, not filled. It used to require a room with something IN it, which
   * meant that between naming a room and putting the first light in it the flat
   * list below still called itself "Your quotation list" — the same words the
   * rooms above it were already using. Two blocks, one heading, and no way to
   * tell which list the products at the bottom were in.
   */
  get hasRooms(): boolean {
    return this.areaAllowed && this.areas.length > 0;
  }

  /** Anything at all to send: rooms with something in them, loose lines, or both. */
  get hasSomethingToSend(): boolean {
    return this.cart.length > 0 || (this.areaAllowed && this.filledAreas.length > 0);
  }

  /**
   * What the callback form says is being priced, in the visitor's own terms:
   * the rooms they named, the products they picked loose, or both. Written out
   * rather than a count of "items" so what arrives matches what they built.
   */
  get sendSummary(): string {
    const rooms = this.areaAllowed ? this.filledAreas.length : 0;
    const products = this.cart.length;
    const roomText = rooms
      ? `all ${rooms} ${rooms === 1 ? 'area' : 'areas'}`
      : '';
    const productText = products
      ? `the ${products} ${products === 1 ? 'product' : 'products'} on your list`
      : '';
    if (roomText && productText) return `${roomText} and ${productText}`;
    return roomText || productText;
  }

  /** The bottom button: open the callback details on their own screen. */
  openQuoteRequest() {
    if (!this.hasSomethingToSend) {
      this.reqError = this.areaAllowed
        ? 'Add a few products first — to an area, or straight off the Products tab.'
        : '';
      return;
    }
    this.cartStep = 'form';
    this.reqError = '';
    this.scrollTop();
  }

  /**
   * Send the list.
   *
   * One button and one form for both kinds of link — what differs is only what
   * is being sent: a flat list of products, or that same list already split by
   * area. The two callback fields, the validation and the confirmation screen
   * are the same either way, because to the person filling them in it is the
   * same act.
   */
  async submitQuoteRequest() {
    if (this.reqSending) return;
    this.reqError = '';

    const filled = this.areaAllowed ? this.filledAreas : [];
    const loose = this.cart;

    if (!filled.length && !loose.length) {
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

    // The service drops any image that is the picture rather than a path to it.
    const asItem = (item: PublicCartItem): QuotationItem => ({
      name: item.name,
      quantity: item.quantity,
      ...(item.variant ? { variant: item.variant } : {}),
      ...(item.productId ? { sku: item.productId } : {}),
      ...(item.image ? { image: item.image } : {})
    });

    this.reqSending = true;
    try {
      if (filled.length) {
        // Room-by-room, which is what the area link exists for. Loose lines ride
        // along as one more group rather than a second document: a quotation
        // carrying both `items` and `areas` would be listed twice in the console
        // — once under Requests, once under Areas — and priced in one of them.
        const payload: QuotationArea[] = filled.map(area => ({
          name: area.name,
          items: area.items.map(asItem)
        }));
        if (loose.length) {
          payload.push({ name: this.LOOSE_GROUP_NAME, items: loose.map(asItem) });
        }
        await this.quotationService.submitAreaRequest(this.reqName.trim(), mobile, payload, this.ref);
      } else {
        // Nothing was put in a room, so there is nothing room-wise to say. Even
        // on an area link this goes over as an ordinary catalogue request and
        // is read in the console beside every other one.
        await this.quotationService.submitRequest(this.reqName.trim(), mobile, loose.map(asItem), this.ref);
      }
      this.areas = [];
      this.activeAreaId = null;
      this.listAreaId = null;
      this.cart = [];
      // Sent, so it is no longer theirs to edit — clearing it is also what stops
      // a second tap sending the same request twice.
      this.saveCart();
      this.cartStep = 'done';
      this.scrollTop();
    } catch (e) {
      console.warn('Quotation request notice:', (e as any)?.message || e);
      this.reqError = 'Could not send that just now. Please try again.';
    }
    this.reqSending = false;
  }

  /** Back to browsing, with the sent state cleared so a new list can be built. */
  startNewList() {
    this.cartStep = 'list';
    this.listAreaId = null;
    this.areaStep = 'list';
    this.activeAreaId = null;
    this.newAreaName = '';
    this.reqName = '';
    this.reqMobile = '';
    this.reqError = '';
    this.areaError = '';
    this.showHome();
    // Leaving the confirmation is the first safe moment to take a version that
    // arrived while they were filling the form in.
    this.applyUpdateWhenSafe();
  }

  // ---- Compare Quotation ----

  /**
   * Take whatever the visitor picked and turn it into one image.
   *
   * Most quotations arrive as a PDF, not a photo — that is simply how a supplier
   * sends one — so a PDF is accepted and drawn into an image here, page by page,
   * rather than being refused with "please send a screenshot". Everything
   * downstream (the admin's viewer, the Firestore document) then handles one
   * kind of thing: a picture.
   */
  onQuoteSelected(event: Event) {
    const input = event.target as HTMLInputElement;
    const file = input.files && input.files[0];
    input.value = '';
    if (!file) return;

    const isPdf = file.type === 'application/pdf' || /\.pdf$/i.test(file.name);
    if (!isPdf && !file.type.startsWith('image/')) {
      this.quoteError = 'Please choose a PDF, a photo or a screenshot of the quotation.';
      return;
    }

    this.quoteError = '';
    this.quoteReading = true;
    this.quotePageCount = 0;

    const done = (dataUrl: string, pages: number) => {
      this.quoteReading = false;
      this.quoteImage = dataUrl;
      this.quoteFileName = file.name || '';
      this.quotePageCount = pages;
    };
    const failed = (message: string) => {
      this.quoteReading = false;
      this.quoteError = message;
    };

    if (isPdf) {
      this.readPdf(file).then(r => done(r.dataUrl, r.pages)).catch(e => {
        console.warn('Quotation PDF notice:', (e as any)?.message || e);
        failed('That PDF could not be read. Please send a photo of it instead.');
      });
      return;
    }

    this.readImage(file).then(dataUrl => done(dataUrl, 0)).catch(e => {
      console.warn('Quotation image notice:', (e as any)?.message || e);
      failed(typeof e === 'string' ? e : 'That file could not be read. Please try another one.');
    });
  }

  /**
   * A photo or screenshot, downscaled to a data URL.
   *
   * A quotation is a page of small print, so it keeps far more resolution than a
   * banner would — but it still has to fit inside a single Firestore document
   * (there is no Storage bucket in this project), hence the step down through
   * lower JPEG qualities until it does.
   */
  private readImage(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
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
          const dataUrl = this.canvasToJpeg(canvas);
          if (!dataUrl) {
            reject('That file is too large. Please send a smaller photo.');
            return;
          }
          resolve(dataUrl);
        };
        img.onerror = () => reject('That file could not be read. Please try another one.');
        img.src = reader.result as string;
      };
      reader.onerror = () => reject('That file could not be read. Please try another one.');
      reader.readAsDataURL(file);
    });
  }

  /** How many pages of a PDF quotation are carried across. */
  private readonly MAX_PDF_PAGES = 4;

  /**
   * Draw a PDF quotation into a single tall image.
   *
   * Its pages are stacked one under another so the admin opens one picture and
   * scrolls it, exactly as they would a photo — nothing downstream has to learn
   * what a PDF is. Long documents are cut off at a few pages: the rates are on
   * the first page or two, and everything here has to survive a 1 MB Firestore
   * document.
   */
  private async readPdf(file: File): Promise<{ dataUrl: string; pages: number }> {
    const pdfjs = await this.loadPdfJs();
    const data = new Uint8Array(await file.arrayBuffer());
    const doc = await pdfjs.getDocument({ data }).promise;

    try {
      const pageCount = Math.min(doc.numPages, this.MAX_PDF_PAGES);
      const pages: HTMLCanvasElement[] = [];

      for (let n = 1; n <= pageCount; n++) {
        const page = await doc.getPage(n);
        const base = page.getViewport({ scale: 1 });
        // Render wide enough that small print survives, without going silly on
        // an already-large page.
        const scale = Math.max(0.8, Math.min(1600 / base.width, 2.2));
        const viewport = page.getViewport({ scale });

        const canvas = document.createElement('canvas');
        canvas.width = Math.round(viewport.width);
        canvas.height = Math.round(viewport.height);
        const ctx = canvas.getContext('2d');
        if (!ctx) throw new Error('Canvas unavailable');
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, canvas.width, canvas.height);

        await page.render({ canvas, canvasContext: ctx, viewport, background: '#ffffff' }).promise;
        pages.push(canvas);
      }

      if (!pages.length) throw new Error('Empty PDF');

      // Stack the pages into one sheet, with a hairline between them so it is
      // obvious where one page ends.
      const gap = 12;
      const width = Math.max(...pages.map(c => c.width));
      const height = pages.reduce((sum, c) => sum + c.height, 0) + gap * (pages.length - 1);

      const sheet = document.createElement('canvas');
      sheet.width = width;
      sheet.height = height;
      const sctx = sheet.getContext('2d');
      if (!sctx) throw new Error('Canvas unavailable');
      sctx.fillStyle = '#ffffff';
      sctx.fillRect(0, 0, width, height);

      let y = 0;
      for (const page of pages) {
        sctx.drawImage(page, Math.round((width - page.width) / 2), y);
        y += page.height;
        if (y < height) {
          sctx.fillStyle = '#d8d8dd';
          sctx.fillRect(0, y + gap / 2 - 1, width, 2);
          y += gap;
        }
      }

      const dataUrl = this.canvasToJpeg(sheet);
      if (!dataUrl) throw new Error('Too large');
      return { dataUrl, pages: pageCount };
    } finally {
      doc.destroy?.();
    }
  }

  /** pdf.js, pulled in only when a PDF is actually picked. */
  private async loadPdfJs(): Promise<any> {
    // @ts-ignore — pdf.js ships ESM only; the bundler resolves this, TS's
    // node10 resolution in this project does not.
    const pdfjs: any = await import('pdfjs-dist/build/pdf.mjs');
    if (!pdfjs.GlobalWorkerOptions.workerSrc) {
      // Against the document base, not the current URL: this page is opened at
      // /q-glaron, /catalogue/q-glaron and a few other shapes, and a relative
      // worker path would go looking under whichever one it happened to be.
      pdfjs.GlobalWorkerOptions.workerSrc = new URL('assets/pdf.worker.min.mjs', document.baseURI).href;
    }
    return pdfjs;
  }

  /**
   * Encode a canvas as a JPEG that fits inside a Firestore document.
   *
   * Quality comes down first, and only then the size — a slightly soft page of
   * text is still readable, a half-size one is not. Empty string if even that
   * is not enough.
   */
  private canvasToJpeg(canvas: HTMLCanvasElement): string {
    // A Firestore document caps out at 1 MB, so leave clear headroom.
    const budget = 700_000;
    let current = canvas;

    for (let attempt = 0; attempt < 4; attempt++) {
      for (const quality of [0.82, 0.72, 0.62, 0.5, 0.4]) {
        const dataUrl = current.toDataURL('image/jpeg', quality);
        if (dataUrl.length <= budget) return dataUrl;
      }
      // Still over: shrink and try the whole ladder again.
      const next = document.createElement('canvas');
      next.width = Math.max(1, Math.round(current.width * 0.75));
      next.height = Math.max(1, Math.round(current.height * 0.75));
      const ctx = next.getContext('2d');
      if (!ctx) break;
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, next.width, next.height);
      ctx.drawImage(current, 0, 0, next.width, next.height);
      current = next;
    }
    return '';
  }

  removeQuoteImage() {
    this.quoteImage = null;
    this.quoteFileName = '';
    this.quotePageCount = 0;
    this.quoteError = '';
  }

  /** The upload screen's button: on to the two callback fields. */
  openCompareDetails() {
    if (!this.quoteImage) {
      this.quoteError = 'Please attach the quotation first.';
      return;
    }
    this.quoteError = '';
    this.compareStep = 'form';
    this.scrollTop();
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
      this.compareStep = 'upload';
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
      this.compareStep = 'done';
      this.scrollTop();
    } catch (e) {
      console.warn('Quotation submit notice:', (e as any)?.message || e);
      this.quoteError = 'Could not send that just now. Please try again.';
    }
    this.quoteSending = false;
  }

  /** Reset the form so the same visitor can send a second quotation. */
  sendAnotherQuote() {
    this.compareStep = 'upload';
    this.quoteImage = null;
    this.quoteFileName = '';
    this.quotePageCount = 0;
    this.quoteName = '';
    this.quoteMobile = '';
    this.quoteError = '';
    this.scrollTop();
    this.applyUpdateWhenSafe();
  }
}
