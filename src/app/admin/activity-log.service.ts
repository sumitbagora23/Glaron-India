import { Injectable, signal, inject, Injector, runInInjectionContext } from '@angular/core';
import {
  Firestore, collection, doc, setDoc, deleteDoc, getDocs, onSnapshot, query, orderBy, limit, where
} from '@angular/fire/firestore';
import { DealerService } from './dealer.service';

/**
 * Activity logging — what dealers and agents actually do inside the app.
 *
 * The apps WRITE here (one small document per meaningful action); the admin
 * console READS the same collection on its Activity Logs tab. Nothing in the
 * dealer or agent UI ever renders a log entry — this is an admin-side record.
 *
 * Deliberately small documents: no images, no full carts, no addresses beyond
 * what the order itself already carries. An entry is a line the admin can read
 * at a glance ("Kumar Lights opened GLR-CUBE-59"), plus a few structured fields
 * the console filters on.
 *
 * This file is intentionally IDENTICAL in the dealer/agent app and the admin
 * console (see the notification service for the same arrangement) — the two
 * must agree on the document shape or the console can't read what the app
 * wrote.
 */

// Which side of the app the person is on. The one login form falls through
// dealer → agent, so this is decided by whichever session key is set.
export type ActivityRole = 'dealer' | 'agent';

// Broad grouping used by the console's filter dropdown. Derived from the
// action, never stored by hand.
export type ActivitySection = 'session' | 'browse' | 'product' | 'cart' | 'order' | 'share' | 'account';

export interface ActivityLog {
  id: string;
  /** Epoch millis — ordering and the "time ago" column. */
  at: number;
  role: ActivityRole;
  /** Normalised 10-digit mobile — the only identity both apps agree on. */
  phone: string;
  /** Resolved business name at the time of the action ('' if not synced yet). */
  name: string;
  /** One of ACTIVITY_ACTIONS below. */
  action: string;
  /** Grouping for the console filter, derived from `action`. */
  section: ActivitySection;
  /** The human-readable line the console shows. */
  label: string;
  /** Optional second line (variant, search term, reason for a failure…). */
  detail?: string;

  // ---- Structured extras, all optional ----
  productId?: string;
  productName?: string;
  sku?: string;
  variant?: string;
  category?: string;
  /** Tab key inside the app: home / products / orders / commission. */
  tab?: string;
  qty?: number;
  /** Rupee value — cart line total or order grand total. */
  amount?: number;
  orderId?: string;
  /** Short device hint ("Android · Chrome"), for support questions. */
  device?: string;
}

/** Everything the apps are allowed to log, and where each one files. */
export const ACTIVITY_ACTIONS: Record<string, { section: ActivitySection; label: string }> = {
  // Session
  'app-open':        { section: 'session', label: 'Opened the app' },
  'sign-in':         { section: 'session', label: 'Signed in' },
  'sign-in-failed':  { section: 'session', label: 'Sign-in failed' },
  'sign-out':        { section: 'session', label: 'Signed out' },

  // Browsing
  'tab':             { section: 'browse', label: 'Switched tab' },
  'category':        { section: 'browse', label: 'Opened category' },
  'search':          { section: 'browse', label: 'Searched' },

  // Products
  'product-detail':  { section: 'product', label: 'Viewed product details' },
  'product-image':   { section: 'product', label: 'Zoomed product image' },
  'product-variants':{ section: 'product', label: 'Viewed product variants' },
  'product-enquiry': { section: 'product', label: 'Enquired on WhatsApp' },
  'product-share':   { section: 'product', label: 'Shared a product' },

  // Cart & checkout
  'cart-add':        { section: 'cart', label: 'Added to cart' },
  'cart-qty':        { section: 'cart', label: 'Changed cart quantity' },
  'cart-remove':     { section: 'cart', label: 'Removed from cart' },
  'checkout-open':   { section: 'cart', label: 'Opened checkout' },

  // Orders
  'order-placed':    { section: 'order', label: 'Placed an order' },
  'order-open':      { section: 'order', label: 'Opened an order' },

  // Sharing
  'post-share':      { section: 'share', label: 'Shared a post' },
  'branding-update': { section: 'share', label: 'Updated share branding' },

  // Account
  'profile-open':    { section: 'account', label: 'Opened profile' },
  'profile-update':  { section: 'account', label: 'Updated profile' },
  'price-mode':      { section: 'account', label: 'Changed price display' },
  'price-custom':    { section: 'account', label: 'Saved custom prices' },
  'price-reset':     { section: 'account', label: 'Reset custom prices' },
  'call':            { section: 'account', label: 'Called Glaron' },
  'whatsapp':        { section: 'account', label: 'Messaged Glaron' },
};

/** The section an action files under; anything unrecognised counts as browsing. */
export function activitySection(action?: string): ActivitySection {
  return ACTIVITY_ACTIONS[action || '']?.section || 'browse';
}

// The sections, in the order the console lists them.
export const ACTIVITY_SECTIONS: { key: ActivitySection; label: string }[] = [
  { key: 'session', label: 'Sign in / out' },
  { key: 'browse',  label: 'Browsing' },
  { key: 'product', label: 'Products' },
  { key: 'cart',    label: 'Cart & checkout' },
  { key: 'order',   label: 'Orders' },
  { key: 'share',   label: 'Sharing' },
  { key: 'account', label: 'Account' },
];

// Session keys, duplicated here rather than imported so this service pulls in
// no auth code — it is loaded by both apps and by the console.
const DEALER_KEY = 'glaron_logged_dealer_mobile';
const AGENT_KEY = 'glaron_logged_agent_mobile';

function readKey(key: string): string {
  try {
    return localStorage.getItem(key) || sessionStorage.getItem(key) || '';
  } catch (e) {
    return '';
  }
}

/** Reduce any mobile number to the ten digits every side keys on. */
export function normaliseActor(input?: string | null): string {
  const digits = String(input || '').replace(/\D/g, '');
  return digits.length > 10 ? digits.slice(-10) : digits;
}

// A short, readable device hint. Not fingerprinting — just enough to answer
// "were they on a phone?" when a dealer reports something odd.
function deviceHint(): string {
  const ua = (typeof navigator !== 'undefined' ? navigator.userAgent : '') || '';
  const os = /iPhone|iPad|iPod/i.test(ua) ? 'iOS'
    : /Android/i.test(ua) ? 'Android'
    : /Windows/i.test(ua) ? 'Windows'
    : /Mac OS X/i.test(ua) ? 'Mac'
    : '';
  const browser = /EdgA?\//i.test(ua) ? 'Edge'
    : /OPR\//i.test(ua) ? 'Opera'
    : /Chrome\//i.test(ua) ? 'Chrome'
    : /Safari\//i.test(ua) ? 'Safari'
    : /Firefox\//i.test(ua) ? 'Firefox'
    : '';
  return [os, browser].filter(Boolean).join(' · ');
}

/** Optional fields a caller can attach to an entry. */
export interface ActivityExtras {
  detail?: string;
  productId?: string;
  productName?: string;
  sku?: string;
  variant?: string;
  category?: string;
  tab?: string;
  qty?: number;
  amount?: number;
  orderId?: string;
  /** Force the actor instead of reading the session (used at sign-in time). */
  role?: ActivityRole;
  phone?: string;
  name?: string;
}

@Injectable({ providedIn: 'root' })
export class ActivityLogService {
  private firestore = inject(Firestore, { optional: true });
  private injector = inject(Injector);
  // Only used to put a business name on the entry. Optional so the console —
  // which reads logs but never writes them — doesn't depend on it either way.
  private dealerService = inject(DealerService, { optional: true });

  private readonly COL = 'activity_logs';
  // How many entries the console holds in memory. Enough for a few days of a
  // handful of dealers without turning the page into a download.
  private readonly FEED_LIMIT = 500;

  // ---- Write-side noise control ----
  // Tapping between tabs, or a product card that opens two modals at once,
  // would otherwise write near-identical rows a few milliseconds apart.
  private lastKey = '';
  private lastAt = 0;
  private static readonly DEDUPE_MS = 2500;

  // 'app-open' is worth one entry per launch, not one per navigation.
  private openedLogged = false;
  // …and a relaunch a couple of minutes after the last one is the same visit
  // continuing (a reload, a phone unlock, coming back from the share sheet), so
  // the last one is remembered across launches and re-opens inside this window
  // are not written.
  private static readonly OPEN_WINDOW_MS = 30 * 60 * 1000;
  private static readonly LAST_OPEN_KEY = 'glaron_activity_last_open';

  // ---- Read side (admin console) ----
  private logsSignal = signal<ActivityLog[]>([]);
  private listening = false;

  // ------------------------------------------------------------------
  // Writing (dealer / agent apps)
  // ------------------------------------------------------------------

  /**
   * Record one action. Fire-and-forget: nothing in the app waits on it and a
   * rejected write is swallowed, because a dealer must never be blocked from
   * ordering because logging failed.
   *
   * Entries with no signed-in actor are dropped — an unattributed row tells the
   * admin nothing.
   */
  log(action: string, label?: string, extras: ActivityExtras = {}): void {
    try {
      this.write(action, label, extras);
    } catch (e) {
      // Logging must never surface to the person using the app.
    }
  }

  /** One 'Opened the app' entry per visit. Safe to call on every page entry. */
  logAppOpen(): void {
    if (this.openedLogged) return;
    this.openedLogged = true;

    const now = Date.now();
    try {
      const last = parseInt(localStorage.getItem(ActivityLogService.LAST_OPEN_KEY) || '0', 10) || 0;
      if (now - last < ActivityLogService.OPEN_WINDOW_MS) return;
      localStorage.setItem(ActivityLogService.LAST_OPEN_KEY, String(now));
    } catch (e) {
      // No storage — fall through and log it; one entry per launch is still right.
    }

    this.log('app-open', 'Opened the app');
  }

  private write(action: string, label: string | undefined, extras: ActivityExtras) {
    if (!this.firestore) return;

    const role = extras.role || this.currentRole();
    const phone = normaliseActor(extras.phone || (role === 'agent' ? readKey(AGENT_KEY) : readKey(DEALER_KEY)));
    if (!role || !phone) return;

    const text = (label || ACTIVITY_ACTIONS[action]?.label || action || '').trim();
    if (!text) return;

    // Collapse repeats of the same line fired in quick succession.
    const key = `${action}|${text}|${extras.detail || ''}`;
    const now = Date.now();
    if (key === this.lastKey && now - this.lastAt < ActivityLogService.DEDUPE_MS) return;
    this.lastKey = key;
    this.lastAt = now;

    const id = 'a-' + now + '-' + Math.floor(1000 + Math.random() * 9000);
    const entry: ActivityLog = {
      id,
      at: now,
      role,
      phone,
      name: extras.name || this.resolveName(role, phone),
      action,
      section: activitySection(action),
      label: text,
      device: deviceHint(),
      ...(extras.detail ? { detail: extras.detail } : {}),
      ...(extras.productId ? { productId: extras.productId } : {}),
      ...(extras.productName ? { productName: extras.productName } : {}),
      ...(extras.sku ? { sku: extras.sku } : {}),
      ...(extras.variant ? { variant: extras.variant } : {}),
      ...(extras.category ? { category: extras.category } : {}),
      ...(extras.tab ? { tab: extras.tab } : {}),
      ...(typeof extras.qty === 'number' ? { qty: extras.qty } : {}),
      ...(typeof extras.amount === 'number' ? { amount: extras.amount } : {}),
      ...(extras.orderId ? { orderId: extras.orderId } : {}),
    };

    setDoc(doc(this.firestore, this.COL, id), entry).catch(() => {});
  }

  // Which side is signed in on this device. An agent session wins: the login
  // form only ever sets one of the two, and the agent key is the later fallback.
  private currentRole(): ActivityRole | '' {
    if (readKey(AGENT_KEY)) return 'agent';
    if (readKey(DEALER_KEY)) return 'dealer';
    return '';
  }

  // Best-effort business name. Only dealers are resolvable from here (the agent
  // list lives outside this folder); an agent entry carries its number and the
  // console fills the name in from its own agent list.
  private resolveName(role: ActivityRole, phone: string): string {
    if (role !== 'dealer' || !this.dealerService) return '';
    try {
      return this.dealerService.findByMobile(phone)?.name || '';
    } catch (e) {
      return '';
    }
  }

  // ------------------------------------------------------------------
  // Reading (admin console)
  // ------------------------------------------------------------------

  /** Subscribe the console to the live activity feed, newest first. */
  start(): void {
    if (this.listening || !this.firestore) return;
    this.listening = true;
    const col = collection(this.firestore, this.COL);
    runInInjectionContext(this.injector, () =>
      onSnapshot(
        query(col, orderBy('at', 'desc'), limit(this.FEED_LIMIT)),
        (snap) => {
          const list: ActivityLog[] = [];
          snap.forEach((d) => {
            const data = d.data() as ActivityLog;
            if (data && data.at) list.push(data);
          });
          this.logsSignal.set(list);
        },
        (err) => console.warn('Firestore activity feed notice:', (err as any)?.message || err)
      )
    );
  }

  /** Everything currently loaded, newest first. */
  get logs(): ActivityLog[] {
    return this.logsSignal();
  }

  /** Remove a single entry. */
  async remove(id: string): Promise<void> {
    if (!this.firestore || !id) return;
    await deleteDoc(doc(this.firestore, this.COL, id)).catch(() => {});
  }

  /**
   * Delete entries older than `days`. The feed is a rolling record, not an
   * archive — this is how the console keeps it from growing without bound.
   * Returns how many documents were removed.
   */
  async purgeOlderThan(days: number): Promise<number> {
    if (!this.firestore) return 0;
    const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
    const col = collection(this.firestore, this.COL);
    const snap = await runInInjectionContext(this.injector, () =>
      getDocs(query(col, where('at', '<', cutoff), limit(400)))
    );
    let removed = 0;
    for (const d of snap.docs) {
      await deleteDoc(d.ref).catch(() => {});
      removed++;
    }
    return removed;
  }
}
