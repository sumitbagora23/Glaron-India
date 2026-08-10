import { Injectable, signal, inject } from '@angular/core';
import { Firestore, collection, doc, setDoc, onSnapshot, deleteDoc } from '@angular/fire/firestore';

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
          if (!PREDEFINED_ORDER_IDS.includes(data.id)) {
            remoteOrders.push(data);
          }
        });
        this.ordersSignal.set(remoteOrders);
        this.saveToStorage(remoteOrders);
      }, (err) => {
        console.warn('Firestore orders notice:', err);
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
        return parsed.filter(o => !PREDEFINED_ORDER_IDS.includes(o.id));
      }
    } catch (e) {
      console.error('Error loading orders from localStorage', e);
    }
    return [];
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
    return this.ordersSignal().filter(o => !PREDEFINED_ORDER_IDS.includes(o.id));
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
      setDoc(doc(this.firestore, 'orders', id), newOrder)
        .catch(err => console.warn('Firestore add order notice:', err));
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

  deleteOrder(id: string) {
    this.ordersSignal.update(orders => {
      const newList = orders.filter(o => o.id !== id);
      this.saveToStorage(newList);
      return newList;
    });

    if (this.firestore) {
      deleteDoc(doc(this.firestore, 'orders', id))
        .catch(err => console.warn('Firestore delete order notice:', err));
    }
  }
}
