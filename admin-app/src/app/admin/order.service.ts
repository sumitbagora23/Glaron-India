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
  // Who placed it. Only dealer-placed orders raise a "new order" notification
  // on admin devices — an order typed in here doesn't need announcing back.
  // Orders written before this field existed have no `source` and are treated
  // as dealer orders.
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
          // the latter covers a deleted order that a dealer's offline queue is
          // still trying to sync back in.
          if (!PREDEFINED_ORDER_IDS.includes(data.id) && !this.deletedIds.has(data.id)) {
            remoteOrders.push(data);
          }
        });
        this.ordersSignal.set(remoteOrders);
        this.saveToStorage(remoteOrders);
      }, (err) => {
        console.warn('Firestore orders notice:', err);
      });

      // Shared delete-tombstones. When any admin force-deletes an order its id
      // lands in meta/orders, and every device — the dealer above all — picks it
      // up here and drops that order on the spot, keeping it gone. This is what
      // makes an admin delete disappear from the dealer's panel too, even for an
      // order still sitting in the dealer's offline cache.
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
      // Anything created inside the console is an admin order, so it never
      // pushes a notification back to the admin's own devices.
      source: orderData.source || 'admin'
    };

    this.ordersSignal.update(orders => {
      const filtered = orders.filter(o => o.id !== id && !PREDEFINED_ORDER_IDS.includes(o.id));
      const newList = [newOrder, ...filtered];
      this.saveToStorage(newList);
      return newList;
    });

    if (this.firestore) {
      // Over REST so an admin-created order reaches the dealer even on networks
      // where the SDK's streaming write is silently blocked (see firestore-rest.ts).
      writeDocViaRest(this.firestore, 'orders', id, newOrder as unknown as Record<string, unknown>)
        .catch(err => console.warn('Firestore add order notice:', err));
      // Best-effort SDK write too, for the genuinely-offline resend case.
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
