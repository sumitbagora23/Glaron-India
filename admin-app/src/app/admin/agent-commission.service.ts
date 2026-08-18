import { Injectable, signal, inject } from '@angular/core';
import { Firestore, collection, doc, setDoc, onSnapshot, deleteDoc } from '@angular/fire/firestore';

/**
 * Commission ledger.
 *
 * One document per entry the admin records against an agent: the date of the
 * business, the sales amount behind it, the rate and the money earned. The
 * agent PWA reads the same collection — the Commission tab an agent sees IS
 * this ledger, filtered to their own id.
 *
 * Rate and money are stored TOGETHER on purpose. The admin may know either one:
 * type a percentage and the amount is derived, type an amount and the
 * percentage is derived (see `commissionFrom` / `percentageFrom`). Persisting
 * both means neither side has to re-derive — and a later edit to one figure can
 * never leave the other silently stale.
 */

export interface CommissionEntry {
  id: string;
  /** `agents/{id}` this entry belongs to. */
  agentId: string;
  /** Denormalised so an entry stays readable if the agent record is renamed. */
  agentMobile: string;
  /** ISO date (YYYY-MM-DD) of the business this commission is for. */
  date: string;
  /** Who the business was for. Shown to the agent beside the entry. */
  clientName?: string;
  salesAmount: number;
  percentage: number;
  commissionAmount: number;
  note?: string;
  createdAt: string;
}

/**
 * A payout against what an agent has earned.
 *
 * Payments are recorded as their own entries rather than as a "paid" flag on a
 * commission entry: a single payout rarely lines up with a single month's
 * business, and an agent is owed the running balance, not a set of individually
 * settled rows. Remaining is therefore always `earned − paid`.
 */
export interface CommissionPayment {
  id: string;
  agentId: string;
  agentMobile: string;
  /** ISO date (YYYY-MM-DD) the money was paid. */
  date: string;
  amount: number;
  note?: string;
  createdAt: string;
}

@Injectable({ providedIn: 'root' })
export class AgentCommissionService {
  private STORAGE_KEY = 'glaron_agent_commissions_v1';
  private PAYMENTS_KEY = 'glaron_agent_payments_v1';
  private firestore = inject(Firestore, { optional: true });

  private entriesSignal = signal<CommissionEntry[]>(this.loadFromStorage());
  private paymentsSignal = signal<CommissionPayment[]>(this.loadPaymentsFromStorage());

  hasSynced = false;

  constructor() {
    this.initFirestoreSync();
    this.initPaymentsSync();
  }

  // ---------------- Derivations ----------------

  /** Commission money implied by a sales amount and a rate. */
  static commissionFrom(salesAmount: number, percentage: number): number {
    if (!salesAmount || !percentage) return 0;
    return Math.round(salesAmount * percentage) / 100;
  }

  /** Rate implied by a sales amount and a commission. */
  static percentageFrom(salesAmount: number, commissionAmount: number): number {
    if (!salesAmount || !commissionAmount) return 0;
    return Math.round((commissionAmount / salesAmount) * 10000) / 100;
  }

  // ---------------- Sync ----------------

  private initFirestoreSync() {
    if (!this.firestore) return;
    try {
      const col = collection(this.firestore, 'agent_commissions');
      onSnapshot(col, (snapshot) => {
        const list: CommissionEntry[] = [];
        snapshot.forEach(docSnap => list.push(docSnap.data() as CommissionEntry));
        const sorted = this.sort(list);
        this.entriesSignal.set(sorted);
        this.saveToStorage(sorted);
        this.hasSynced = true;
      }, (err) => {
        console.warn('Firestore commissions notice:', err?.message || err);
      });
    } catch (e) {
      console.warn('Firestore commissions init notice:', e);
    }
  }

  private initPaymentsSync() {
    if (!this.firestore) return;
    try {
      const col = collection(this.firestore, 'agent_payments');
      onSnapshot(col, (snapshot) => {
        const list: CommissionPayment[] = [];
        snapshot.forEach(docSnap => list.push(docSnap.data() as CommissionPayment));
        const sorted = this.sortPayments(list);
        this.paymentsSignal.set(sorted);
        this.savePaymentsToStorage(sorted);
      }, (err) => {
        console.warn('Firestore agent payments notice:', err?.message || err);
      });
    } catch (e) {
      console.warn('Firestore agent payments init notice:', e);
    }
  }

  // Newest business first — an agent opening the tab wants this month, not the
  // first entry ever recorded.
  private sort(list: CommissionEntry[]): CommissionEntry[] {
    return [...list].sort((a, b) => {
      const da = a.date || '';
      const db = b.date || '';
      if (da !== db) return db.localeCompare(da);
      return (b.createdAt || '').localeCompare(a.createdAt || '');
    });
  }

  private loadFromStorage(): CommissionEntry[] {
    try {
      const stored = localStorage.getItem(this.STORAGE_KEY);
      if (stored) return JSON.parse(stored) as CommissionEntry[];
    } catch (e) {
      console.error('Error loading commissions from localStorage', e);
    }
    return [];
  }

  private saveToStorage(entries: CommissionEntry[]) {
    try {
      localStorage.setItem(this.STORAGE_KEY, JSON.stringify(entries));
    } catch (e) {
      console.error('Error saving commissions to localStorage', e);
    }
  }

  private sortPayments(list: CommissionPayment[]): CommissionPayment[] {
    return [...list].sort((a, b) => {
      const da = a.date || '';
      const db = b.date || '';
      if (da !== db) return db.localeCompare(da);
      return (b.createdAt || '').localeCompare(a.createdAt || '');
    });
  }

  private loadPaymentsFromStorage(): CommissionPayment[] {
    try {
      const stored = localStorage.getItem(this.PAYMENTS_KEY);
      if (stored) return JSON.parse(stored) as CommissionPayment[];
    } catch (e) {
      console.error('Error loading agent payments from localStorage', e);
    }
    return [];
  }

  private savePaymentsToStorage(payments: CommissionPayment[]) {
    try {
      localStorage.setItem(this.PAYMENTS_KEY, JSON.stringify(payments));
    } catch (e) {
      console.error('Error saving agent payments to localStorage', e);
    }
  }

  // ---------------- Reads ----------------

  get entries(): CommissionEntry[] {
    return this.entriesSignal();
  }

  entriesFor(agentId: string): CommissionEntry[] {
    if (!agentId) return [];
    return this.entriesSignal().filter(e => e.agentId === agentId);
  }

  totalSales(agentId: string): number {
    return this.entriesFor(agentId).reduce((sum, e) => sum + (e.salesAmount || 0), 0);
  }

  totalCommission(agentId: string): number {
    return this.entriesFor(agentId).reduce((sum, e) => sum + (e.commissionAmount || 0), 0);
  }

  paymentsFor(agentId: string): CommissionPayment[] {
    if (!agentId) return [];
    return this.paymentsSignal().filter(p => p.agentId === agentId);
  }

  totalPaid(agentId: string): number {
    return this.paymentsFor(agentId).reduce((sum, p) => sum + (p.amount || 0), 0);
  }

  /** What the agent is still owed: everything earned, less everything paid. */
  remaining(agentId: string): number {
    const balance = this.totalCommission(agentId) - this.totalPaid(agentId);
    // Guard the float dust that ₹x.xx arithmetic leaves behind.
    return Math.round(balance * 100) / 100;
  }

  // ---------------- Writes ----------------

  addEntry(data: {
    agentId: string;
    agentMobile: string;
    date: string;
    clientName?: string;
    salesAmount: number;
    percentage: number;
    commissionAmount: number;
    note?: string;
  }): Promise<void> {
    const id = 'com-' + Date.now() + '-' + Math.random().toString(36).slice(2, 7);
    const entry: CommissionEntry = {
      id,
      agentId: data.agentId,
      agentMobile: data.agentMobile || '',
      date: data.date,
      clientName: (data.clientName || '').trim(),
      salesAmount: data.salesAmount || 0,
      percentage: data.percentage || 0,
      commissionAmount: data.commissionAmount || 0,
      note: (data.note || '').trim(),
      createdAt: new Date().toISOString()
    };

    this.entriesSignal.update(list => {
      const next = this.sort([entry, ...list]);
      this.saveToStorage(next);
      return next;
    });

    if (!this.firestore) return Promise.resolve();
    return setDoc(doc(this.firestore, 'agent_commissions', id), entry)
      .catch(err => {
        console.warn('Firestore add commission notice:', err);
        throw err;
      });
  }

  /**
   * Rewrite an existing entry in place. The id, agent and creation stamp are
   * preserved so an edit stays the same row in the ledger rather than becoming
   * a new one — the agent's app is watching this document.
   */
  updateEntry(id: string, data: {
    date: string;
    clientName?: string;
    salesAmount: number;
    percentage: number;
    commissionAmount: number;
    note?: string;
  }): Promise<void> {
    const existing = this.entriesSignal().find(e => e.id === id);
    if (!existing) return Promise.resolve();

    const updated: CommissionEntry = {
      ...existing,
      date: data.date,
      clientName: (data.clientName || '').trim(),
      salesAmount: data.salesAmount || 0,
      percentage: data.percentage || 0,
      commissionAmount: data.commissionAmount || 0,
      note: (data.note || '').trim()
    };

    this.entriesSignal.update(list => {
      const next = this.sort(list.map(e => e.id === id ? updated : e));
      this.saveToStorage(next);
      return next;
    });

    if (!this.firestore) return Promise.resolve();
    return setDoc(doc(this.firestore, 'agent_commissions', id), updated)
      .catch(err => {
        console.warn('Firestore update commission notice:', err);
        throw err;
      });
  }

  deleteEntry(id: string) {
    this.entriesSignal.update(list => {
      const next = list.filter(e => e.id !== id);
      this.saveToStorage(next);
      return next;
    });

    if (this.firestore) {
      deleteDoc(doc(this.firestore, 'agent_commissions', id))
        .catch(err => console.warn('Firestore delete commission notice:', err?.message || err));
    }
  }

  // ---------------- Payments ----------------

  addPayment(data: {
    agentId: string;
    agentMobile: string;
    date: string;
    amount: number;
    note?: string;
  }): Promise<void> {
    const id = 'pay-' + Date.now() + '-' + Math.random().toString(36).slice(2, 7);
    const payment: CommissionPayment = {
      id,
      agentId: data.agentId,
      agentMobile: data.agentMobile || '',
      date: data.date,
      amount: data.amount || 0,
      note: (data.note || '').trim(),
      createdAt: new Date().toISOString()
    };

    this.paymentsSignal.update(list => {
      const next = this.sortPayments([payment, ...list]);
      this.savePaymentsToStorage(next);
      return next;
    });

    if (!this.firestore) return Promise.resolve();
    return setDoc(doc(this.firestore, 'agent_payments', id), payment)
      .catch(err => {
        console.warn('Firestore add payment notice:', err);
        throw err;
      });
  }

  deletePayment(id: string) {
    this.paymentsSignal.update(list => {
      const next = list.filter(p => p.id !== id);
      this.savePaymentsToStorage(next);
      return next;
    });

    if (this.firestore) {
      deleteDoc(doc(this.firestore, 'agent_payments', id))
        .catch(err => console.warn('Firestore delete payment notice:', err?.message || err));
    }
  }

  /** Drops every entry and payout belonging to an agent — called on delete. */
  deleteForAgent(agentId: string) {
    this.entriesFor(agentId).forEach(e => this.deleteEntry(e.id));
    this.paymentsFor(agentId).forEach(p => this.deletePayment(p.id));
  }
}
