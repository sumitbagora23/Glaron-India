import { Injectable, inject } from '@angular/core';
import { ProductService, Product, ProductVariant } from '../product.service';
import { QuotationItem } from '../quotation.service';
import { lightColourCatalogPrice } from '../product-spec-tabs';

/** One priced line of the quotation being worked on. */
export interface QuoteLine {
  /** Product + variant, so adding the same variant twice adds to one line. */
  key: string;
  name: string;
  variant: string;
  sku: string;
  image: string;
  /**
   * The catalogue's list price for one unit. Fixed: never edited, never
   * discounted. It is what the quoted price is measured against, so it has to
   * stay put or the discount beside it means nothing.
   */
  mrp: number;
  /**
   * What this line is actually quoted at. Starts equal to the MRP, then moves —
   * either because a discount was applied across the quotation, or because this
   * one product was given its own price by hand.
   */
  price: number;
  quantity: number;
}

/**
 * The quotation an admin is putting together, held between two screens.
 *
 * Pricing a request happens on one page and adding products on another — the
 * same split orders use — so the working list cannot live on either of them or
 * it would be lost on the way. It lives here instead, keyed to the quotation
 * being worked on: open a different one and the draft starts again.
 *
 * Nothing here is written to Firestore. What the customer sent stays as they
 * sent it; the priced version leaves as a PDF.
 */
@Injectable({ providedIn: 'root' })
export class QuotationDraftService {
  private products = inject(ProductService);

  /** Which quotation this draft belongs to. */
  private id = '';
  private seeded = false;

  lines: QuoteLine[] = [];

  /**
   * One discount, as a percentage, across every product on the quotation.
   *
   * Percent only, and never per line: a customer reads "10% off" and can check
   * any row of the document against it. A rupee figure spread over mixed
   * quantities cannot be checked that way.
   */
  discountValue = 0;

  /**
   * Point the draft at a quotation. Switching to another one throws the old
   * working list away; coming back to the same one keeps it, which is what
   * makes the trip to the add-products page and back lossless.
   */
  use(id: string) {
    if (this.id === id) return;
    this.id = id;
    this.seeded = false;
    this.lines = [];
    this.discountValue = 0;
  }

  get isSeeded(): boolean {
    return this.seeded;
  }

  /** Fill the draft from what the customer asked for. Only ever done once. */
  seedFrom(items: QuotationItem[] | undefined) {
    this.lines = (items || []).map(item => this.lineFromItem(item));
    this.seeded = true;
  }

  // ---- Pricing ----

  /**
   * The same descriptor the public catalogue builds, so a variant sent from
   * there can be matched back to the one in the catalogue and priced.
   */
  /** `omitBodyColour` drops the imported finish LIST once one has been chosen. */
  variantLabel(variant: ProductVariant, omitBodyColour = false): string {
    const parts: string[] = [];
    const isBad = (v?: string) => !v || !v.trim() || /dimension/i.test(v);

    if (!isBad(variant.wattage)) parts.push(variant.wattage!.trim());
    if (variant.type && variant.type.trim()) parts.push(variant.type.trim());

    if (variant.dimension && variant.dimension.trim() && variant.dimension.trim() !== '-') {
      const d = variant.dimension.trim();
      parts.push(/mm/i.test(d) ? d : `${d} mm`);
    }

    // The finish is no longer part of the option's own descriptor: it is
    // chosen per line and appended by lineLabel() above, so an option reads
    // "7W · 60*70 mm" and the line reads "7W · 60*70 mm · BK/GBK".
    if (parts.length === 0) parts.push('Variant');
    return parts.join(' · ');
  }

  /** What one unit of a variant costs, falling back to the product's own price. */
  unitPrice(product: Product, variant?: ProductVariant, lightColour?: string): number {
    // A shade priced on its own IS the price, not a surcharge on top of the
    // option's — the same rule the dealer card and the cart follow. An option
    // that prices the shade itself wins over the product's price for it.
    const own = lightColour ? lightColourCatalogPrice(product, lightColour, variant) : 0;
    if (own > 0) return own;
    return variant
      ? (variant.price || variant.pricePerMtr || product.price || 0)
      : (product.price || 0);
  }

  /**
   * The option, the finish and the shade, as one descriptor — what the
   * document prints.
   *
   * `bodyColour` is the finish that was actually chosen. When one is passed,
   * the variant's own body-colour text is left out of the label: that text is
   * the LIST of finishes the import recorded ("BK/WH + GBK/RG"), so printing it
   * beside the chosen one would read as a contradiction.
   */
  lineLabel(variant?: ProductVariant, lightColour?: string, bodyColour?: string): string {
    const label = variant ? this.variantLabel(variant, !!bodyColour) : '';
    return [label, bodyColour || '', lightColour || ''].filter(p => p && p.trim()).join(' · ');
  }

  private productFor(sku: string): Product | undefined {
    return sku ? this.products.products.find(p => p.id === sku) : undefined;
  }

  /**
   * Price a line the customer picked out of the catalogue.
   *
   * The variant they chose decides it, matched by the label they were shown.
   * Zero means the catalogue holds no price for it, and the MRP box on screen
   * is left for the admin to fill in.
   *
   * Public because the area-wise draft prices its lines exactly this way; there
   * must be one rule for what a picked line costs, not two.
   */
  lineFromItem(item: QuotationItem): QuoteLine {
    const sku = item.sku || '';
    const label = item.variant || '';
    const product = this.productFor(sku);

    let variant = (product?.variants || []).find(v => this.variantLabel(v) === label);
    let colour = '';

    // No exact match: the trailing segment may be the shade that was asked for.
    if (!variant && product && label.includes(' · ')) {
      const cut = label.lastIndexOf(' · ');
      const tail = label.slice(cut + 3).trim();
      if ((product.lightColours || []).includes(tail)) {
        const head = label.slice(0, cut);
        colour = tail;
        variant = (product.variants || []).find(v => this.variantLabel(v) === head);
      }
    }

    // A product with no options at all can still be asked for in a shade.
    if (!variant && !colour && product && (product.lightColours || []).includes(label)) {
      colour = label;
    }

    return {
      key: sku + '::' + label,
      name: item.name || product?.name || 'Product',
      variant: label,
      sku,
      image: product?.image || item.image || '',
      mrp: product ? this.unitPrice(product, variant, colour) : 0,
      price: product ? this.unitPrice(product, variant, colour) : 0,
      quantity: Math.max(1, Number(item.quantity) || 1)
    };
  }

  // ---- Editing ----

  // The shade is part of the key, so one option quoted in two colours is two
  // lines — exactly what the catalogue link and the dealer app now send.
  // The finish parts the lines the same way the shade does — six black and
  // four white is two rows — but unlike the shade it never reaches unitPrice()
  // below, because a finish does not move the price.
  key(product: Product, variant?: ProductVariant, lightColour?: string, bodyColour?: string): string {
    return product.id + '::' + this.lineLabel(variant, lightColour, bodyColour);
  }

  /** How many of this exact line are on the quotation already. */
  quantityOf(product: Product, variant?: ProductVariant, lightColour?: string, bodyColour?: string): number {
    const key = this.key(product, variant, lightColour, bodyColour);
    return this.lines.find(l => l.key === key)?.quantity || 0;
  }

  /** Put one more of this line on, or start it at one. */
  add(product: Product, variant?: ProductVariant, lightColour?: string, bodyColour?: string) {
    const key = this.key(product, variant, lightColour, bodyColour);
    const line = this.lines.find(l => l.key === key);
    if (line) {
      line.quantity += 1;
      return;
    }
    this.lines = [...this.lines, {
      key,
      name: product.name,
      variant: this.lineLabel(variant, lightColour, bodyColour),
      sku: product.id,
      image: product.image || '',
      mrp: this.unitPrice(product, variant, lightColour),
      price: this.unitPrice(product, variant, lightColour),
      quantity: 1
    }];
  }

  /** One fewer, and off the quotation entirely at zero. */
  remove(product: Product, variant?: ProductVariant, lightColour?: string, bodyColour?: string) {
    const key = this.key(product, variant, lightColour, bodyColour);
    const index = this.lines.findIndex(l => l.key === key);
    if (index < 0) return;
    if (this.lines[index].quantity > 1) this.lines[index].quantity -= 1;
    else this.lines = this.lines.filter((_, i) => i !== index);
  }

  removeLine(line: QuoteLine) {
    this.lines = this.lines.filter(l => l !== line);
  }

  // ---- What it comes to ----

  /** The discount as a number between 0 and 100. */
  get discountPercent(): number {
    const value = Number(this.discountValue) || 0;
    return Math.min(Math.max(value, 0), 100);
  }

  get discountLabel(): string {
    return this.discountPercent > 0 ? `${this.discountPercent}%` : '';
  }

  /**
   * Take the discount off every product.
   *
   * This is what the Apply button does, and it writes the result into the price
   * of each line rather than working it out again on every render. The MRP is
   * left exactly as it was: the discount moves the price column, never the list
   * price it is measured against — so applying 10% twice cannot compound.
   */
  applyDiscount() {
    const pct = this.discountPercent;
    for (const line of this.lines) {
      // Whole rupees. A fractional price would be shown rounded on screen and
      // in the document while the arithmetic ran on the fraction, so a rate of
      // 607 against 12 units could print an amount of 7,286 instead of 7,284.
      // Rounding once, here, is what keeps every figure tying out.
      line.price = Math.round((line.mrp || 0) * (100 - pct) / 100);
    }
  }

  /** What one unit is quoted at. */
  netPrice(line: QuoteLine): number {
    return line.price || 0;
  }

  /** What this line ended up discounted by, whatever moved its price. */
  linePercent(line: QuoteLine): number {
    if (!line.mrp || line.price >= line.mrp) return 0;
    return Math.round((1 - line.price / line.mrp) * 100);
  }

  /** MRP × quantity — what the line would come to at list price. */
  lineMrpTotal(line: QuoteLine): number {
    return (line.mrp || 0) * (line.quantity || 0);
  }

  /**
   * What the line is quoted at — rounded here, so that the total is the sum of
   * the amounts actually printed rather than of the figures behind them. The
   * list, the footer and the PDF all add up the same way because they all add
   * up this.
   */
  lineTotal(line: QuoteLine): number {
    return Math.round((line.price || 0) * (line.quantity || 0));
  }

  get itemCount(): number {
    return this.lines.reduce((sum, l) => sum + (l.quantity || 0), 0);
  }

  /** The whole quotation at list price. */
  get subtotal(): number {
    return this.lines.reduce((sum, l) => sum + this.lineMrpTotal(l), 0);
  }

  /** What comes off, which is simply the difference the percentage makes. */
  get discount(): number {
    return this.subtotal - this.total;
  }

  get total(): number {
    return this.lines.reduce((sum, l) => sum + this.lineTotal(l), 0);
  }

  /** Lines the catalogue has no price for — they would print as zero. */
  get unpricedCount(): number {
    return this.lines.filter(l => !l.mrp).length;
  }
}
