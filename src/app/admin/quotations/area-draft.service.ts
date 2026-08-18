import { Injectable, inject } from '@angular/core';
import { ProductService, Product, ProductVariant } from '../product.service';
import { QuotationArea } from '../quotation.service';
import { QuotationDraftService, QuoteLine } from './quotation-draft.service';

/** One area of the job being priced, with its own lines. */
export interface AreaGroup {
  /** Local id, so two areas named the same stay two areas. */
  id: string;
  name: string;
  lines: QuoteLine[];
}

/**
 * One product of the whole job, however many areas asked for it.
 *
 * The final quotation is a list of products, not a list of rooms: the same
 * fitting wanted in the kitchen and in two bedrooms is one row of three, never
 * three rows of one. `sources` remembers which area lines that row stands for,
 * so a quantity changed or a line deleted on the final list still lands in the
 * rooms it came from.
 */
export interface MergedLine {
  key: string;
  name: string;
  variant: string;
  sku: string;
  image: string;
  mrp: number;
  /** Unit price for the row — worked back from what the areas come to. */
  price: number;
  quantity: number;
  /** The area lines behind this row, in the order the areas are shown. */
  sources: { group: AreaGroup; line: QuoteLine }[];
}

/**
 * The area-wise quotation an admin is putting together.
 *
 * The same job as QuotationDraftService — catalogue price on every line, a
 * discount across the lot, quantities edited by hand — except the lines are
 * kept in the areas the customer sent them in, and never flattened. That
 * grouping is the whole point of the area-wise link: the document that goes
 * back has to be readable room by room, and a total per room is what a customer
 * building a house actually asks about.
 *
 * Nothing here is written to Firestore. What the customer sent stays as they
 * sent it; the priced version leaves as a PDF.
 */
@Injectable({ providedIn: 'root' })
export class AreaQuoteDraftService {
  private products = inject(ProductService);
  /** The pricing rules are the same as a flat quotation's, so they are shared. */
  private base = inject(QuotationDraftService);

  private id = '';
  private seeded = false;

  groups: AreaGroup[] = [];

  /** One discount, as a percentage, across every product in every area. */
  discountValue = 0;

  /** Point the draft at a quotation. A different one starts again. */
  use(id: string) {
    if (this.id === id) return;
    this.id = id;
    this.seeded = false;
    this.groups = [];
    this.discountValue = 0;
  }

  get isSeeded(): boolean {
    return this.seeded;
  }

  /** Fill the draft from what the customer sent. Only ever done once. */
  seedFrom(areas: QuotationArea[] | undefined) {
    this.groups = (areas || []).map((area, index) => ({
      id: 'g' + index,
      name: (area?.name || '').trim() || `Area ${index + 1}`,
      lines: (area?.items || []).map(item => this.base.lineFromItem(item))
    }));
    this.seeded = true;
  }

  // ---- Editing ----

  variantLabel(variant: ProductVariant): string {
    return this.base.variantLabel(variant);
  }

  unitPrice(product: Product, variant?: ProductVariant): number {
    return this.base.unitPrice(product, variant);
  }

  group(id: string): AreaGroup | undefined {
    return this.groups.find(g => g.id === id);
  }

  /** An area the admin adds themselves — a space the customer left out. */
  addGroup(name: string): AreaGroup {
    const group: AreaGroup = {
      id: 'g' + this.groups.length + '-' + Math.floor(Math.random() * 10000).toString(36),
      name: (name || '').trim() || `Area ${this.groups.length + 1}`,
      lines: []
    };
    this.groups = [...this.groups, group];
    return group;
  }

  removeGroup(group: AreaGroup) {
    this.groups = this.groups.filter(g => g !== group);
  }

  key(product: Product, variant?: ProductVariant): string {
    return this.base.key(product, variant);
  }

  /** How many of this exact line are in this area already. */
  quantityOf(group: AreaGroup, product: Product, variant?: ProductVariant): number {
    const key = this.key(product, variant);
    return group.lines.find(l => l.key === key)?.quantity || 0;
  }

  /** Put one more of this line into this area, or start it at one. */
  add(group: AreaGroup, product: Product, variant?: ProductVariant) {
    const key = this.key(product, variant);
    const line = group.lines.find(l => l.key === key);
    if (line) {
      line.quantity += 1;
      return;
    }
    const price = this.unitPrice(product, variant);
    group.lines = [...group.lines, {
      key,
      name: product.name,
      variant: variant ? this.variantLabel(variant) : '',
      sku: product.id,
      image: product.image || '',
      mrp: price,
      // A product added after a discount was applied is quoted at the same
      // discount, or the one line the admin added last would print at full MRP.
      price: this.discounted(price),
      quantity: 1
    }];
  }

  /** One fewer, and out of the area entirely at zero. */
  remove(group: AreaGroup, product: Product, variant?: ProductVariant) {
    const key = this.key(product, variant);
    const index = group.lines.findIndex(l => l.key === key);
    if (index < 0) return;
    if (group.lines[index].quantity > 1) group.lines[index].quantity -= 1;
    else group.lines = group.lines.filter((_, i) => i !== index);
  }

  removeLine(group: AreaGroup, line: QuoteLine) {
    group.lines = group.lines.filter(l => l !== line);
  }

  // ---- What it comes to ----

  get discountPercent(): number {
    const value = Number(this.discountValue) || 0;
    return Math.min(Math.max(value, 0), 100);
  }

  get discountLabel(): string {
    return this.discountPercent > 0 ? `${this.discountPercent}%` : '';
  }

  private discounted(mrp: number): number {
    return Math.round((mrp || 0) * (100 - this.discountPercent) / 100);
  }

  /**
   * Take the discount off every product in every area.
   *
   * Written into each line's price rather than worked out again on every
   * render, and always from the MRP — so applying 10% twice cannot compound.
   */
  applyDiscount() {
    for (const group of this.groups) {
      for (const line of group.lines) line.price = this.discounted(line.mrp || 0);
    }
  }

  netPrice(line: QuoteLine): number {
    return line.price || 0;
  }

  /** What this line ended up discounted by, whatever moved its price. */
  linePercent(line: QuoteLine): number {
    if (!line.mrp || line.price >= line.mrp) return 0;
    return Math.round((1 - line.price / line.mrp) * 100);
  }

  lineMrpTotal(line: QuoteLine): number {
    return (line.mrp || 0) * (line.quantity || 0);
  }

  /** Rounded here, so every figure printed is a figure that was added up. */
  lineTotal(line: QuoteLine): number {
    return Math.round((line.price || 0) * (line.quantity || 0));
  }

  /** What one area comes to — the number a customer asks about by room. */
  groupTotal(group: AreaGroup): number {
    return group.lines.reduce((sum, l) => sum + this.lineTotal(l), 0);
  }

  groupMrpTotal(group: AreaGroup): number {
    return group.lines.reduce((sum, l) => sum + this.lineMrpTotal(l), 0);
  }

  groupCount(group: AreaGroup): number {
    return group.lines.reduce((sum, l) => sum + (l.quantity || 0), 0);
  }

  // ---- The job as one list of products ----

  /**
   * Every product of every area, each appearing once.
   *
   * Built fresh on every read — the areas are the truth, this is only how they
   * read on the final list and on the priced PDF.
   */
  get mergedLines(): MergedLine[] {
    const byKey = new Map<string, MergedLine>();
    const rows: MergedLine[] = [];

    for (const group of this.groups) {
      for (const line of group.lines) {
        const row = byKey.get(line.key);
        if (row) {
          row.quantity += line.quantity || 0;
          // A picture or an MRP the first area happened to be missing.
          if (!row.image && line.image) row.image = line.image;
          if (!row.mrp && line.mrp) row.mrp = line.mrp;
          row.sources.push({ group, line });
          continue;
        }
        const fresh: MergedLine = {
          key: line.key,
          name: line.name,
          variant: line.variant,
          sku: line.sku,
          image: line.image,
          mrp: line.mrp || 0,
          price: line.price || 0,
          quantity: line.quantity || 0,
          sources: [{ group, line }]
        };
        byKey.set(line.key, fresh);
        rows.push(fresh);
      }
    }

    // The rate is worked back from the money, not copied off the first area:
    // if one room's copy of a product was given its own price by hand, the row
    // still has to multiply out to what the areas actually come to.
    for (const row of rows) {
      const amount = this.mergedTotal(row);
      row.price = row.quantity > 0 ? Math.round(amount / row.quantity) : row.price;
    }

    return rows;
  }

  mergedTotal(row: MergedLine): number {
    return row.sources.reduce((sum, s) => sum + this.lineTotal(s.line), 0);
  }

  mergedMrpTotal(row: MergedLine): number {
    return row.sources.reduce((sum, s) => sum + this.lineMrpTotal(s.line), 0);
  }

  /** What this row ended up discounted by, against its own MRP. */
  mergedPercent(row: MergedLine): number {
    const mrp = this.mergedMrpTotal(row);
    const amount = this.mergedTotal(row);
    if (!mrp || amount >= mrp) return 0;
    return Math.round((1 - amount / mrp) * 100);
  }

  /**
   * Set how many of this product the whole job wants.
   *
   * The later areas keep what they were given and the first one carries the
   * difference — a number typed on the final list should not quietly rewrite a
   * room nobody opened. Only when the new figure is smaller than the later
   * areas already hold are they trimmed, from the last area back.
   */
  setMergedQuantity(row: MergedLine, quantity: number) {
    const want = Math.max(1, Math.floor(quantity) || 1);
    const sources = row.sources;
    if (!sources.length) return;

    let rest = 0;
    for (let i = 1; i < sources.length; i++) rest += sources[i].line.quantity || 0;

    if (want > rest) {
      sources[0].line.quantity = want - rest;
      row.quantity = want;
      return;
    }

    sources[0].line.quantity = 1;
    let over = rest - (want - 1);
    for (let i = sources.length - 1; i >= 1 && over > 0; i--) {
      const { group, line } = sources[i];
      const take = Math.min(line.quantity || 0, over);
      line.quantity -= take;
      over -= take;
      if (line.quantity <= 0) this.removeLine(group, line);
    }
    row.quantity = want;
  }

  incMerged(row: MergedLine) {
    this.setMergedQuantity(row, row.quantity + 1);
  }

  decMerged(row: MergedLine) {
    if (row.quantity > 1) this.setMergedQuantity(row, row.quantity - 1);
  }

  /** A price typed on the final list is the price in every area it came from. */
  setMergedPrice(row: MergedLine, price: number) {
    const value = Math.max(0, Math.round(price) || 0);
    for (const s of row.sources) s.line.price = value;
    row.price = value;
  }

  setMergedMrp(row: MergedLine, mrp: number) {
    const value = Math.max(0, Math.round(mrp) || 0);
    for (const s of row.sources) s.line.mrp = value;
    row.mrp = value;
  }

  /** Off the quotation means off it — out of every area that asked for it. */
  removeMerged(row: MergedLine) {
    for (const s of row.sources) this.removeLine(s.group, s.line);
    row.sources = [];
    row.quantity = 0;
  }

  /** How many rows the final list prints — products, not area lines. */
  get mergedCount(): number {
    return this.mergedLines.length;
  }

  get itemCount(): number {
    return this.groups.reduce((sum, g) => sum + this.groupCount(g), 0);
  }

  get lineCount(): number {
    return this.groups.reduce((sum, g) => sum + g.lines.length, 0);
  }

  /** The whole job at list price. */
  get subtotal(): number {
    return this.groups.reduce((sum, g) => sum + this.groupMrpTotal(g), 0);
  }

  /** What comes off — simply the difference the pricing makes against MRP. */
  get discount(): number {
    return this.subtotal - this.total;
  }

  get total(): number {
    return this.groups.reduce((sum, g) => sum + this.groupTotal(g), 0);
  }

  /** The saving as a percentage of list price — what the customer is told. */
  get savedPercent(): number {
    if (!this.subtotal) return 0;
    return Math.round((this.discount / this.subtotal) * 100);
  }

  /** Lines the catalogue has no price for — they would print as zero. */
  get unpricedCount(): number {
    return this.groups.reduce(
      (sum, g) => sum + g.lines.filter(l => !l.mrp).length, 0
    );
  }
}
