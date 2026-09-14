import { Injectable, signal, inject } from '@angular/core';
import { Firestore, collection, doc, setDoc, onSnapshot, deleteDoc } from '@angular/fire/firestore';
import { SettingsService } from './settings.service';
import { writeDocViaRest, deleteDocViaRest, listCollectionViaRest } from './firestore-rest';

export type DealerStatus = 'Active' | 'Inactive';

export interface Dealer {
  id?: string;
  initial: string;
  name: string;
  location: string;
  // Legacy records may still carry 'Pending Approval'; treat any non-'Active'
  // value as 'Inactive' when displaying/filtering.
  status: DealerStatus | 'Pending Approval';
  multiplier: number;
  isCustom: boolean;
  // The dealer's 10-digit mobile number — this is their login identity.
  phone: string;
  // Salted hash of the dealer's password (see DealerAuthService). Absent on
  // legacy records created under the old email/Firebase sign-in.
  passwordHash?: string;
  contactPerson?: string;
  // Optional profile field only — never used to sign in.
  email?: string;
  address?: string;
  state?: string;
  city?: string;
  pincode?: string;
  gstNumber?: string;
  submittedAt?: string;
  customPrices?: Record<string, number>;
}

const PREDEFINED_DEALER_NAMES = [
  'apex lighting solutions',
  'bright solutions ltd.',
  'bright solutions ltd',
  'lumina industrial',
  'crest electricals'
];

@Injectable({
  providedIn: 'root'
})
export class DealerService {
  private STORAGE_KEY = 'glaron_real_dealers_list_v4';
  private firestore = inject(Firestore, { optional: true });
  private settingsService = inject(SettingsService);

  private dealersSignal = signal<Dealer[]>(this.loadFromStorage());

  // True once Firestore has delivered at least one snapshot of the dealers list.
  // Used to safely decide whether a logged-in dealer still exists (a deleted
  // dealer must be locked out) without false-positives during initial load.
  hasSynced = false;
  private readyResolvers: Array<() => void> = [];

  // True once the list has come from the server itself — a REST read or a live
  // (non-cache) snapshot. Until then a cache-only snapshot is the best we have;
  // after it, a cache-only snapshot must not put the stale copy back.
  private serverSeen = false;
  // Writes in flight. A REST refresh is skipped while one is pending so it can't
  // flip a row back to its old value between the optimistic update and the ack.
  private pendingWrites = 0;
  private refreshInFlight: Promise<void> | null = null;
  // How often the server list is re-read over REST while the tab is visible.
  private static readonly REFRESH_MS = 30_000;

  constructor() {
    this.clearLegacyStorage();
    this.initFirestoreSync();
  }

  // Resolves when the dealer list has synced from Firestore (or after a short
  // timeout / when Firestore is unavailable) so callers never hang.
  whenReady(timeoutMs = 4000): Promise<void> {
    if (this.hasSynced || !this.firestore) return Promise.resolve();
    return new Promise<void>(resolve => {
      let settled = false;
      const finish = () => { if (!settled) { settled = true; resolve(); } };
      this.readyResolvers.push(finish);
      setTimeout(finish, timeoutMs);
    });
  }

  private markSynced() {
    this.hasSynced = true;
    const resolvers = this.readyResolvers;
    this.readyResolvers = [];
    resolvers.forEach(r => r());
  }

  // Reduce any typed/stored number to the bare 10 digits accounts are keyed by.
  private normalizePhone(value: string | null | undefined): string {
    const digits = (value || '').replace(/\D/g, '');
    return digits.length > 10 ? digits.slice(-10) : digits;
  }

  // Find a dealer by their mobile number — the dealer login identity. Stored
  // numbers may carry spaces / +91 from older records, so both sides are
  // normalised before comparing.
  findByMobile(mobile: string): Dealer | undefined {
    const target = this.normalizePhone(mobile);
    if (target.length !== 10) return undefined;
    return this.dealers.find(d => this.normalizePhone(d.phone) === target);
  }

  private clearLegacyStorage() {
    try {
      localStorage.removeItem('glaron_dealers');
      localStorage.removeItem('glaron_dealers_list');
      localStorage.removeItem('glaron_dealers_list_v2');
      localStorage.removeItem('glaron_real_dealers_list');
      localStorage.removeItem('glaron_real_dealers_list_v2');
      localStorage.removeItem('glaron_real_dealers_list_v3');
    } catch (e) {}
  }

  private initFirestoreSync() {
    if (!this.firestore) return;
    try {
      const dealersCol = collection(this.firestore, 'dealers');
      onSnapshot(dealersCol, (snapshot) => {
        // The SDK's streaming connection is silently blocked on some networks
        // (see firestore-rest.ts). It then keeps replaying the on-device cache,
        // and a registration that did reach the server never shows up here.
        // Once the server list has been seen — over REST below or from a live
        // snapshot — a cache-only replay must not overwrite it.
        if (snapshot.metadata.fromCache && this.serverSeen) return;

        const realDealers: Dealer[] = [];
        snapshot.forEach(docSnap => {
          const data = docSnap.data() as Dealer;
          if (this.isPredefined(data)) {
            // If it's an old predefined dealer, delete it from Firestore!
            if (this.firestore && docSnap.id) {
              deleteDoc(doc(this.firestore, 'dealers', docSnap.id)).catch(() => {});
            }
          } else {
            realDealers.push(data);
          }
        });

        if (!snapshot.metadata.fromCache) this.serverSeen = true;
        this.applyServerList(realDealers);
      }, (err) => {
        console.warn('Firestore dealers notice:', err);
        // Unblock any waiters even on error (fail-open — don't lock dealers out)
        this.readyResolvers.forEach(r => r());
        this.readyResolvers = [];
      });
    } catch (e) {
      console.warn('Firestore dealers init notice:', e);
    }

    // Plain-HTTPS read of the same list. It lands even where the stream is
    // blocked, so the admin sees a new registration — and a dealer sees their
    // approval — within one refresh interval whatever the network does.
    this.refreshFromServer();
    if (typeof document !== 'undefined') {
      setInterval(() => {
        if (document.visibilityState === 'visible') this.refreshFromServer();
      }, DealerService.REFRESH_MS);
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') this.refreshFromServer();
      });
    }
  }

  private isPredefined(d: { name?: string }): boolean {
    const nameLower = (d.name || '').toLowerCase().trim();
    return PREDEFINED_DEALER_NAMES.some(p => nameLower.includes(p));
  }

  private applyServerList(list: Dealer[]) {
    this.dealersSignal.set(list);
    this.saveToStorage(list);
    this.markSynced();
  }

  // Re-read the whole dealers collection over REST and adopt it as the list.
  // Skipped while a write is in flight (its optimistic state wins; the refresh
  // after its ack catches up) and de-duplicated while one is already running.
  refreshFromServer(): Promise<void> {
    if (!this.firestore) return Promise.resolve();
    if (this.pendingWrites > 0) return Promise.resolve();
    if (this.refreshInFlight) return this.refreshInFlight;

    this.refreshInFlight = listCollectionViaRest(this.firestore, 'dealers')
      .then(docs => {
        if (this.pendingWrites > 0) return;
        const list = docs
          .map(d => {
            const data = d.data as unknown as Dealer;
            return { ...data, id: data.id || d.id };
          })
          .filter(d => !this.isPredefined(d));
        this.serverSeen = true;
        this.applyServerList(list);
      })
      .catch(err => {
        // Offline or blocked: the stream (or the on-device cache) still serves.
        console.warn('Firestore dealers refresh notice:', err?.message || err);
      })
      .finally(() => { this.refreshInFlight = null; });
    return this.refreshInFlight;
  }

  /**
   * Persist one dealer document. Plain HTTPS first: it lands at once even where
   * the SDK's streaming write is silently queued (a registration recently took
   * 7½ minutes to reach the server through that queue). The SDK write is only
   * the fallback when REST itself fails (offline). Running both would let a
   * stalled SDK copy land minutes later on top of a newer REST write — e.g. an
   * admin's approval reverted by the registration that preceded it.
   *
   * Resolves when the document is on the server, or — on the SDK fallback —
   * after a short grace so an offline, queued write is accepted rather than
   * hung on. Rejects if the write is refused.
   */
  private async persistDealer(id: string, dealer: Dealer, label: string): Promise<void> {
    if (!this.firestore) return;
    this.pendingWrites++;
    try {
      try {
        await writeDocViaRest(this.firestore, 'dealers', id, dealer as unknown as Record<string, unknown>);
      } catch (restErr) {
        console.warn(`Firestore ${label} notice (REST):`, restErr);
        const sdk = setDoc(doc(this.firestore, 'dealers', id), dealer);
        sdk.catch(() => { /* surfaced through the race below if it fails in time */ });
        await Promise.race([
          sdk,
          new Promise<void>(resolve => setTimeout(resolve, 8000))
        ]);
      }
    } finally {
      this.pendingWrites--;
      if (this.pendingWrites === 0) this.refreshFromServer();
    }
  }

  private loadFromStorage(): Dealer[] {
    try {
      const stored = localStorage.getItem(this.STORAGE_KEY);
      if (stored) {
        const parsed: Dealer[] = JSON.parse(stored);
        return parsed.filter(d => !PREDEFINED_DEALER_NAMES.some(p => (d.name || '').toLowerCase().includes(p)));
      }
    } catch (e) {
      console.error('Error loading dealers from localStorage', e);
    }
    this.saveToStorage([]);
    return [];
  }

  private saveToStorage(dealers: Dealer[]) {
    try {
      const cleanDealers = dealers.filter(d => !PREDEFINED_DEALER_NAMES.some(p => (d.name || '').toLowerCase().includes(p)));
      localStorage.setItem(this.STORAGE_KEY, JSON.stringify(cleanDealers));
    } catch (e) {
      console.error('Error saving dealers to localStorage', e);
    }
  }

  get dealers(): Dealer[] {
    return this.dealersSignal().filter(d => !PREDEFINED_DEALER_NAMES.some(p => (d.name || '').toLowerCase().includes(p)));
  }

  addDealer(dealerData: {
    name: string;
    contactPerson?: string;
    email?: string;
    phone: string;
    address: string;
    state?: string;
    city?: string;
    pincode?: string;
    gstNumber?: string;
    location?: string;
    status?: DealerStatus;
    passwordHash?: string;
  }): Promise<void> {
    const mobile = this.normalizePhone(dealerData.phone);
    // Dealers are keyed by mobile number (their login identity) so the same
    // number can never end up on two documents. Records created before mobile
    // login keep their original name-slug id — reuse it so a returning dealer
    // updates their existing row instead of spawning a duplicate.
    const existing = mobile.length === 10 ? this.findByMobile(mobile) : undefined;
    const id = existing?.id
      || (mobile.length === 10
        ? 'd-' + mobile
        : (dealerData.name || 'dealer-' + Date.now()).toLowerCase().replace(/[^a-z0-9]/g, '-'));
    const newDealer: Dealer = {
      id,
      name: dealerData.name,
      contactPerson: dealerData.contactPerson || dealerData.name,
      email: dealerData.email || '',
      phone: mobile || dealerData.phone,
      // Keep any password already on the record when the admin re-saves a dealer
      // without supplying one.
      passwordHash: dealerData.passwordHash || existing?.passwordHash || '',
      address: dealerData.address,
      state: dealerData.state || '',
      city: dealerData.city || '',
      pincode: dealerData.pincode || '',
      gstNumber: dealerData.gstNumber || '',
      location: dealerData.location || dealerData.address,
      initial: dealerData.name.charAt(0).toUpperCase() || 'D',
      status: dealerData.status || 'Active',
      multiplier: 1.00,
      isCustom: false,
      submittedAt: new Date().toISOString(),
      customPrices: {}
    };

    this.dealersSignal.update(dealers => {
      const filtered = dealers.filter(d => d.id !== id && !PREDEFINED_DEALER_NAMES.some(p => (d.name || '').toLowerCase().includes(p)));
      const newList = [newDealer, ...filtered];
      this.saveToStorage(newList);
      return newList;
    });

    if (!this.firestore) return Promise.resolve();

    // The dealers document is the record of truth — a registration that doesn't
    // land there is lost the moment the next Firestore snapshot replaces the
    // local list, so its result is surfaced to the caller rather than swallowed.
    // The application copy is best-effort.
    writeDocViaRest(this.firestore, 'dealer_applications', id, newDealer as unknown as Record<string, unknown>)
      .catch(err => console.warn('Firestore application notice:', err));
    return this.persistDealer(id, newDealer, 'add dealer')
      .catch(err => {
        console.warn('Firestore add dealer notice:', err);
        throw err;
      });
  }

  // Lets a dealer edit their own contact details (name, phone, email, address,
  // state, city, pincode) from the dealer panel profile. Pricing/status fields
  // are left untouched.
  updateDealerProfile(id: string, data: { name?: string; phone?: string; email?: string; address?: string; state?: string; city?: string; pincode?: string }) {
    this.dealersSignal.update(dealers => {
      const newList = dealers.map(d => {
        if (d.id === id) {
          const name = (data.name ?? d.name)?.trim() || d.name;
          const address = (data.address ?? d.address ?? '').trim();
          const state = (data.state ?? d.state ?? '').trim();
          const city = (data.city ?? d.city ?? '').trim();
          const pincode = (data.pincode ?? d.pincode ?? '').trim();
          // A readable location line combining city, state & pincode (falls back
          // to the address when those aren't set).
          const composed = [city, state].filter(Boolean).join(', ') + (pincode ? ' - ' + pincode : '');
          return {
            ...d,
            name,
            initial: name.charAt(0).toUpperCase() || d.initial,
            // Normalised so the login identity always stays the bare 10 digits.
            phone: this.normalizePhone(data.phone ?? d.phone) || d.phone,
            email: (data.email ?? d.email ?? '').trim(),
            address,
            state,
            city,
            pincode,
            // Keep the display location in sync with city/state/pincode (or address).
            location: composed.trim() || address || d.location
          };
        }
        return d;
      });
      this.saveToStorage(newList);
      return newList;
    });

    if (this.firestore) {
      const target = this.dealersSignal().find(d => d.id === id);
      if (target && target.id) {
        this.persistDealer(target.id, target, 'update profile')
          .catch(err => console.warn('Firestore update profile notice:', err));
      }
    }
  }

  // Store a new password hash for a dealer. Called by DealerAuthService — it
  // owns the hashing, this only persists the result.
  updateDealerPassword(id: string, passwordHash: string) {
    this.dealersSignal.update(dealers => {
      const newList = dealers.map(d => d.id === id ? { ...d, passwordHash } : d);
      this.saveToStorage(newList);
      return newList;
    });

    if (this.firestore) {
      const target = this.dealersSignal().find(d => d.id === id);
      if (target) {
        this.persistDealer(id, target, 'update password')
          .catch(err => console.warn('Firestore update password notice:', err));
      }
    }
  }

  updateDealerStatus(id: string, status: DealerStatus) {
    this.dealersSignal.update(dealers => {
      const newList = dealers.map(d => d.id === id ? { ...d, status } : d);
      this.saveToStorage(newList);
      return newList;
    });

    if (this.firestore) {
      const target = this.dealersSignal().find(d => d.id === id);
      if (target) {
        this.persistDealer(id, target, 'update dealer')
          .catch(err => console.warn('Firestore update dealer notice:', err));
      }
    }
  }

  deleteDealer(id: string) {
    this.dealersSignal.update(dealers => {
      const newList = dealers.filter(d => d.id !== id);
      this.saveToStorage(newList);
      return newList;
    });

    // Drop the dealer from the offer-banner audience so the "x / y selected"
    // count can't keep counting dealers that no longer exist.
    this.pruneOfferDealerIds();

    if (this.firestore) {
      // Over REST for the same reason as persistDealer: a queued SDK delete can
      // sit for minutes, and a deleted dealer would keep signing in meanwhile.
      // The SDK delete is only the offline fallback, and isn't waited on.
      const fs = this.firestore;
      this.pendingWrites++;
      Promise.all([
        deleteDocViaRest(fs, 'dealers', id).catch(err => {
          console.warn('Firestore delete dealer notice:', err);
          deleteDoc(doc(fs, 'dealers', id)).catch(() => {});
        }),
        deleteDocViaRest(fs, 'dealer_applications', id).catch(() => {
          deleteDoc(doc(fs, 'dealer_applications', id)).catch(() => {});
        })
      ]).finally(() => {
        this.pendingWrites--;
        if (this.pendingWrites === 0) this.refreshFromServer();
      });
    }
  }

  // Removes offer-banner audience ids that no longer match a real dealer.
  // Only called right after a delete, when the local list is known-good.
  private pruneOfferDealerIds() {
    const existing = new Set(this.dealersSignal().map(d => d.id).filter(Boolean) as string[]);
    const current = this.settingsService.offerDealerIds;
    const kept = current.filter(id => existing.has(id));
    if (kept.length !== current.length) {
      this.settingsService.updateOfferDealerIds(kept)
        .catch(err => console.warn('Firestore settings notice:', err?.message || err));
    }
  }

  updateDealerMultiplier(id: string, multiplier: number, customPrices?: Record<string, number>) {
    this.dealersSignal.update(dealers => {
      const newList: Dealer[] = dealers.map(d => {
        if (d.id === id || d.name === id) {
          const isCustom: boolean = Boolean(multiplier !== 1.0 || (customPrices && Object.keys(customPrices).length > 0));
          return {
            ...d,
            multiplier,
            isCustom,
            customPrices: customPrices || d.customPrices || {}
          };
        }
        return d;
      });
      this.saveToStorage(newList);
      return newList;
    });

    if (this.firestore) {
      const target = this.dealersSignal().find(d => d.id === id || d.name === id);
      if (target && target.id) {
        this.persistDealer(target.id, target, 'update multiplier')
          .catch(err => console.warn('Firestore update multiplier notice:', err));
      }
    }
  }
}
