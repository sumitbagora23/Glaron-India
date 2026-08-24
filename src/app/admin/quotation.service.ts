import { Injectable, signal, inject, Injector, runInInjectionContext } from '@angular/core';
import {
  Firestore, collection, doc, deleteDoc, onSnapshot, query, orderBy, limit
} from '@angular/fire/firestore';

/** One line a customer picked out of the public catalogue. */
export interface QuotationItem {
  /** Product name, exactly as the catalogue reads. */
  name: string;
  /** Variant descriptor, e.g. `12W · 82*79 mm · WHITE`. Empty if there is none. */
  variant?: string;
  /** Product code, so the admin can price the exact line. */
  sku?: string;
  /**
   * Path to the product picture, so the console can show what was asked for.
   *
   * A path only — never the picture itself. Product images in this project can
   * be inline data URLs, and a dozen of those on one request would push the
   * document past the 1 MB Firestore ceiling. Anything that fat is dropped
   * here; the console falls back to looking the image up by `sku`.
   */
  image?: string;
  quantity: number;
}

/**
 * One area of a job — a kitchen, a lobby, a master bedroom — with the products
 * the customer wants in it.
 *
 * The area-wise link asks for the list this way round: the customer names the
 * space first and fills it, so the quotation that goes back can be read room by
 * room instead of as one undivided list of forty lines.
 */
export interface QuotationArea {
  /** Whatever the customer typed, e.g. `Master Bedroom`. */
  name: string;
  /** What they put in it. Never empty — an area with nothing in it is dropped. */
  items: QuotationItem[];
}

/**
 * A quotation a customer sent in from the public catalogue. Three kinds arrive
 * here, and the shape says which:
 *
 *   • `image` — a quote the customer already holds from somewhere else,
 *     uploaded so Glaron can price the same list against it. A compact JPEG
 *     data URL stored inline on the document, the same approach banners, posts
 *     and product images use, so no Firebase Storage is involved.
 *   • `items` — a list the customer built themselves in the catalogue and asked
 *     for a price on. The public catalogue shows no prices at all, so this is
 *     the only way a customer can ask what something costs.
 *
 * Both carry the name and mobile the customer left, which is the whole point:
 * somebody has to be able to call them back.
 */
export interface CustomerQuotation {
  id: string;
  /** Who sent it. Typed by the customer, so it is whatever they wrote. */
  name: string;
  /** 10-digit Indian mobile, digits only. */
  mobile: string;
  /** The uploaded quotation, as a JPEG data URL. Absent on a product request. */
  image?: string;
  /** What the customer picked out of the catalogue. Absent on an upload. */
  items?: QuotationItem[];
  /**
   * The same thing, split by area, from the area-wise link. A document carries
   * either this or `items`, never both — which is what the console's three
   * lists are told apart by.
   */
  areas?: QuotationArea[];
  /** The link code the customer arrived on — which shared link brought them. */
  ref?: string;
  /** Epoch millis — ordering and the "time ago" label. */
  createdAt: number;
}

@Injectable({
  providedIn: 'root'
})
export class QuotationService {
  private firestore = inject(Firestore, { optional: true });
  private injector = inject(Injector);

  private readonly COL = 'quotations';
  // Each document carries a full picture, so the live feed is bounded — the
  // console lists the recent ones, not every quote ever sent.
  private readonly FEED_LIMIT = 60;

  private listSignal = signal<CustomerQuotation[]>([]);
  private listening = false;

  /** Subscribe to the live feed, newest first. Idempotent. */
  start() {
    if (this.listening || !this.firestore) return;
    this.listening = true;
    const col = collection(this.firestore, this.COL);
    runInInjectionContext(this.injector, () =>
      onSnapshot(
        query(col, orderBy('createdAt', 'desc'), limit(this.FEED_LIMIT)),
        (snap) => {
          const list: CustomerQuotation[] = [];
          snap.forEach((d) => {
            const data = d.data() as CustomerQuotation;
            // Any of the three counts: an uploaded picture, a list of picked
            // lines, or that list split by area.
            if (data && (
              data.image ||
              (data.items && data.items.length) ||
              (data.areas && data.areas.length)
            )) list.push(data);
          });
          this.listSignal.set(list);
        },
        (err) => console.warn('Firestore quotations feed notice:', (err as any)?.message || err)
      )
    );
  }

  /** Every quotation received, newest first. */
  get quotations(): CustomerQuotation[] {
    return this.listSignal();
  }

  /** Send a customer's uploaded quotation to the console. */
  async submit(name: string, mobile: string, image: string, ref?: string): Promise<void> {
    const img = (image || '').trim();
    if (!img || !this.firestore) return;

    await this.write({
      id: this.newId(),
      name: (name || '').trim(),
      mobile: (mobile || '').replace(/\D/g, ''),
      image: img,
      createdAt: Date.now(),
      ...(ref ? { ref } : {})
    });
  }

  /**
   * Send a list the customer built in the public catalogue, asking for a price.
   *
   * There are no prices anywhere on that page, so nothing about money is stored
   * on the request either — just what they picked, how many of each, and who to
   * call back.
   */
  async submitRequest(
    name: string, mobile: string, items: QuotationItem[], ref?: string
  ): Promise<void> {
    const lines = (items || []).filter(i => i && i.name && i.quantity > 0);
    if (!lines.length || !this.firestore) return;

    await this.write({
      id: this.newId(),
      name: (name || '').trim(),
      mobile: (mobile || '').replace(/\D/g, ''),
      // Written field by field: an undefined property anywhere in the object
      // would be rejected by Firestore outright.
      items: lines.map(i => ({
        name: i.name,
        quantity: i.quantity,
        ...(i.variant ? { variant: i.variant } : {}),
        ...(i.sku ? { sku: i.sku } : {}),
        ...(this.slimImage(i.image) ? { image: this.slimImage(i.image) } : {})
      })),
      createdAt: Date.now(),
      ...(ref ? { ref } : {})
    });
  }

  /**
   * Send a list built area by area from the area-wise link.
   *
   * The same request as `submitRequest` in every other respect — no prices, the
   * name and mobile to call back on — except that the products arrive already
   * grouped by the room they are for, and the console keeps that grouping all
   * the way through to the PDF.
   */
  async submitAreaRequest(
    name: string, mobile: string, areas: QuotationArea[], ref?: string
  ): Promise<void> {
    const groups = (areas || [])
      .map(area => ({
        name: (area?.name || '').trim() || 'Area',
        items: (area?.items || []).filter(i => i && i.name && i.quantity > 0)
      }))
      // An area the customer named but never filled has nothing to quote.
      .filter(area => area.items.length);

    if (!groups.length || !this.firestore) return;

    await this.write({
      id: this.newId(),
      name: (name || '').trim(),
      mobile: (mobile || '').replace(/\D/g, ''),
      areas: groups.map(area => ({
        name: area.name,
        // Field by field, for the same reason as above: Firestore rejects a
        // document with an undefined property anywhere in it.
        items: area.items.map(i => ({
          name: i.name,
          quantity: i.quantity,
          ...(i.variant ? { variant: i.variant } : {}),
          ...(i.sku ? { sku: i.sku } : {}),
          ...(this.slimImage(i.image) ? { image: this.slimImage(i.image) } : {})
        }))
      })),
      createdAt: Date.now(),
      ...(ref ? { ref } : {})
    });
  }

  /**
   * Keep a product picture only if it is a reference rather than the picture
   * itself. An inline data URL runs to hundreds of kilobytes, and a request can
   * carry many lines — together they would burst the document.
   */
  private slimImage(image?: string): string | undefined {
    const src = (image || '').trim();
    if (!src || src.startsWith('data:')) return undefined;
    return src.length <= 500 ? src : undefined;
  }

  private newId(): string {
    return 'q-' + Date.now() + '-' + Math.floor(Math.random() * 1000);
  }

  private async write(record: CustomerQuotation): Promise<void> {
    // Sent over the Firestore REST API rather than the SDK's setDoc.
    //
    // The SDK talks to the backend over a streaming WebChannel connection, and
    // on some customer networks, proxies and mobile carriers that stream is
    // silently blocked or buffered. When it is, a setDoc write is queued into
    // the offline cache and its promise never resolves — the request form just
    // spins on "Sending your list…" forever and the quotation is never
    // delivered. Plain HTTPS (which the REST endpoint uses) is not affected, so
    // posting the document directly is what actually gets a customer's request
    // through. No sign-in is involved: the rule on `quotations` allows an
    // unauthenticated create, so this goes in with no identity attached.
    const app = this.firestore!.app;
    const projectId = app.options.projectId;
    const apiKey = app.options.apiKey;
    const url =
      `https://firestore.googleapis.com/v1/projects/${projectId}` +
      `/databases/(default)/documents/${this.COL}` +
      `?documentId=${encodeURIComponent(record.id)}` +
      (apiKey ? `&key=${apiKey}` : '');

    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fields: this.toFsFields(record as unknown as Record<string, unknown>) }),
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      throw new Error(`Quotation write failed (${res.status}): ${detail.slice(0, 200)}`);
    }
  }

  /**
   * Turn a plain object into the Firestore REST `fields` map. Undefined values
   * are dropped, so an omitted optional field (a line with no variant, say)
   * simply isn't written — matching how the rest of the app treats them.
   */
  private toFsFields(obj: Record<string, unknown>): Record<string, unknown> {
    const fields: Record<string, unknown> = {};
    for (const key of Object.keys(obj)) {
      const value = obj[key];
      if (value !== undefined) fields[key] = this.toFsValue(value);
    }
    return fields;
  }

  /** One value in Firestore REST's typed-value shape. Covers the types a
   *  quotation document actually holds: strings, whole numbers, nested arrays
   *  (items, areas) and the maps inside them. */
  private toFsValue(value: unknown): Record<string, unknown> {
    if (typeof value === 'string') return { stringValue: value };
    if (typeof value === 'number') {
      return Number.isInteger(value)
        ? { integerValue: String(value) }
        : { doubleValue: value };
    }
    if (typeof value === 'boolean') return { booleanValue: value };
    if (Array.isArray(value)) {
      return { arrayValue: { values: value.map(v => this.toFsValue(v)) } };
    }
    if (value && typeof value === 'object') {
      return { mapValue: { fields: this.toFsFields(value as Record<string, unknown>) } };
    }
    return { nullValue: null };
  }

  /** Remove a quotation once it has been dealt with. */
  async remove(id: string): Promise<void> {
    if (this.firestore) {
      await deleteDoc(doc(this.firestore, this.COL, id)).catch(() => {});
    }
  }
}
