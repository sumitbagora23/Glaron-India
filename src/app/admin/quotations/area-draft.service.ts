import { Injectable, effect, inject } from '@angular/core';
import { Firestore, doc, setDoc } from '@angular/fire/firestore';
import { ProductService, Product, ProductVariant } from '../product.service';
import { QuotationArea, QuotationItem, QuotationPricing } from '../quotation.service';
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
 * The priced draft is saved to Firestore, onto the quotation's own document,
 * beside what the customer sent — never over it. That is what makes a price
 * typed on one machine show on every other: in incognito, on another admin's
 * device, wherever the console is open. What the customer sent stays as they
 * sent it; the priced version also leaves as a PDF.
 */
@Injectable({ providedIn: 'root' })
export class AreaQuoteDraftService {
  private products = inject(ProductService);
  private firestore = inject(Firestore, { optional: true });
  /** The pricing rules are the same as a flat quotation's, so they are shared. */
  private base = inject(QuotationDraftService);

  private id = '';
  private seeded = false;
  /** Debounce handle, so typing a figure is one save, not one per keystroke. */
  private saveTimer: any = null;

  groups: AreaGroup[] = [];

  /** One discount, as a percentage, across every product in every area. */
  discountValue = 0;

  constructor() {
    // The saved draft drops the pictures — they are data URLs and would burst
    // the document — so as the catalogue arrives its pictures are put back on
    // the lines that came back without one, redrawn by sku.
    effect(() => {
      const list = this.products.products;
      if (!list.length || !this.groups.length) return;
      for (const group of this.groups) {
        for (const line of group.lines) {
          if (!line.image) {
            const img = this.products.getProductById(line.sku)?.image;
            if (img) line.image = img;
          }
        }
      }
    });
  }

  /**
   * Point the draft at a quotation. A different one starts again; the draft
   * saved for it is brought back off the live feed by the page, so a refresh in
   * the middle of pricing — on this machine or any other — restores every
   * product added and every price set by hand.
   */
  use(id: string) {
    if (this.id === id) return;
    this.id = id;
    this.groups = [];
    this.discountValue = 0;
    this.seeded = false;
  }

  // ---- Saved to Firestore, onto the quotation's own document ----
  //
  // The priced draft is written into a `pricing` field beside what the customer
  // sent, never over it. The console reads it back off the same live feed it
  // reads the request from, which is what makes a price show on every device.
  // Pictures are left off — they are data URLs, and a large job of them would
  // burst the 1 MB document; the catalogue redraws each tile by sku on load.

  /** Schedule a save. Debounced, so typing a figure is one write, not one per key. */
  private persist() {
    if (!this.id || !this.firestore) return;
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => this.flush(), 500);
  }

  /** Write the working draft onto the quotation document, pictures dropped. */
  private async flush() {
    if (!this.id || !this.firestore) return;
    const pricing = {
      discountValue: this.discountValue || 0,
      updatedAt: Date.now(),
      groups: this.groups.map(g => ({
        id: g.id,
        name: g.name,
        lines: g.lines.map(l => ({
          key: l.key,
          name: l.name,
          variant: l.variant || '',
          sku: l.sku || '',
          mrp: l.mrp || 0,
          price: l.price || 0,
          quantity: l.quantity || 0
        }))
      }))
    };
    try {
      await setDoc(
        doc(this.firestore, 'quotations', this.id), { pricing }, { merge: true }
      );
    } catch (e) {
      console.warn('Quotation pricing save notice:', (e as any)?.message || e);
    }
  }

  /** Called by the page after it changes a line the service did not touch. */
  save() {
    this.persist();
  }

  /**
   * Fill the draft from a pricing already saved to the quotation — an earlier
   * session's work, or another admin's — so the priced version comes back
   * exactly as it was left, on whatever device opens it. A load, not a change:
   * it is not written back.
   */
  private seedFromPricing(pricing: QuotationPricing) {
    this.discountValue = Number(pricing.discountValue) || 0;
    this.groups = (pricing.groups || []).map(g => ({
      id: g.id,
      name: g.name,
      lines: (g.lines || []).map(l => ({
        key: l.key,
        name: l.name,
        variant: l.variant || '',
        sku: l.sku || '',
        // Redrawn from the catalogue by sku; never stored on the draft.
        image: this.products.getProductById(l.sku)?.image || '',
        mrp: Number(l.mrp) || 0,
        price: Number(l.price) || 0,
        quantity: Number(l.quantity) || 0
      }))
    }));
    this.seeded = true;
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

  /**
   * Fill the draft from a customer's request, however it arrived.
   *
   * A request from the area-wise link comes split by room; one from the plain
   * catalogue link comes as a single list. They are the same job either way —
   * a flat request is one asked for in a single unnamed space — so both open
   * here rather than on two pages that priced the same thing twice.
   */
  seedFromRequest(
    request: { areas?: QuotationArea[]; items?: QuotationItem[]; pricing?: QuotationPricing } | undefined
  ) {
    // A price already saved for this quotation wins over the raw request — it is
    // this session's, an earlier one's, or another admin's priced copy.
    if (request?.pricing?.groups?.length) {
      this.seedFromPricing(request.pricing);
      return;
    }
    if (request?.areas?.length) {
      this.seedFrom(request.areas);
      return;
    }
    this.groups = [{
      id: 'g0',
      name: 'All items',
      lines: (request?.items || []).map(item => this.base.lineFromItem(item))
    }];
    this.seeded = true;
  }

  // ---- Editing ----

  variantLabel(variant: ProductVariant, omitBodyColour = false): string {
    return this.base.variantLabel(variant, omitBodyColour);
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
    this.persist();
    return group;
  }

  removeGroup(group: AreaGroup) {
    this.groups = this.groups.filter(g => g !== group);
    this.persist();
  }

  // The finish parts the lines but never the price — see QuotationDraftService.
  key(product: Product, variant?: ProductVariant, bodyColour?: string): string {
    return this.base.key(product, variant, undefined, bodyColour);
  }

  /** How many of this exact line are in this area already. */
  quantityOf(group: AreaGroup, product: Product, variant?: ProductVariant, bodyColour?: string): number {
    const key = this.key(product, variant, bodyColour);
    return group.lines.find(l => l.key === key)?.quantity || 0;
  }

  /** Put one more of this line into this area, or start it at one. */
  add(group: AreaGroup, product: Product, variant?: ProductVariant, bodyColour?: string) {
    const key = this.key(product, variant, bodyColour);
    const line = group.lines.find(l => l.key === key);
    if (line) {
      line.quantity += 1;
      this.persist();
      return;
    }
    const price = this.unitPrice(product, variant);
    group.lines = [...group.lines, {
      key,
      name: product.name,
      variant: this.base.lineLabel(variant, undefined, bodyColour),
      sku: product.id,
      image: product.image || '',
      mrp: price,
      // A product added after a discount was applied is quoted at the same
      // discount, or the one line the admin added last would print at full MRP.
      price: this.discounted(price),
      quantity: 1
    }];
    this.persist();
  }

  /** One fewer, and out of the area entirely at zero. */
  remove(group: AreaGroup, product: Product, variant?: ProductVariant, bodyColour?: string) {
    const key = this.key(product, variant, bodyColour);
    const index = group.lines.findIndex(l => l.key === key);
    if (index < 0) return;
    if (group.lines[index].quantity > 1) group.lines[index].quantity -= 1;
    else group.lines = group.lines.filter((_, i) => i !== index);
    this.persist();
  }

  removeLine(group: AreaGroup, line: QuoteLine) {
    group.lines = group.lines.filter(l => l !== line);
    this.persist();
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
   *
   * Every product is priced from its MRP, a figure typed by hand included: the
   * percentage is the whole job's price, so applying one after pricing a
   * product by hand puts that product on the percentage like the rest. Typing
   * over the figure again is what gives it its own price back.
   */
  applyDiscount() {
    for (const group of this.groups) {
      for (const line of group.lines) line.price = this.discounted(line.mrp || 0);
    }
    this.persist();
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

  /**
   * Where this row is priced against its own MRP, signed.
   *
   * Below list it is negative — the saving the customer is being given. Above
   * list it is positive, and it is printed too: a price typed in over the MRP
   * used to show nothing at all, which read as full price rather than as the
   * fifty rupees over list it actually was.
   */
  mergedPercent(row: MergedLine): number {
    const mrp = this.mergedMrpTotal(row);
    const amount = this.mergedTotal(row);
    if (!mrp || amount === mrp) return 0;
    return Math.round((amount / mrp - 1) * 100);
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
      this.persist();
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
    this.persist();
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
    this.persist();
  }

  setMergedMrp(row: MergedLine, mrp: number) {
    const value = Math.max(0, Math.round(mrp) || 0);
    for (const s of row.sources) s.line.mrp = value;
    row.mrp = value;
    this.persist();
  }

  /** Off the quotation means off it — out of every area that asked for it. */
  removeMerged(row: MergedLine) {
    for (const s of row.sources) this.removeLine(s.group, s.line);
    row.sources = [];
    row.quantity = 0;
    this.persist();
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
