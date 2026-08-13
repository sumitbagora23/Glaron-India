import { Injectable, signal, inject, Injector, runInInjectionContext } from '@angular/core';
import {
  Firestore, collection, doc, setDoc, deleteDoc, onSnapshot, query, orderBy, limit
} from '@angular/fire/firestore';
import { Auth, signInAnonymously } from '@angular/fire/auth';

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
 * A quotation a customer sent in from the public catalogue. Two kinds arrive
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
  private auth = inject(Auth, { optional: true });
  private injector = inject(Injector);

  private readonly COL = 'quotations';
  // Each document carries a full picture, so the live feed is bounded — the
  // console lists the recent ones, not every quote ever sent.
  private readonly FEED_LIMIT = 60;

  private listSignal = signal<CustomerQuotation[]>([]);
  private listening = false;
  private anonSession: Promise<void> | null = null;

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
            // Either kind counts: an uploaded picture, or a list of picked lines.
            if (data && (data.image || (data.items && data.items.length))) list.push(data);
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

  /**
   * Take an anonymous Firebase session so the write satisfies rules that
   * require `request.auth != null`. The customer sending a quote has no account
   * and never signs in, so this is the only identity available. Resolves either
   * way — if the Anonymous provider is off the write is simply attempted as-is.
   */
  private ensureSession(): Promise<void> {
    if (!this.auth) return Promise.resolve();
    if (this.auth.currentUser) return Promise.resolve();
    if (this.anonSession) return this.anonSession;

    this.anonSession = signInAnonymously(this.auth)
      .then(() => undefined)
      .catch(err => {
        console.warn('Anonymous quotation session notice:', err?.code || err?.message || err);
        this.anonSession = null;
      });
    return this.anonSession;
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
    await this.ensureSession();
    await setDoc(doc(this.firestore!, this.COL, record.id), record);
  }

  /** Remove a quotation once it has been dealt with. */
  async remove(id: string): Promise<void> {
    if (this.firestore) {
      await deleteDoc(doc(this.firestore, this.COL, id)).catch(() => {});
    }
  }
}
