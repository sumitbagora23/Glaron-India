import { Injectable, signal, inject } from '@angular/core';
import { Firestore, collection, doc, setDoc, onSnapshot, deleteDoc } from '@angular/fire/firestore';
import { writeDocViaRest, deleteDocViaRest } from './firestore-rest';

export interface OrderItemLine {
  name: string;
  variant?: string;
  quantity: number;
  unitPrice?: number;
  totalPrice?: number;
}

export type OrderStage = 'Order Received' | 'Confirmed' | 'Dispatched' | 'Delivered' | 'Paid';

export interface Order {
  id: string;
  dealer: string;
  location: string;
  value: number;
  // New stages + legacy values kept for backward-compatible data
  stage: OrderStage | 'New' | 'Packed' | 'Pending';
  date?: string;
  itemsCount?: number;
  items?: OrderItemLine[];
  // Delivery location captured at order time (mirrors the dealer's profile).
  state?: string;
  city?: string;
  pincode?: string;
  // Who placed it. The admin PWA only raises a "new order" notification for
  // dealer-placed orders — an order the admin just typed in doesn't need
  // announcing back to them. Orders written before this field existed have no
  // `source` and are treated as dealer orders.
  source?: 'dealer' | 'admin';
}

// Map any legacy stage value to the current pipeline stages
export function normalizeStage(stage: string | undefined): OrderStage {
  switch (stage) {
    case 'New':
    case 'Pending': return 'Order Received';
    case 'Packed': return 'Confirmed';
    case 'Confirmed': return 'Confirmed';
    case 'Dispatched': return 'Dispatched';
    case 'Delivered': return 'Delivered';
    case 'Paid': return 'Paid';
    case 'Order Received': return 'Order Received';
    default: return 'Order Received';
  }
}

const PREDEFINED_ORDER_IDS = ['ORD-9021', 'ORD-9025', 'ORD-8998', 'ORD-8992', 'ORD-8854'];

@Injectable({
  providedIn: 'root'
})
export class OrderService {
  private STORAGE_KEY = 'glaron_orders_real_v2';
  // Ids of orders the admin has force-deleted. Held locally and mirrored to the
  // shared meta/orders tombstone so a deleted order can never come back — not
  // from a dealer's queued copy, not from an old cached client. Declared before
  // the orders signal so loadFromStorage() below can already filter against it.
  private DELETED_KEY = 'glaron_orders_deleted_v1';
  private deletedIds = new Set<string>(this.loadDeletedIds());
  private firestore = inject(Firestore, { optional: true });

  private ordersSignal = signal<Order[]>(this.loadFromStorage());

  constructor() {
    this.clearLegacyOrders();
    this.initFirestoreSync();
  }

  private clearLegacyOrders() {
    try {
      localStorage.removeItem('glaron_orders_list');
    } catch (e) {}
  }

  private initFirestoreSync() {
    if (!this.firestore) return;
    try {
      const ordersCol = collection(this.firestore, 'orders');
      onSnapshot(ordersCol, (snapshot) => {
        const remoteOrders: Order[] = [];
        snapshot.forEach(docSnap => {
          const data = docSnap.data() as Order;
          // Drop predefined demo orders and anything the admin has tombstoned —
          // the latter covers a deleted order that this dealer's own offline
          // queue is still trying to sync back in.
          if (!PREDEFINED_ORDER_IDS.includes(data.id) && !this.deletedIds.has(data.id)) {
            remoteOrders.push(data);
          }
        });
        this.ordersSignal.set(remoteOrders);
        this.saveToStorage(remoteOrders);
      }, (err) => {
        console.warn('Firestore orders notice:', err);
      });

      // Shared delete-tombstones. When the admin force-deletes an order its id
      // lands in meta/orders, and this dealer app picks it up here and drops that
      // order on the spot, keeping it gone — even for an order still sitting in
      // this device's offline cache and never actually synced to the server.
      const tombstoneDoc = doc(this.firestore, 'meta', 'orders');
      onSnapshot(tombstoneDoc, (snap) => {
        const ids = ((snap.data() as { deletedIds?: string[] } | undefined)?.deletedIds) || [];
        let changed = false;
        for (const id of ids) {
          if (!this.deletedIds.has(id)) { this.deletedIds.add(id); changed = true; }
        }
        if (changed) {
          this.saveDeletedIds();
          this.ordersSignal.update(list => {
            const kept = list.filter(o => !this.deletedIds.has(o.id));
            this.saveToStorage(kept);
            return kept;
          });
        }
      }, (err) => {
        console.warn('Firestore order tombstone notice:', err);
      });
    } catch (e) {
      console.warn('Firestore orders init notice:', e);
    }
  }

  private loadFromStorage(): Order[] {
    try {
      const stored = localStorage.getItem(this.STORAGE_KEY);
      if (stored) {
        const parsed: Order[] = JSON.parse(stored);
        return parsed.filter(o => !PREDEFINED_ORDER_IDS.includes(o.id) && !this.deletedIds.has(o.id));
      }
    } catch (e) {
      console.error('Error loading orders from localStorage', e);
    }
    return [];
  }

  private loadDeletedIds(): string[] {
    try {
      const stored = localStorage.getItem(this.DELETED_KEY);
      if (stored) return JSON.parse(stored) as string[];
    } catch (e) { /* ignore */ }
    return [];
  }

  private saveDeletedIds() {
    try {
      localStorage.setItem(this.DELETED_KEY, JSON.stringify([...this.deletedIds]));
    } catch (e) { /* ignore */ }
  }

  private saveToStorage(orders: Order[]) {
    try {
      const cleanOrders = orders.filter(o => !PREDEFINED_ORDER_IDS.includes(o.id));
      localStorage.setItem(this.STORAGE_KEY, JSON.stringify(cleanOrders));
    } catch (e) {
      console.error('Error saving orders to localStorage', e);
    }
  }

  get orders(): Order[] {
    return this.ordersSignal().filter(o => !PREDEFINED_ORDER_IDS.includes(o.id) && !this.deletedIds.has(o.id));
  }

  addOrder(orderData: Partial<Order> & { orderId?: string; id?: string }) {
    const id = orderData.id || orderData.orderId || 'ORD-' + Math.floor(100000 + Math.random() * 900000);
    const newOrder: Order = {
      id,
      dealer: orderData.dealer || 'Dealer Order',
      location: orderData.location || 'Warehouse',
      value: orderData.value || 0,
      stage: orderData.stage as Order['stage'] || 'New',
      date: orderData.date || new Date().toISOString(),
      itemsCount: orderData.itemsCount || 1,
      items: orderData.items || [],
      state: orderData.state || '',
      city: orderData.city || '',
      pincode: orderData.pincode || '',
      // Defaults to a dealer order: this service runs inside the dealer PWA,
      // where checkout is the only path that creates one.
      source: orderData.source || 'dealer'
    };

    this.ordersSignal.update(orders => {
      const filtered = orders.filter(o => o.id !== id && !PREDEFINED_ORDER_IDS.includes(o.id));
      const newList = [newOrder, ...filtered];
      this.saveToStorage(newList);
      return newList;
    });

    // Deliver the order to Firestore over plain HTTPS (the REST API), which is
    // what actually lands a dealer's order for the admin to see. The SDK's setDoc
    // talks to the backend over a streaming WebChannel connection, and on some
    // dealer networks — proxies, mobile carriers — or when the offline cache is
    // wedged by a full localStorage, that stream is silently blocked: the setDoc
    // write is queued into the cache with a promise that never resolves, so the
    // order looks placed to the dealer but never reaches the console. Plain HTTPS
    // is not affected. Same fix, and same reason, as the customer quotation write.
    if (this.firestore) {
      writeDocViaRest(this.firestore, 'orders', id, newOrder as unknown as Record<string, unknown>)
        .catch(err => console.warn('Firestore add order notice:', err));

      // Also fire the SDK write, best-effort. On a healthy network it is a no-op
      // overwrite of the same document; its real value is the genuinely-offline
      // case, where the SDK queues the write and syncs it when the dealer is back
      // online — something the one-shot REST call above cannot do.
      setDoc(doc(this.firestore, 'orders', id), newOrder)
        .catch(() => { /* REST is the reliable path; ignore SDK-queue noise */ });
    }
  }

  updateOrderStage(id: string, stage: Order['stage']) {
    this.ordersSignal.update(orders => {
      const newList = orders.map(o => o.id === id ? { ...o, stage } : o);
      this.saveToStorage(newList);
      return newList;
    });

    if (this.firestore) {
      const target = this.ordersSignal().find(o => o.id === id);
      if (target) {
        setDoc(doc(this.firestore, 'orders', id), target)
          .catch(err => console.warn('Firestore update order notice:', err));
      }
    }
  }

  // Full order update (used when admin edits/deletes line items).
  // Recomputes value + item count from the items so the dealer sees the change.
  updateOrder(updated: Order) {
    const items = updated.items || [];
    const value = items.length
      ? items.reduce((s, it) => s + (it.totalPrice || (it.unitPrice || 0) * it.quantity), 0)
      : updated.value;
    const itemsCount = items.length
      ? items.reduce((s, it) => s + it.quantity, 0)
      : updated.itemsCount;
    const order: Order = { ...updated, value, itemsCount };

    this.ordersSignal.update(orders => {
      const newList = orders.map(o => o.id === order.id ? order : o);
      this.saveToStorage(newList);
      return newList;
    });

    if (this.firestore) {
      setDoc(doc(this.firestore, 'orders', order.id), order)
        .catch(err => console.warn('Firestore update order notice:', err));
    }
  }

  // Force delete. Tombstone the id first (so it can't come back), remove it
  // locally, then push the removal to the server over REST plus a shared
  // tombstone so the dealer's panel drops it too — even if the dealer's copy is
  // still queued in their offline cache and was never actually on the server.
  deleteOrder(id: string) {
    this.deletedIds.add(id);
    this.saveDeletedIds();

    this.ordersSignal.update(orders => {
      const newList = orders.filter(o => o.id !== id);
      this.saveToStorage(newList);
      return newList;
    });

    if (this.firestore) {
      // Remove the document over plain HTTPS. The SDK's deleteDoc rides the same
      // streaming channel that gets silently blocked on some networks / a wedged
      // cache, so on its own it can leave the delete hanging and the order alive
      // for the dealer. REST is the path that actually lands.
      deleteDocViaRest(this.firestore, 'orders', id)
        .catch(err => console.warn('Firestore delete order notice:', err));
      // Broadcast the tombstone so every other device — the dealer above all —
      // drops this order and never re-syncs it back. Whole set sent each time.
      writeDocViaRest(this.firestore, 'meta', 'orders', { deletedIds: [...this.deletedIds] }, { merge: true })
        .catch(err => console.warn('Firestore order tombstone notice:', err));
      // Best-effort SDK delete too, so a genuinely-offline client flushes it later.
      deleteDoc(doc(this.firestore, 'orders', id))
        .catch(() => { /* REST is the reliable path; ignore SDK-queue noise */ });
    }
  }
}
