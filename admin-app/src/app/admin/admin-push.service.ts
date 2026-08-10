import { Injectable, signal, inject, Injector, runInInjectionContext } from '@angular/core';
import {
  Firestore, collection, doc, setDoc, deleteDoc, onSnapshot, query, where, getDocs, addDoc
} from '@angular/fire/firestore';
import { Messaging, getToken, onMessage } from '@angular/fire/messaging';
import { environment } from '../../environments/environment';

const ADMIN_EMAIL_KEY = 'glaron_admin_logged_in';

/**
 * "A dealer just placed an order" alerts for the admin console.
 *
 * Two delivery paths, exactly like the dealer app's broadcast receiver but with
 * nothing shared between them — this app has its own token collection, its own
 * service worker and its own Cloud Function trigger:
 *
 * 1. **FCM (primary)** — every admin device registers a push token in
 *    `admin_tokens`. The `notifyAdminOnNewOrder` Cloud Function fires on each
 *    new `orders/{id}` document and pushes to those tokens, so the alert lands
 *    in the phone's notification bar even when the admin PWA is fully closed.
 *    Needs the Blaze plan (Cloud Functions) + the VAPID key in environment.ts.
 *
 * 2. **Firestore listener (fallback)** — while the console is open it also
 *    watches the `orders` collection directly and raises the notification
 *    itself. This covers the window before FCM is configured, and browsers
 *    where push isn't available. It suppresses itself once FCM is live so an
 *    order is never announced twice.
 */
@Injectable({ providedIn: 'root' })
export class AdminPushService {
  private firestore = inject(Firestore, { optional: true });
  private messaging = inject(Messaging, { optional: true });
  private injector = inject(Injector);

  private readonly TOKENS_COL = 'admin_tokens';
  private readonly ORDERS_COL = 'orders';
  // Newest order timestamp this device has already announced. Keeps a reopen
  // from re-firing yesterday's orders, while orders missed while offline still
  // surface on the next launch.
  private readonly SEEN_KEY = 'glaron_admin_last_seen_order_ts';
  // The token this device last registered, so a re-register can replace it.
  private readonly TOKEN_KEY = 'glaron_admin_fcm_token';

  // Notification permission as the UI needs to see it: 'unsupported' when the
  // browser has no Notification API at all (older iOS, or an iOS Safari tab
  // that hasn't been added to the home screen).
  readonly permission = signal<'unsupported' | 'default' | 'granted' | 'denied'>('unsupported');
  // True once a push token exists on this device — the console shows a green
  // "alerts on" state, and the Firestore fallback stands down.
  readonly pushActive = signal(false);
  // Last error surfaced while enabling, shown verbatim in Settings so a failing
  // device can be diagnosed without a debugger attached.
  readonly lastError = signal('');

  private started = false;
  private fallbackRunning = false;

  constructor() {
    this.permission.set(this.readPermission());
  }

  private readPermission(): 'unsupported' | 'default' | 'granted' | 'denied' {
    if (typeof Notification === 'undefined') return 'unsupported';
    return Notification.permission as 'default' | 'granted' | 'denied';
  }

  /**
   * Begin receiving order alerts on this device. Idempotent.
   *
   * Registration only happens on its own if permission was already granted on a
   * previous visit — browsers (and iOS especially) require a user gesture to
   * raise the permission prompt, which is what `enable()` below is for.
   */
  start() {
    if (this.started) return;
    this.started = true;

    this.permission.set(this.readPermission());
    if (this.permission() === 'granted') this.registerFcm();

    this.startFirestoreFallback();
  }

  /**
   * Ask for notification permission and register for push. MUST be called from
   * a real user gesture (a button tap) — that is a hard requirement on iOS and
   * the reason the console shows an explicit "Turn on order alerts" button
   * rather than prompting on load.
   */
  async enable(): Promise<boolean> {
    this.lastError.set('');
    if (typeof Notification === 'undefined') {
      this.permission.set('unsupported');
      this.lastError.set(
        'This browser cannot show notifications. On iPhone/iPad, add the app to your Home Screen first, then open it from there.'
      );
      return false;
    }

    try {
      const perm = await Notification.requestPermission();
      this.permission.set(perm as 'default' | 'granted' | 'denied');
      if (perm !== 'granted') {
        this.lastError.set(
          perm === 'denied'
            ? 'Notifications are blocked for this app. Allow them in your browser/site settings, then try again.'
            : 'Notification permission was dismissed.'
        );
        return false;
      }
    } catch (e) {
      this.lastError.set((e as any)?.message || String(e));
      return false;
    }

    await this.registerFcm();
    // Even without FCM the console can alert while it is open, so treat a
    // granted permission as success.
    return true;
  }

  /**
   * Draw a sample alert on this device so the admin can confirm notifications
   * actually appear (and see what a real order alert will look like). Local
   * only — nothing is sent through FCM.
   */
  async sendTest(): Promise<boolean> {
    if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return false;
    await this.showRaw(
      'New order received',
      'Sample alert — this is how a dealer order will appear.',
      'admin-test-alert',
      '/admin/orders'
    );
    return true;
  }

  /** Stop this device receiving pushes (used when the admin signs out). */
  async disable(): Promise<void> {
    let token = '';
    try { token = localStorage.getItem(this.TOKEN_KEY) || ''; } catch (e) {}
    if (!token || !this.firestore) return;
    try {
      await runInInjectionContext(this.injector, async () => {
        const col = collection(this.firestore!, this.TOKENS_COL);
        const existing = await getDocs(query(col, where('token', '==', token)));
        await Promise.all(existing.docs.map((d) => deleteDoc(d.ref).catch(() => {})));
      });
    } catch (e) {}
    try { localStorage.removeItem(this.TOKEN_KEY); } catch (e) {}
    this.pushActive.set(false);
  }

  // ---- FCM: the path that reaches a closed app ----

  private async registerFcm() {
    if (!this.messaging || this.pushActive()) return;
    const vapidKey = (environment as any).fcmVapidKey as string;
    if (!vapidKey) {
      this.lastError.set('Push is not configured yet (missing VAPID key).');
      return;
    }

    try {
      // The FCM worker is registered at its own scope so it never fights with
      // Angular's ngsw-worker.js, which owns scope '/'. Sharing a scope stops
      // getToken() issuing a token at all.
      let swReg: ServiceWorkerRegistration | undefined;
      if (navigator.serviceWorker) {
        swReg = (await navigator.serviceWorker
          .register('/admin-messaging-sw.js', { scope: '/firebase-cloud-messaging-push-scope' })
          .catch(() => undefined)) || undefined;
      }

      const token = await runInInjectionContext(this.injector, () =>
        getToken(this.messaging!, swReg ? { vapidKey, serviceWorkerRegistration: swReg } : { vapidKey })
      );
      if (!token) {
        this.lastError.set('Could not get a push token from Firebase.');
        return;
      }

      this.pushActive.set(true);
      try { localStorage.setItem(this.TOKEN_KEY, token); } catch (e) {}
      await this.saveToken(token);

      // FCM never auto-displays while the app is focused, so draw it ourselves.
      runInInjectionContext(this.injector, () =>
        onMessage(this.messaging!, (payload) => {
          const n: any = payload.notification || {};
          const d: any = payload.data || {};
          this.showRaw(
            d.title || n.title || 'New order',
            d.body || n.body || '',
            d.id || n.tag,
            d.url || '/admin/orders'
          );
        })
      );
    } catch (e) {
      this.lastError.set((e as any)?.message || String(e));
      console.warn('Admin FCM registration notice:', (e as any)?.message || e);
    }
  }

  /**
   * Store this device's token so the Cloud Function can reach it.
   *
   * Deduped with a `token ==` query rather than using the token as a document
   * id — FCM tokens contain characters Firestore ids don't allow.
   */
  private async saveToken(token: string) {
    if (!this.firestore) return;
    let email = '';
    try { email = localStorage.getItem(ADMIN_EMAIL_KEY) || ''; } catch (e) {}
    try {
      await runInInjectionContext(this.injector, async () => {
        const col = collection(this.firestore!, this.TOKENS_COL);
        const existing = await getDocs(query(col, where('token', '==', token)));
        const record = { email, platform: navigator.userAgent || '', updatedAt: Date.now() };
        if (existing.empty) {
          await addDoc(col, { token, ...record });
        } else {
          await setDoc(doc(this.firestore!, this.TOKENS_COL, existing.docs[0].id), record, { merge: true });
        }
      });
    } catch (e) {
      this.lastError.set((e as any)?.message || String(e));
      console.warn('Admin token save notice:', (e as any)?.message || e);
    }
  }

  // ---- Firestore fallback: works while the console is open ----

  private startFirestoreFallback() {
    if (this.fallbackRunning || !this.firestore) return;
    this.fallbackRunning = true;

    // Only dealer-placed orders are worth alerting on — an order the admin
    // just typed in doesn't need announcing back to them.
    const col = collection(this.firestore, this.ORDERS_COL);
    runInInjectionContext(this.injector, () =>
      onSnapshot(
        col,
        (snap) => {
          const fresh: { id: string; dealer: string; value: number; ts: number }[] = [];
          snap.docChanges().forEach((change) => {
            if (change.type !== 'added') return;
            const o: any = change.doc.data() || {};
            if (o.source === 'admin') return;
            fresh.push({
              id: String(o.id || change.doc.id),
              dealer: String(o.dealer || 'A dealer'),
              value: Number(o.value || 0),
              ts: Date.parse(String(o.date || '')) || 0,
            });
          });
          if (fresh.length) this.announce(fresh);
        },
        (err) => console.warn('Admin order watch notice:', (err as any)?.message || err)
      )
    );
  }

  private announce(orders: { id: string; dealer: string; value: number; ts: number }[]) {
    let stored: string | null = null;
    try { stored = localStorage.getItem(this.SEEN_KEY); } catch (e) {}

    // First run on this device just sets the baseline, so installing the app
    // doesn't replay every historical order at once.
    const firstEver = stored === null;
    const lastSeen = stored ? Number(stored) : 0;
    const maxTs = orders.reduce((m, o) => Math.max(m, o.ts), lastSeen);

    if (!firstEver && !this.pushActive()) {
      orders
        .filter((o) => o.ts > lastSeen)
        .sort((a, b) => a.ts - b.ts)
        .forEach((o) =>
          this.showRaw(
            'New order received',
            `${o.dealer} placed order ${o.id}${o.value ? ' — ₹' + o.value.toLocaleString('en-IN') : ''}`,
            o.id,
            '/admin/orders'
          )
        );
    }

    if (maxTs > lastSeen) {
      try { localStorage.setItem(this.SEEN_KEY, String(maxTs)); } catch (e) {}
    }
  }

  /**
   * Raise a real OS notification. Goes through the service-worker registration
   * whenever one exists so the notification survives the tab losing focus and a
   * tap can bring the console back to the orders screen.
   */
  private async showRaw(title: string, body: string, id?: string, url = '/admin/orders') {
    if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return;
    const options: NotificationOptions = {
      body: body || '',
      icon: '/assets/admin/icon-192.png',
      badge: '/assets/admin/icon-192.png',
      tag: id,
      data: {
        id,
        url,
        // How Angular's ngsw-worker (owner of this registration) routes a tap.
        onActionClick: { default: { operation: 'navigateLastFocusedOrOpen', url } }
      },
      requireInteraction: true,
      // Not in the TS DOM typings but widely supported on Android.
      ...({ vibrate: [140, 70, 140] } as any)
    };
    try {
      if (navigator.serviceWorker) {
        const reg = await navigator.serviceWorker.ready;
        await reg.showNotification(title, options);
        return;
      }
    } catch (e) {}
    try { new Notification(title, options); } catch (e) {}
  }
}
