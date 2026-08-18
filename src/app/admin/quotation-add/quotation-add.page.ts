import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { IonContent } from '@ionic/angular/standalone';
import { ProductService, Product, ProductVariant } from '../product.service';
import { QuotationDraftService } from '../quotations/quotation-draft.service';
import { orderRefDigits } from '../../order-ref';
import { inr } from '../quotations/quotation-pdf';
import { SpecTab, SpecTabState, orderableLightColours, lightColourSwatch } from '../product-spec-tabs';

/**
 * Putting products on a quotation — the same screen adding products to an
 * order gives you, and deliberately so: one way of picking products in this
 * console, whichever document is being built.
 *
 * Every tap goes straight onto the quotation, which is held in
 * QuotationDraftService, so Done is a way back rather than a save.
 */
@Component({
  selector: 'app-quotation-add',
  templateUrl: './quotation-add.page.html',
  styleUrls: ['./quotation-add.page.scss'],
  standalone: true,
  imports: [CommonModule, FormsModule, IonContent]
})
export class QuotationAddPage {

  // The box of colour drawn before a light colour name. Worked out from the
  // name itself, so a shade added today is painted without a code change.
  swatch(colour: string): string {
    return lightColourSwatch(colour);
  }

  id = '';
  productSearch = '';

  constructor(
    private route: ActivatedRoute,
    private router: Router,
    private productService: ProductService,
    public draft: QuotationDraftService
  ) {
    this.id = this.route.snapshot.paramMap.get('id') || '';
    // Keeps whatever is already on this quotation; only a different one resets.
    this.draft.use(this.id);
  }

  get quoteRef(): string {
    return `QTN - ${orderRefDigits(this.id)}`;
  }

  get products(): Product[] {
    const q = this.productSearch.trim().toLowerCase();
    const list = this.productService.products;
    if (!q) return list;
    return list.filter(p =>
      p.name.toLowerCase().includes(q) ||
      p.id.toLowerCase().includes(q) ||
      (p.category || '').toLowerCase().includes(q)
    );
  }

  // ---- Wattage / dimension tabs ----
  // The same card the dealer app and the catalogue link show: the two specs a
  // fitting is picked by as tabs, and under the open one every light colour
  // with its own quantity. A product with no wattage and no dimension keeps
  // the plain rows below.
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

  productLightColours(product: Product, variant?: ProductVariant): string[] {
    return orderableLightColours(product, variant);
  }

  /** Everything quoted under one wattage tab, across all of its shades. */
  tabTotalQty(product: Product, tab: SpecTab): number {
    const colours = this.productLightColours(product, tab.variant);
    if (!colours.length) return this.quantityOf(product, tab.variant);
    return colours.reduce((sum, c) => sum + this.quantityOf(product, tab.variant, c), 0);
  }

  variantLabel(v: ProductVariant): string {
    return this.draft.variantLabel(v);
  }

  unitPrice(product: Product, variant?: ProductVariant, lightColour?: string): number {
    return this.draft.unitPrice(product, variant, lightColour);
  }

  quantityOf(product: Product, variant?: ProductVariant, lightColour?: string): number {
    return this.draft.quantityOf(product, variant, lightColour);
  }

  add(product: Product, variant?: ProductVariant, lightColour?: string) {
    this.draft.add(product, variant, lightColour);
  }

  remove(product: Product, variant?: ProductVariant, lightColour?: string) {
    this.draft.remove(product, variant, lightColour);
  }

  money(value: number): string {
    return inr(value);
  }

  onImgError(event: Event) {
    const target = event.target as HTMLElement | null;
    if (target) target.style.display = 'none';
  }

  trackByProductId(_index: number, product: Product): string {
    return product.id;
  }

  trackByVariantIndex(index: number): number {
    return index;
  }

  /** Back to the quotation, which has been carrying every tap all along. */
  done() {
    this.router.navigate(['/admin/quotations/requests', this.id]);
  }
}
