import { Injectable, signal, inject, Injector, runInInjectionContext } from '@angular/core';
import {
  Firestore, collection, doc, setDoc, deleteDoc, onSnapshot, query, orderBy, limit
} from '@angular/fire/firestore';

// A single push notification the admin broadcasts to dealer and/or agent
// devices.
export interface PushNotification {
  id: string;
  title: string;
  body: string;
  // Epoch millis — used for ordering here, and on the receiving side for the
  // "have I already shown this one?" check.
  createdAt: number;
  // Optional picture shown inside the notification, stored as a compact JPEG
  // data URL (same approach as banners/product images — no Firebase Storage).
  // It is far too large for an FCM payload, so the Cloud Function republishes
  // it at /notification-image/<id> and sends devices that short URL instead.
  image?: string;
  // Who receives it: dealers only, agents only, or both. Missing on documents
  // written before this field existed — those are dealer broadcasts.
  audience?: NotificationAudience;
  // Named recipients, by the mobile number they sign in with — which is also
  // what their device's push token is stored against, so it is the one key that
  // joins a dealer or agent record to a device.
  //
  // Absent or empty means EVERYONE on that side of the audience, which is what
  // every broadcast sent before targeting existed meant. Only the side(s) the
  // audience covers are written: a dealers-only broadcast carries no
  // agentPhones. A "both" broadcast can name dealers, agents, or each
  // independently — leaving one list empty sends to all of that side.
  dealerPhones?: string[];
  agentPhones?: string[];
  // Which screen a tap opens (a target key) and the path it resolves to in each
  // app. All three are plumbing only — none is ever rendered inside the
  // notification the dealer or agent sees. `url` is the dealer path (present
  // when dealers are in the audience), `agentUrl` the agent one.
  target?: string;
  url?: string;
  agentUrl?: string;
}

// ---------------- Recipients ----------------

// The specific people a broadcast is aimed at, by mobile number. An empty or
// omitted list means everyone on that side.
export interface NotificationRecipients {
  dealerPhones?: string[];
  agentPhones?: string[];
}

/**
 * Reduce a mobile number to the ten digits it is matched on.
 *
 * The same number reaches us from three places that format it differently — the
 * dealer/agent record the admin picked, the token document written by the
 * device, and the value the device kept in localStorage at sign-in — and any of
 * them may carry spaces, dashes or a +91 country code. They are only comparable
 * once flattened, so every side normalises before comparing.
 */
export function normalisePhone(input?: string | null): string {
  const digits = String(input || '').replace(/\D/g, '');
  return digits.length > 10 ? digits.slice(-10) : digits;
}

// Normalise a list of numbers, dropping blanks and duplicates.
export function normalisePhones(list?: (string | null | undefined)[]): string[] {
  const out = new Set<string>();
  (list || []).forEach((p) => {
    const n = normalisePhone(p);
    if (n) out.add(n);
  });
  return Array.from(out);
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

// Friendly name for a target. A hand-typed path is shown back as typed.
export function notificationTargetLabel(key?: string, audience?: string): string {
  const list = notificationTargets(audience);
  return (resolveNotificationTarget(key, audience) || list[0]).label;
}

/**
 * Broadcasting notifications FROM the admin console TO the dealer and agent
 * PWAs.
 *
 * The console's only job is to write a document to the Firestore
 * `notifications` collection, stamped with the audience the admin chose.
 * Delivery is the receiving apps' business: a Cloud Function pushes each new
 * document to the token collection(s) that audience covers (`dealer_tokens`,
 * `agent_tokens`, or both), and each PWA also runs a Firestore fallback
 * listener that ignores broadcasts not addressed to it. None of that receiving
 * machinery lives here — this app never renders a broadcast.
 *
 * Alerts coming the other way (a dealer placed an order → tell the admin) are
 * AdminPushService's job, not this one.
 */
@Injectable({
  providedIn: 'root'
})
export class NotificationService {
  private firestore = inject(Firestore, { optional: true });
  private injector = inject(Injector);

  private readonly COL = 'notifications';

  // "Recently sent" feed shown on the Settings page.
  private recentSignal = signal<PushNotification[]>([]);
  private adminListening = false;

  // Subscribe the settings page to the recent-notifications feed.
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
  //
  // `recipients` narrows the broadcast to named people by mobile number. Leave
  // a side out (or pass an empty list) to reach everyone on it, which is the
  // default and what every earlier broadcast did.
  async send(
    title: string,
    body: string,
    target: string = DEFAULT_NOTIFICATION_TARGET,
    image?: string | null,
    audience: NotificationAudience = DEFAULT_NOTIFICATION_AUDIENCE,
    recipients?: NotificationRecipients
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
    // Only keep a recipient list for a side the audience actually covers, so a
    // dealers-only broadcast can never carry a stale agent selection left
    // behind by switching the audience chips around in the form.
    const dealerPhones = dealerTarget ? normalisePhones(recipients?.dealerPhones) : [];
    const agentPhones = agentTarget ? normalisePhones(recipients?.agentPhones) : [];
    const createdAt = Date.now();
    const id = 'n-' + createdAt;
    const payload: PushNotification = {
      id, title: t, body: b, createdAt,
      audience: aud,
      target: (dealerTarget || agentTarget)!.key,
      ...(dealerTarget ? { url: dealerTarget.url } : {}),
      ...(agentTarget ? { agentUrl: agentTarget.url } : {}),
      ...(image ? { image } : {}),
      // Omitted entirely when empty — an absent list is what both the Cloud
      // Function and the receiving apps read as "everyone".
      ...(dealerPhones.length ? { dealerPhones } : {}),
      ...(agentPhones.length ? { agentPhones } : {})
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
}
