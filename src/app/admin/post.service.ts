import { Injectable, signal, inject, Injector, runInInjectionContext } from '@angular/core';
import {
  Firestore, collection, doc, setDoc, deleteDoc, onSnapshot, query, orderBy, limit
} from '@angular/fire/firestore';

/**
 * A shareable post the admin publishes for dealers.
 *
 * The picture is a compact JPEG data URL stored inline on the document — the
 * same approach banners and product images use, so no Firebase Storage is
 * involved. Dealers see it on their home tab and share it onward with the
 * exactly as uploaded (see PostShareService).
 */
export interface SharePost {
  id: string;
  image: string;
  /** Optional line that rides along as the message text when sharing. */
  caption?: string;
  /**
   * Optional logo drawn into the empty space at the TOP-RIGHT of the artwork
   * when the dealer shares it. A PNG data URL, so transparency survives — it
   * sits straight on the picture with nothing behind it.
   */
  logo?: string;
  /**
   * Optional lines drawn at the BOTTOM-RIGHT of the artwork. Coloured to suit
   * whatever the picture is doing behind them.
   */
  details?: string;
  /** Epoch millis — ordering, "time ago" labels and the "New" pill. */
  createdAt: number;
}

@Injectable({
  providedIn: 'root'
})
export class PostService {
  private firestore = inject(Firestore, { optional: true });
  private injector = inject(Injector);

  private readonly COL = 'posts';
  // Only the most recent posts are worth keeping in memory — each one carries a
  // full picture, so an unbounded feed would be heavy on a dealer's phone.
  private readonly FEED_LIMIT = 12;

  private postsSignal = signal<SharePost[]>([]);
  private listening = false;

  /**
   * Subscribe to the live posts feed, newest first. Idempotent, and called by
   * both the admin settings page and the dealer home tab.
   */
  start() {
    if (this.listening || !this.firestore) return;
    this.listening = true;
    const col = collection(this.firestore, this.COL);
    runInInjectionContext(this.injector, () =>
      onSnapshot(
        query(col, orderBy('createdAt', 'desc'), limit(this.FEED_LIMIT)),
        (snap) => {
          const list: SharePost[] = [];
          snap.forEach((d) => {
            const data = d.data() as SharePost;
            if (data && data.image) list.push(data);
          });
          this.postsSignal.set(list);
        },
        (err) => console.warn('Firestore posts feed notice:', (err as any)?.message || err)
      )
    );
  }

  /** Every post currently published, newest first. */
  get posts(): SharePost[] {
    return this.postsSignal();
  }

  /** The most recent post, or null when the admin hasn't published any. */
  get latest(): SharePost | null {
    return this.postsSignal()[0] || null;
  }

  /** Publish a picture to every dealer's home tab. */
  async publish(
    image: string, caption?: string, logo?: string | null, details?: string
  ): Promise<void> {
    const img = (image || '').trim();
    if (!img) return;
    const createdAt = Date.now();
    const id = 'p-' + createdAt;
    const post: SharePost = {
      id, image: img, createdAt,
      ...(caption && caption.trim() ? { caption: caption.trim() } : {}),
      ...(logo ? { logo } : {}),
      ...(details && details.trim() ? { details: details.trim() } : {})
    };
    if (this.firestore) {
      await setDoc(doc(this.firestore, this.COL, id), post);
    }
  }

  /** Take a post down — it disappears from the dealer home tab immediately. */
  async remove(id: string): Promise<void> {
    if (this.firestore) {
      await deleteDoc(doc(this.firestore, this.COL, id)).catch(() => {});
    }
  }
}
