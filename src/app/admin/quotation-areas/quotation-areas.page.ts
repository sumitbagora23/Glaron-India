import { Component, OnInit, effect, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { IonContent } from '@ionic/angular/standalone';
import { QuotationService, CustomerQuotation } from '../quotation.service';
import { QuoteLine } from '../quotations/quotation-draft.service';
import { AreaQuoteDraftService, AreaGroup, MergedLine } from '../quotations/area-draft.service';
import { orderableBodyColours } from '../body-colours';
import { ProductService, Product, ProductVariant } from '../product.service';
import { CategoryService, Category } from '../category.service';
import { orderRefDigits } from '../../order-ref';
import { lightColourSwatch, splitLightColourLabel } from '../light-colours';
import { LightColourService } from '../light-colour.service';
import {
  createQuotationPdf, createAreaSummaryPdf, quotationFileName, areaListFileName, inr
} from '../quotations/quotation-pdf';

/**
 * An area-wise request, opened in full.
 *
 * The customer sent the job room by room, and this page keeps it that way from
 * the first screen to the PDF. It opens on the areas themselves — a card each,
 * with what is in it and what it comes to — and opening one shows that room's
 * products in full, priced, with everything the flat quotation page offers:
 * products added, quantities changed, a price set by hand, one discount across
 * the job.
 *
 * Three documents come off it, which is the point of the split:
 *
 *   • Create PDF — every area and what goes in it, pictured, no money anywhere.
 *     The sheet that gets checked against the site.
 *   • Generate Quotation PDF — the same products priced, on Glaron's paper.
 *   • Without Logo — the same priced document with nothing of Glaron on it, for
 *     a quotation that is going to be passed on further.
 *
 * The working copy lives in AreaQuoteDraftService; nothing is written back to
 * what the customer sent.
 */
@Component({
  selector: 'app-quotation-areas',
  templateUrl: './quotation-areas.page.html',
  styleUrls: ['./quotation-areas.page.scss'],
  standalone: true,
  imports: [CommonModule, FormsModule, IonContent]
})
export class QuotationAreasPage implements OnInit {

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

  id = '';

  /**
   * Which of the three screens is on.
   *
   *   • areas — the summary: a card per room, tapped to open one
   *   • area  — one room in full, its products priced
   *   • final — every product of every area in one table, which is the
   *             Request Quotation page exactly, with the room named on each row
   *
   * The two buttons at the top switch between the summary and the final list;
   * the room screen is reached by opening a card.
   */
  view: 'areas' | 'area' | 'final' = 'areas';
  openGroupId = '';

  /** Which area the picker is adding into. */
  pickGroupId = '';

  building = false;

  /**
   * Which document is being built, so only the button that was pressed says so.
   * Three of them share this footer and a blanket "Creating…" on all three
   * leaves nobody sure which one they asked for.
   */
  buildingKind: '' | 'list' | 'quote' | 'plain' = '';

  error = '';

  /** Off by default, for the same reason as on a flat quotation. */
  editPrices = false;

  /** What the last Apply did, shown beside the button until the next change. */
  applied = '';

  /** The add-products sheet, and what is typed in its search box. */
  picking = false;
  productSearch = '';

  /**
   * The category the picker is narrowed to, and the sheet that sets it.
   *
   * A room is filled from a range of a few hundred pieces, and typing a word is
   * only half of finding one — the other half is "show me the cove profiles".
   * The sheet picks that from the category tiles rather than a drop-down of
   * names, because a category is recognised by its picture first.
   */
  selectedCategory = 'All Categories';
  showCategorySheet = false;
  /** Narrows the sheet itself; there are more categories than fit on a screen. */
  categorySheetQuery = '';

  /** Naming an area the customer did not send. */
  newAreaName = '';

  private pdfUrl: string | null = null;

  constructor(
    private route: ActivatedRoute,
    private router: Router,
    private quotationService: QuotationService,
    private productService: ProductService,
    private categoryService: CategoryService,
    public draft: AreaQuoteDraftService
  ) {
    this.id = this.route.snapshot.paramMap.get('id') || '';
    this.draft.use(this.id);

    // The feed arrives after the page does, so the draft is seeded the moment
    // the request shows up — and only ever once, or an edit would be wiped by
    // the next snapshot.
    effect(() => {
      const q = this.quotationService.quotations.find(item => item.id === this.id);
      if (q && !this.draft.isSeeded) this.draft.seedFromRequest(q);
    });
  }

  ngOnInit() {
    this.quotationService.start();
  }

  // ---- The request behind it ----

  get quotation(): CustomerQuotation | undefined {
    return this.quotationService.quotations.find(q => q.id === this.id);
  }

  get groups(): AreaGroup[] {
    return this.draft.groups;
  }

  get openGroup(): AreaGroup | undefined {
    return this.draft.group(this.openGroupId);
  }

  /** Short label, the same shape orders and quotations use: `QTN - 417`. */
  get quoteRef(): string {
    return `QTN - ${orderRefDigits(this.id)}`;
  }

  get customerName(): string {
    return this.quotation?.name || 'Customer';
  }

  get customerMobile(): string {
    const digits = (this.quotation?.mobile || '').replace(/\D/g, '');
    return digits.length === 10 ? `${digits.slice(0, 5)} ${digits.slice(5)}` : digits;
  }

  callHref(): string {
    return 'tel:+91' + (this.quotation?.mobile || '').replace(/\D/g, '').slice(-10);
  }

  get loading(): boolean {
    return !this.quotation && !this.draft.isSeeded;
  }

  // ---- Moving between the two screens ----

  openArea(group: AreaGroup) {
    this.openGroupId = group.id;
    this.view = 'area';
    this.applied = '';
  }

  backToAreas() {
    this.view = 'areas';
    this.openGroupId = '';
    this.picking = false;
  }

  /** The top-left button: the areas, as cards. */
  showSummary() {
    this.backToAreas();
  }

  /** The top-right button: every product of every area, in one table. */
  showFinal() {
    this.view = 'final';
    this.openGroupId = '';
    this.picking = false;
    this.applied = '';
  }

  /**
   * The whole job as one list of products, the same fitting appearing once
   * however many rooms asked for it.
   *
   * Two areas wanting the same product used to print two rows of the final
   * quotation, and a customer reading it counted the product twice. They are
   * one row now, quantities added up, each row still holding on to the area
   * lines behind it so an edit here lands where it came from.
   */
  get allLines(): MergedLine[] {
    return this.draft.mergedLines;
  }

  removeRow(row: MergedLine) {
    this.draft.removeMerged(row);
  }

  trackByRow(_index: number, row: MergedLine): string {
    return row.key;
  }

  addArea() {
    const name = this.newAreaName.trim();
    if (!name) return;
    const group = this.draft.addGroup(name);
    this.newAreaName = '';
    this.openArea(group);
  }

  removeArea(group: AreaGroup, event: Event) {
    event.stopPropagation();
    const count = this.draft.groupCount(group);
    if (count > 0 && !confirm(`Remove ${group.name} and the ${count} ${count === 1 ? 'piece' : 'pieces'} in it from this quotation?`)) return;
    this.draft.removeGroup(group);
    if (this.openGroupId === group.id) this.backToAreas();
  }

  // ---- Editing the lines of the open area ----

  inc(line: QuoteLine) {
    line.quantity += 1;
  }

  dec(line: QuoteLine) {
    if (line.quantity > 1) line.quantity -= 1;
  }

  onQtyInput(line: QuoteLine, value: string) {
    const n = Math.floor(Number(value));
    line.quantity = n > 0 ? n : 1;
  }

  /** The quoted price for one product, set by hand. The MRP beside it stands. */
  onPriceInput(line: QuoteLine, value: string) {
    const n = Math.round(Number(value));
    line.price = n > 0 ? n : 0;
  }

  onMrpInput(line: QuoteLine, value: string) {
    const n = Math.round(Number(value));
    line.mrp = n > 0 ? n : 0;
  }

  removeLine(line: QuoteLine) {
    const group = this.openGroup;
    if (group) this.draft.removeLine(group, line);
  }

  // ---- The same edits, made on a merged row of the final list ----

  incRow(row: MergedLine) {
    this.draft.incMerged(row);
  }

  decRow(row: MergedLine) {
    this.draft.decMerged(row);
  }

  onRowQtyInput(row: MergedLine, value: string) {
    this.draft.setMergedQuantity(row, Number(value));
  }

  onRowPriceInput(row: MergedLine, value: string) {
    this.draft.setMergedPrice(row, Number(value));
  }

  onRowMrpInput(row: MergedLine, value: string) {
    this.draft.setMergedMrp(row, Number(value));
  }

  toggleEditPrices() {
    this.editPrices = !this.editPrices;
    this.applied = '';
  }

  /**
   * One Apply for both ways of pricing, exactly as on a flat quotation: a
   * percentage off every MRP, or the figures typed into the price column.
   */
  apply() {
    if (this.draft.discountPercent > 0) {
      this.draft.applyDiscount();
      this.applied = `${this.draft.discountPercent}% applied across every area`;
    } else if (this.editPrices) {
      this.applied = 'Prices updated';
    } else {
      this.draft.applyDiscount();
      this.applied = 'Prices reset to MRP';
    }
    this.editPrices = false;
  }

  // ---- Adding products into an area ----

  /**
   * Open the picker.
   *
   * Inside a room it fills that room. On the final list there is no room in
   * context, so one is chosen in the sheet itself — a product has to go
   * somewhere, and picking it first is what stops it landing in the wrong
   * place.
   */
  openPicker() {
    if (!this.draft.groups.length) return;
    this.pickGroupId = this.openGroupId || this.draft.groups[0].id;
    this.productSearch = '';
    this.selectedCategory = 'All Categories';
    this.picking = true;
  }

  /** The area the picker is filling. */
  get pickGroup(): AreaGroup | undefined {
    return this.draft.group(this.pickGroupId);
  }

  closePicker() {
    this.picking = false;
  }

  /** The whole range, before either the word or the category narrows it. */
  get allProducts(): Product[] {
    return this.productService.products;
  }

  get pickerProducts(): Product[] {
    let list = this.allProducts;

    if (this.categoryFilterActive) {
      const target = this.selectedCategory.toLowerCase();
      list = list.filter(p => (p.category || '').toLowerCase().includes(target));
    }

    const q = this.productSearch.trim().toLowerCase();
    if (!q) return list;
    return list.filter(p =>
      p.name.toLowerCase().includes(q) ||
      p.id.toLowerCase().includes(q) ||
      (p.category || '').toLowerCase().includes(q)
    );
  }

  clearProductSearch() {
    this.productSearch = '';
  }

  // ---- Narrowing the picker to one category ----

  /** Whether the picker is showing one category rather than the whole range. */
  get categoryFilterActive(): boolean {
    return this.selectedCategory !== 'All Categories';
  }

  /** The tiles the sheet shows, narrowed by its own search box. */
  get sheetCategories(): Category[] {
    const q = this.categorySheetQuery.trim().toLowerCase();
    const list = this.categoryService.categories;
    return q ? list.filter(c => c.name.toLowerCase().includes(q)) : list;
  }

  /**
   * How many products sit in a category — the number on each tile, counted the
   * same way `pickerProducts` narrows the list, so the tile and what appears
   * after tapping it never disagree.
   *
   * Held against the size of the catalogue rather than recounted on every
   * change-detection pass: it runs categories × products and the sheet draws
   * every tile at once.
   */
  private catCountCache: { size: number; map: Record<string, number> } = { size: -1, map: {} };

  categoryCount(name: string): number {
    const products = this.allProducts;
    if (this.catCountCache.size !== products.length) {
      const map: Record<string, number> = {};
      for (const cat of this.categoryService.categories) {
        const target = cat.name.toLowerCase();
        map[target] = products.filter(p => (p.category || '').toLowerCase().includes(target)).length;
      }
      this.catCountCache = { size: products.length, map };
    }
    return this.catCountCache.map[name.trim().toLowerCase()] || 0;
  }

  openCategorySheet() {
    this.categorySheetQuery = '';
    this.showCategorySheet = true;
  }

  closeCategorySheet() {
    this.showCategorySheet = false;
  }

  clearCategorySheetSearch() {
    this.categorySheetQuery = '';
  }

  /** Picking a category closes the sheet; the picker below is already narrowed. */
  pickCategory(name: string) {
    this.selectedCategory = name;
    this.showCategorySheet = false;
  }

  /** The cross on the chip: back to the whole range, sheet left alone. */
  clearCategoryFilter() {
    this.selectedCategory = 'All Categories';
  }

  trackByCategoryId(_index: number, category: Category): string {
    return category.id;
  }

  variantLabel(v: ProductVariant, omitBodyColour = false): string {
    return this.draft.variantLabel(v, omitBodyColour);
  }

  unitPrice(product: Product, variant?: ProductVariant): number {
    return this.draft.unitPrice(product, variant);
  }

  quantityOf(product: Product, variant?: ProductVariant): number {
    const group = this.pickGroup;
    return group ? this.draft.quantityOf(group, product, variant, this.activeBodyColour(product)) : 0;
  }

  addProduct(product: Product, variant?: ProductVariant) {
    const group = this.pickGroup;
    if (group) this.draft.add(group, product, variant, this.activeBodyColour(product));
  }

  removeProduct(product: Product, variant?: ProductVariant) {
    const group = this.pickGroup;
    if (group) this.draft.remove(group, product, variant, this.activeBodyColour(product));
  }

  // ---- Body colour ----
  //
  // The finish is chosen once per product in the picker and applies to whatever
  // variant is stepped under it, so the admin picks "black" and then the
  // wattages, exactly as the customer does on the catalogue card.
  private openBodyColourByProduct: { [productId: string]: string } = {};

  trackByBodyColour = (_: number, colour: string) => colour;

  /** The finishes this product is sold in — empty when there is no choice. */
  productBodyColours(product: Product): string[] {
    const colours = orderableBodyColours(product);
    return colours.length > 1 ? colours : [];
  }

  /** Undefined when there is no choice, which keeps the line exactly as before. */
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

  // ---- Small helpers ----

  money(value: number): string {
    return inr(value);
  }

  onImgError(event: Event) {
    const target = event.target as HTMLElement | null;
    if (target) target.style.display = 'none';
  }

  trackByKey(_index: number, line: QuoteLine): string {
    return line.key;
  }

  trackByGroupId(_index: number, group: AreaGroup): string {
    return group.id;
  }

  trackByProductId(_index: number, product: Product): string {
    return product.id;
  }

  trackByVariantIndex(index: number): number {
    return index;
  }

  get canBuild(): boolean {
    return this.draft.lineCount > 0 && !this.building;
  }

  // ---- The two documents ----

  /** Every area, what is in it and what it looks like, with no money on it. */
  createPdf() {
    return this.build('list');
  }

  /**
   * The priced document — one flat list of products, exactly the quotation a
   * Request Quotation makes.
   *
   * The areas are not on it. They did their job on the way here (they are how
   * the job was collected, and they are what the product list prints); the
   * document that goes to the customer with money on it is the same document
   * every other customer gets.
   */
  generateQuotationPdf() {
    return this.build('quote');
  }

  /**
   * The same priced quotation, unsigned — no mark, no wordmark, nothing of
   * Glaron in the footer, the properties or the file name.
   *
   * It is the document a dealer forwards under their own name. The figures and
   * the layout are identical; the only thing that changes is whose paper it
   * looks like it came off.
   */
  generatePlainQuotationPdf() {
    return this.build('plain');
  }

  /**
   * Build one of the three documents, open it, and leave a copy saved.
   *
   * The tab is claimed before anything is awaited: a browser only allows
   * window.open while it is still handling the click, so opening it after the
   * document is drawn is what gets blocked.
   */
  private async build(kind: 'list' | 'quote' | 'plain') {
    if (!this.canBuild) return;
    this.building = true;
    this.buildingKind = kind;
    this.error = '';

    const tab = window.open('', '_blank');
    const quoteNo = this.quoteRef.replace(/\s/g, '');

    const payload = {
      // So the shade at the end of a line is drawn with its box of colour,
      // on the product list and on the priced document alike.
      lightColourNames: this.lightColourNames.names,
      quoteNo,
      dateLabel: new Date().toLocaleDateString('en-IN', {
        day: '2-digit', month: 'short', year: 'numeric'
      }),
      customerName: this.customerName,
      customerMobile: (this.quotation?.mobile || '').replace(/\D/g, ''),
      areas: this.draft.groups
        // An area nobody put anything in has nothing to print.
        .filter(g => g.lines.length)
        .map(g => ({
          name: g.name,
          lines: g.lines.map(l => ({
            name: l.name,
            variant: l.variant,
            sku: l.sku,
            // Carried for the product list, which prints it. The priced
            // document takes the same lines and simply never draws it.
            image: l.image,
            mrp: l.mrp,
            rate: this.draft.netPrice(l),
            quantity: l.quantity
          }))
        })),
      discountLabel: this.draft.discountLabel,
      subtotal: this.draft.subtotal,
      discount: this.draft.discount,
      total: this.draft.total
    };

    try {
      const branded = kind !== 'plain';
      const blob = kind === 'list'
        ? await createAreaSummaryPdf(payload)
        : await createQuotationPdf({
            lightColourNames: payload.lightColourNames,
            quoteNo: payload.quoteNo,
            dateLabel: payload.dateLabel,
            customerName: payload.customerName,
            customerMobile: payload.customerMobile,
            discountPercent: this.draft.discountPercent,
            // One row per product, in the order the areas are shown — so the
            // document reads in the order the job was built, and a fitting two
            // rooms asked for is quoted once, for the two of them together.
            lines: this.draft.mergedLines.map(row => ({
              name: row.name,
              variant: row.variant,
              sku: row.sku,
              image: row.image,
              mrp: row.mrp,
              rate: row.price,
              quantity: row.quantity
            })),
            subtotal: this.draft.subtotal,
            discountLabel: this.draft.discountLabel,
            discount: this.draft.discount,
            total: this.draft.total
          }, { branded });

      if (this.pdfUrl) URL.revokeObjectURL(this.pdfUrl);
      this.pdfUrl = URL.createObjectURL(blob);

      const a = document.createElement('a');
      a.href = this.pdfUrl;
      a.download = kind === 'list'
        ? areaListFileName(quoteNo, this.customerName)
        : quotationFileName(quoteNo, this.customerName, branded);
      a.click();

      if (tab) tab.location.href = this.pdfUrl;
      else window.open(this.pdfUrl, '_blank', 'noopener');
    } catch (err) {
      console.warn('Area quotation PDF notice:', (err as any)?.message || err);
      this.error = 'The PDF could not be built. Please try again.';
      tab?.close();
    } finally {
      this.building = false;
      this.buildingKind = '';
    }
  }

  back() {
    this.router.navigate(['/admin/quotations/requests']);
  }
}
