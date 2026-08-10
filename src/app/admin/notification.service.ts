import { Injectable, signal, inject, Injector, runInInjectionContext } from '@angular/core';
import {
  Firestore, collection, doc, setDoc, deleteDoc, onSnapshot, query, orderBy, limit,
  where, getDocs, addDoc
} from '@angular/fire/firestore';
import { Messaging, getToken, onMessage } from '@angular/fire/messaging';
import { environment } from '../../environments/environment';

// Where the logged-in mobile number is kept, per kind of account (see
// app.routes DEALER_AUTH_KEY / AGENT_AUTH_KEY and the matching *_SESSION_KEY in
// the two auth services). Declared as literals to keep this service free of an
// import cycle with those services.
const DEALER_MOBILE_KEY = 'glaron_logged_dealer_mobile';
const AGENT_MOBILE_KEY = 'glaron_logged_agent_mobile';

// Which kind of account this device is signed in as. One app serves both.
type ReceiverRole = 'dealer' | 'agent';

// A single push notification the admin broadcasts to dealer and/or agent
// devices.
export interface PushNotification {
  id: string;
  title: string;
  body: string;
  // Epoch millis — used both for ordering and for the "have I already shown
  // this one?" check on the receiving side.
  createdAt: number;
  // Optional picture shown inside the notification, stored as a compact JPEG
  // data URL (same approach as banners/product images — no Firebase Storage).
  // It is far too large for an FCM payload, so the Cloud Function republishes
  // it at /notification-image/<id> and sends devices that short URL instead.
  image?: string;
  // Who receives it: dealers only, agents only, or both. Missing on documents
  // written before this field existed — those are dealer broadcasts.
  audience?: NotificationAudience;
  // Which screen a tap opens (a target key) and the path it resolves to in each
  // app. All three are plumbing only — none is ever rendered inside the
  // notification the dealer or agent sees. `url` is the dealer path (present
  // when dealers are in the audience), `agentUrl` the agent one.
  target?: string;
  url?: string;
  agentUrl?: string;
}

// ---------------- Audience ----------------

// Who a broadcast goes to.
export type NotificationAudience = 'dealer' | 'agent' | 'both';

export interface NotificationAudienceOption {
  key: NotificationAudience;
  label: string;
  // One-line explanation shown under the picker in the admin form.
  hint: string;
}

export const NOTIFICATION_AUDIENCES: NotificationAudienceOption[] = [
  { key: 'dealer', label: 'Dealers', hint: 'Only dealers receive this notification.' },
  { key: 'agent', label: 'Agents', hint: 'Only agents receive this notification.' },
  { key: 'both', label: 'Both', hint: 'Dealers and agents both receive this notification.' },
];

export const DEFAULT_NOTIFICATION_AUDIENCE: NotificationAudience = 'dealer';

// Normalise whatever is stored on (or typed into) a notification. Anything
// unrecognised — including the missing field on documents written before
// audiences existed — means dealers, which is what those broadcasts were.
export function resolveNotificationAudience(input?: string): NotificationAudience {
  const norm = (input || '').trim().toLowerCase().replace(/[^a-z]/g, '');
  if (norm === 'agent' || norm === 'agents') return 'agent';
  if (norm === 'both' || norm === 'all' || norm === 'everyone') return 'both';
  return 'dealer';
}

export function audienceIncludesDealer(input?: string): boolean {
  const a = resolveNotificationAudience(input);
  return a === 'dealer' || a === 'both';
}

export function audienceIncludesAgent(input?: string): boolean {
  const a = resolveNotificationAudience(input);
  return a === 'agent' || a === 'both';
}

export function notificationAudienceLabel(input?: string): string {
  const a = resolveNotificationAudience(input);
  return (NOTIFICATION_AUDIENCES.find((o) => o.key === a) || NOTIFICATION_AUDIENCES[0]).label;
}

// ---------------- Targets ----------------

// A screen the admin can point a notification at. The admin picks one by its
// friendly name; the path below is what a tap actually opens.
export interface NotificationTarget {
  key: string;
  label: string;
  url: string;
}

// The dealer PWA's tabs.
export const DEALER_NOTIFICATION_TARGETS: NotificationTarget[] = [
  { key: 'home', label: 'Home', url: '/dealer/catalog?tab=home' },
  { key: 'products', label: 'Products', url: '/dealer/catalog?tab=products' },
  { key: 'orders', label: 'Orders', url: '/dealer/catalog?tab=orders' },
  { key: 'profile', label: 'Profile', url: '/dealer/catalog?tab=profile' },
];

// The agent PWA's tabs. It has no orders or profile screen, and a commission
// ledger the dealer app doesn't have.
export const AGENT_NOTIFICATION_TARGETS: NotificationTarget[] = [
  { key: 'home', label: 'Home', url: '/agent/panel?tab=home' },
  { key: 'products', label: 'Products', url: '/agent/panel?tab=products' },
  { key: 'commission', label: 'Commission', url: '/agent/panel?tab=commission' },
];

// Kept for callers written before agents existed — the dealer list is what
// they have always meant.
export const NOTIFICATION_TARGETS = DEALER_NOTIFICATION_TARGETS;

export const DEFAULT_NOTIFICATION_TARGET = 'home';

/**
 * The screens a given audience can be pointed at.
 *
 * For "both" that is only what the two apps have in common, so one tap
 * destination lands somewhere real whichever app opens it.
 */
export function notificationTargets(audience?: string): NotificationTarget[] {
  const a = resolveNotificationAudience(audience);
  if (a === 'agent') return AGENT_NOTIFICATION_TARGETS;
  if (a === 'dealer') return DEALER_NOTIFICATION_TARGETS;
  return DEALER_NOTIFICATION_TARGETS.filter((d) =>
    AGENT_NOTIFICATION_TARGETS.some((g) => g.key === d.key)
  );
}

// Other names an admin might reasonably type for each tab. Matched after the
// input is lowercased and stripped of spaces/punctuation, so "My Orders",
// "my-orders" and "myorders" all land on the same tab.
const TARGET_ALIASES: Record<string, string> = {
  home: 'home', homepage: 'home', homescreen: 'home', main: 'home',
  category: 'home', categories: 'home', catalog: 'home', catalogue: 'home',
  products: 'products', product: 'products', allproducts: 'products', items: 'products', shop: 'products',
  orders: 'orders', order: 'orders', myorders: 'orders', myorder: 'orders', purchases: 'orders',
  profile: 'profile', myprofile: 'profile', account: 'profile', dealerprofile: 'profile',
  commission: 'commission', commissions: 'commission', earning: 'commission',
  earnings: 'commission', payout: 'commission', payouts: 'commission', ledger: 'commission',
};

/**
 * Turn whatever the admin typed (or picked) into a real destination.
 *
 * Accepts a tab key, its label, or any of the aliases above — case and spacing
 * don't matter — but only tabs the given audience's app actually has, so an
 * agent broadcast can never be pointed at the dealer's Orders tab. A hand-typed
 * site-relative path (e.g. `/dealer/checkout`) is accepted as-is so an unusual
 * destination is still reachable. Returns null when the text matches nothing,
 * so the caller can show an error rather than silently sending people somewhere
 * they didn't intend.
 */
export function resolveNotificationTarget(
  input?: string,
  audience?: string
): NotificationTarget | null {
  const raw = (input || '').trim();
  if (!raw) return null;

  const list = notificationTargets(audience);
  const norm = raw.toLowerCase().replace(/[^a-z0-9]/g, '');
  const key = TARGET_ALIASES[norm];
  if (key) return list.find((t) => t.key === key) || null;

  // A path typed by hand. Must be site-relative (a single leading slash) so it
  // can never point people off to another site.
  if (/^\/[^/\\]/.test(raw)) return { key: raw, label: raw, url: raw };

  return null;
}

// Resolve a target to the path it opens in the given audience's app.
// Unknown/missing values fall back to Home so an old notification still lands
// somewhere sensible.
export function notificationTargetUrl(key?: string, audience?: string): string {
  const list = notificationTargets(audience);
  return (resolveNotificationTarget(key, audience) || list[0]).url;
}

// Friendly name for a target — used by the admin panel only. A hand-typed path
// is shown back as typed.
export function notificationTargetLabel(key?: string, audience?: string): string {
  const list = notificationTargets(audience);
  return (resolveNotificationTarget(key, audience) || list[0]).label;
}

/**
 * Broadcast notifications from the admin panel, and receive them here.
 *
 * The admin always writes a document to the Firestore `notifications`
 * collection, stamped with the audience they chose — dealers, agents or both.
 * Delivery to a device then happens two ways:
 *
 * 1. **FCM (primary)** — a Cloud Function triggers on the new document and
 *    pushes it to the token collection(s) that audience covers, so it arrives
 *    even when the PWA is fully closed. Requires the Blaze plan + a VAPID key
 *    (environment.fcmVapidKey) + the deployed function.
 *
 * 2. **Firestore listener (fallback)** — every device also runs a live
 *    `onSnapshot`; if FCM isn't set up yet (no VAPID key / token), it raises
 *    the OS notification itself while the app is open or backgrounded. Once
 *    FCM is active on a device this path suppresses itself to avoid duplicates.
 *
 * Dealers and agents share this one installed app, so a device registers on the
 * side it is signed in as (see startDealerListener / startAgentListener) and
 * ignores the broadcasts addressed to the other.
 */
@Injectable({
  providedIn: 'root'
})
export class NotificationService {
  private firestore = inject(Firestore, { optional: true });
  private messaging = inject(Messaging, { optional: true });
  private injector = inject(Injector);

  private readonly COL = 'notifications';

  // Dealers and agents are one installed app behind one link; only the account
  // signed in on this device differs. That role decides three things: which
  // token collection this device registers in, which broadcasts it shows, and
  // where a tap lands.
  private readonly TOKENS_COLS: Record<ReceiverRole, string> = {
    dealer: 'dealer_tokens',
    agent: 'agent_tokens',
  };
  // Highest createdAt this device has already surfaced, so reopening the app
  // never re-fires an old notification and offline-missed ones still arrive.
  // Kept per role — the two sides see different broadcasts.
  private readonly SEEN_KEYS: Record<ReceiverRole, string> = {
    dealer: 'glaron_last_seen_notification_ts',
    agent: 'glaron_last_seen_agent_notification_ts',
  };
  private readonly MOBILE_KEYS: Record<ReceiverRole, string> = {
    dealer: DEALER_MOBILE_KEY,
    agent: AGENT_MOBILE_KEY,
  };

  // Admin-facing "recently sent" feed.
  private recentSignal = signal<PushNotification[]>([]);
  private adminListening = false;

  // Which side this device is currently signed in as, and which roles already
  // have a listener running. The shared login screen starts the dealer side
  // before anyone has signed in, so an agent signing in there switches the role
  // afterwards — see startListener().
  private role: ReceiverRole = 'dealer';
  private startedRoles = new Set<ReceiverRole>();

  // True once FCM has issued a token on this device — the Firestore fallback
  // then stops showing notifications so the two paths never double up.
  private fcmActive = false;
  // This device's FCM token, kept so it can be moved between collections when
  // the role changes.
  private token = '';

  // ---------------- Admin side ----------------

  // Subscribe the admin settings page to the recent-notifications feed.
  startAdminFeed() {
    if (this.adminListening || !this.firestore) return;
    this.adminListening = true;
    const col = collection(this.firestore, this.COL);
    runInInjectionContext(this.injector, () =>
      onSnapshot(
        query(col, orderBy('createdAt', 'desc'), limit(20)),
        (snap) => {
          const list: PushNotification[] = [];
          snap.forEach((d) => list.push(d.data() as PushNotification));
          this.recentSignal.set(list);
        },
        (err) => console.warn('Firestore notifications feed notice:', (err as any)?.message || err)
      )
    );
  }

  get recent(): PushNotification[] {
    return this.recentSignal();
  }

  // Broadcast a notification to every device in `audience` — dealers, agents,
  // or both. `target` is the screen a tap opens — a tab name the admin typed or
  // picked (see resolveNotificationTarget). It travels as metadata only and
  // never shows up in the notification text; because the two apps lay their
  // tabs out differently, the tab is resolved once per app and both paths ride
  // along on the document.
  //
  // `image` is an optional JPEG data URL — it rides along on the document and
  // ends up as the picture inside the notification.
  async send(
    title: string,
    body: string,
    target: string = DEFAULT_NOTIFICATION_TARGET,
    image?: string | null,
    audience: NotificationAudience = DEFAULT_NOTIFICATION_AUDIENCE
  ): Promise<void> {
    const t = (title || '').trim();
    const b = (body || '').trim();
    if (!t && !b) return;
    const aud = resolveNotificationAudience(audience);
    const dealerTarget = audienceIncludesDealer(aud)
      ? resolveNotificationTarget(target, 'dealer') || DEALER_NOTIFICATION_TARGETS[0]
      : null;
    const agentTarget = audienceIncludesAgent(aud)
      ? resolveNotificationTarget(target, 'agent') || AGENT_NOTIFICATION_TARGETS[0]
      : null;
    const createdAt = Date.now();
    const id = 'n-' + createdAt;
    const payload: PushNotification = {
      id, title: t, body: b, createdAt,
      audience: aud,
      target: (dealerTarget || agentTarget)!.key,
      ...(dealerTarget ? { url: dealerTarget.url } : {}),
      ...(agentTarget ? { agentUrl: agentTarget.url } : {}),
      ...(image ? { image } : {})
    };
    if (this.firestore) {
      await setDoc(doc(this.firestore, this.COL, id), payload);
    }
  }

  // Remove a previously sent notification from the feed.
  async remove(id: string): Promise<void> {
    if (this.firestore) {
      await deleteDoc(doc(this.firestore, this.COL, id)).catch(() => {});
    }
  }

  // ---------------- Receiving side (dealer / agent) ----------------

  // Start receiving broadcasts on a dealer device. Idempotent — safe to call
  // from every dealer page. Sets up FCM (closed-app push) and the Firestore
  // fallback (open/background) together.
  startDealerListener() {
    this.startListener('dealer');
  }

  // The same, for a device signed in as an agent. Registers in the agent token
  // collection and shows only the broadcasts addressed to agents.
  startAgentListener() {
    this.startListener('agent');
  }

  /**
   * Bind this device to one side of the app and start listening.
   *
   * The sign-in screen is shared, and it starts the dealer side before anyone
   * has signed in — so an agent signing in there arrives here a second time
   * with a different role. That switch has to move this device's push token out
   * of `dealer_tokens` and into `agent_tokens`, or it would keep receiving the
   * dealer broadcasts it is no longer entitled to.
   *
   * The listeners already running keep running; every one of them reads the
   * CURRENT role when a broadcast arrives, so they all agree on what to show.
   */
  private startListener(role: ReceiverRole) {
    if (!this.firestore) return;

    const switched = this.role !== role;
    this.role = role;
    if (switched && this.token) this.syncToken();

    if (this.startedRoles.has(role)) return;
    const first = this.startedRoles.size === 0;
    this.startedRoles.add(role);

    if (first) this.setupPush();
    this.startFirestoreFallback();
  }

  // Is this broadcast addressed to the side this device is signed in as?
  private wantsBroadcast(n: PushNotification): boolean {
    return this.role === 'agent'
      ? audienceIncludesAgent(n.audience)
      : audienceIncludesDealer(n.audience);
  }

  // Where a tap on this broadcast should land, in this device's panel. The two
  // panels lay their tabs out differently, so the admin resolves the chosen tab
  // for each and writes both paths onto the document; the target key is the
  // fallback for documents written before that.
  private tapUrl(n: PushNotification): string {
    if (this.role === 'agent') {
      const raw = String(n.agentUrl || '');
      return /^\/[^/\\]/.test(raw) ? raw : notificationTargetUrl(n.target, 'agent');
    }
    return n.url || notificationTargetUrl(n.target);
  }

  // ---- FCM: true push that reaches a fully-closed app ----

  // Register for push once the dealer grants notification permission. Browsers
  // require a user gesture to prompt, so if not yet decided we wait for the
  // first tap; if already granted we register immediately.
  private setupPush() {
    if (typeof Notification === 'undefined') return;
    if (Notification.permission === 'granted') { this.registerFcm(); return; }
    if (Notification.permission === 'denied') return;
    const ask = async () => {
      window.removeEventListener('click', ask);
      window.removeEventListener('touchstart', ask);
      try {
        const perm = await Notification.requestPermission();
        if (perm === 'granted') this.registerFcm();
      } catch (e) {}
    };
    window.addEventListener('click', ask, { once: true });
    window.addEventListener('touchstart', ask, { once: true });
  }

  // Obtain (or refresh) this device's FCM token, store it so the Cloud Function
  // can reach it, and start handling foreground messages. Silently no-ops until
  // the VAPID key is configured — the Firestore fallback covers that window.
  private async registerFcm() {
    if (!this.messaging || this.fcmActive) return;
    const vapidKey = (environment as any).fcmVapidKey as string;
    if (!vapidKey) return; // FCM not configured yet → rely on the fallback.

    try {
      // Register the FCM service worker at its OWN scope so it never collides
      // with Angular's ngsw-worker.js (which owns scope '/'). Registering it at
      // '/' conflicts with ngsw and can stop getToken() from issuing a token.
      let swReg: ServiceWorkerRegistration | undefined;
      if (navigator.serviceWorker) {
        swReg = (await navigator.serviceWorker
          .register('/firebase-messaging-sw.js', { scope: '/firebase-cloud-messaging-push-scope' })
          .catch(() => undefined)) || undefined;
      }

      const token = await runInInjectionContext(this.injector, () =>
        getToken(this.messaging!, swReg ? { vapidKey, serviceWorkerRegistration: swReg } : { vapidKey })
      );
      if (!token) return;

      this.fcmActive = true;
      this.token = token;
      await this.saveToken(token);

      // FCM does NOT auto-display messages while the app is focused, so show
      // them ourselves. (Background/closed messages are shown by the SW.)
      runInInjectionContext(this.injector, () =>
        onMessage(this.messaging!, (payload) => {
          // Read both halves of the payload: the text can arrive in either the
          // notification or the data block depending on how it was sent, and
          // the tap destination only ever rides along in the data block.
          const n: any = payload.notification || {};
          const d: any = payload.data || {};
          this.showRaw(
            d.title || n.title || 'Glaron India',
            d.body || n.body || '',
            d.id || n.tag,
            d.url,
            // Hosted URL of the picture (see the Cloud Function) — never the
            // original data URL, which is far too big to travel over FCM.
            d.image || n.image
          );
        })
      );
    } catch (e) {
      console.warn('FCM registration notice:', (e as any)?.message || e);
    }
  }

  // Persist this device's token in the token collection of the role it is
  // signed in as, so the Cloud Function can fan out to it. Stored alongside the
  // signed-in mobile number so the tokens of an account the admin removes can
  // be pruned. Deduped by a `token ==` query rather than using the token as a
  // doc id (FCM tokens can contain characters that aren't valid in a doc id).
  private async saveToken(token: string) {
    if (!this.firestore) return;
    const key = this.MOBILE_KEYS[this.role];
    let mobile = '';
    try { mobile = localStorage.getItem(key) || sessionStorage.getItem(key) || ''; } catch (e) {}
    const colName = this.TOKENS_COLS[this.role];
    try {
      await runInInjectionContext(this.injector, async () => {
        const col = collection(this.firestore!, colName);
        const existing = await getDocs(query(col, where('token', '==', token)));
        if (existing.empty) {
          await addDoc(col, { token, mobile, updatedAt: Date.now() });
        } else {
          await setDoc(
            doc(this.firestore!, colName, existing.docs[0].id),
            { mobile, updatedAt: Date.now() },
            { merge: true }
          );
        }
      });
    } catch (e) {
      console.warn('FCM token save notice:', (e as any)?.message || e);
    }
  }

  // Move this device's token to the collection of the role it has just become,
  // dropping it from the other one. Without the removal an agent's phone would
  // keep receiving the dealer broadcasts it registered for while the shared
  // login screen was open.
  private async syncToken() {
    if (!this.firestore || !this.token) return;
    const other: ReceiverRole = this.role === 'agent' ? 'dealer' : 'agent';
    const token = this.token;
    try {
      await runInInjectionContext(this.injector, async () => {
        const col = collection(this.firestore!, this.TOKENS_COLS[other]);
        const stale = await getDocs(query(col, where('token', '==', token)));
        await Promise.all(stale.docs.map((d) => deleteDoc(d.ref).catch(() => {})));
      });
    } catch (e) {
      console.warn('FCM token move notice:', (e as any)?.message || e);
    }
    await this.saveToken(token);
  }

  // Raise a local OS notification on this device (no Firestore broadcast). Used
  // for device-specific events like this dealer's own approval. Safely no-ops
  // when notification permission hasn't been granted.
  async notifyLocal(title: string, body: string, id?: string): Promise<void> {
    await this.showRaw(title, body, id);
  }

  // ---- Firestore listener fallback (open/background only) ----

  private startFirestoreFallback() {
    const col = collection(this.firestore!, this.COL);
    runInInjectionContext(this.injector, () =>
      onSnapshot(
        query(col, orderBy('createdAt', 'desc'), limit(15)),
        (snap) => {
          const items: PushNotification[] = [];
          snap.forEach((d) => {
            const n = d.data() as PushNotification;
            // Both sides read the same collection, so drop whatever isn't
            // addressed to this device. Dropped here rather than downstream so
            // the "already seen" baseline only ever advances past this side's
            // messages — otherwise the other side's broadcast would mask the
            // next one meant for this device. Filtered client-side (not with a
            // `where`) because documents written before audiences existed carry
            // no field to match on.
            if (this.wantsBroadcast(n)) items.push(n);
          });
          this.processIncoming(items);
        },
        (err) => console.warn('Firestore notifications listen notice:', (err as any)?.message || err)
      )
    );
  }

  // Decide which of the received notifications are new and show them.
  private processIncoming(items: PushNotification[]) {
    const seenKey = this.SEEN_KEYS[this.role];
    let stored: string | null = null;
    try { stored = localStorage.getItem(seenKey); } catch (e) {}

    // First run on this device: establish a baseline so we don't blast the
    // dealer with the entire back-catalogue of past notifications.
    const firstEver = stored === null;
    const lastSeen = stored ? Number(stored) : 0;
    const maxTs = items.reduce((m, i) => Math.max(m, i.createdAt || 0), lastSeen);

    // Always advance the baseline. Only actually display when FCM isn't the
    // one delivering (otherwise the dealer would see each message twice).
    if (!firstEver && !this.fcmActive) {
      const toShow = items
        .filter((i) => (i.createdAt || 0) > lastSeen)
        .sort((a, b) => a.createdAt - b.createdAt);
      // This path has the whole document in hand, so the picture can be shown
      // straight from its data URL — no round trip, and it works offline.
      toShow.forEach((n) => this.showRaw(n.title, n.body, n.id, this.tapUrl(n), n.image));
    }

    if (maxTs > lastSeen) this.setLastSeen(seenKey, maxTs);
  }

  private setLastSeen(key: string, ts: number) {
    try { localStorage.setItem(key, String(ts)); } catch (e) {}
  }

  // Raise a real OS notification. Prefer the service-worker registration (works
  // when the tab isn't focused and lets a tap re-open the app); fall back to a
  // page-level Notification when no service worker is available.
  //
  // `url` is the dealer screen a tap should open. It lives purely in the
  // notification's data — never in the title or body — so the dealer sees only
  // the message the admin typed. `onActionClick` is how Angular's ngsw-worker
  // (which owns this registration) knows where to navigate on a tap.
  //
  // `image` is the optional picture shown inside the expanded notification.
  // Android/Chrome render it as the big picture; platforms that don't support
  // it simply ignore the option, leaving the title and message intact.
  private async showRaw(title: string, body: string, id?: string, url?: string, image?: string) {
    if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return;
    const heading = title || 'Glaron India';
    const target = url || notificationTargetUrl(undefined, this.role);
    const options: NotificationOptions = {
      body: body || '',
      icon: '/assets/icon/icon-192.png',
      badge: '/assets/icon/icon-192.png',
      tag: id,
      // Not in the TS DOM typings yet, hence the cast.
      ...(image ? ({ image } as any) : {}),
      data: {
        id,
        url: target,
        onActionClick: {
          default: { operation: 'navigateLastFocusedOrOpen', url: target }
        }
      },
      requireInteraction: true,
      // Not in the TS DOM typings but widely supported on Android.
      ...( { vibrate: [120, 60, 120] } as any )
    };
    try {
      if (navigator.serviceWorker) {
        const reg = await navigator.serviceWorker.ready;
        await reg.showNotification(heading, options);
        return;
      }
    } catch (e) {}
    try { new Notification(heading, options); } catch (e) {}
  }
}
