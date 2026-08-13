/* Firebase Cloud Messaging service worker.
 *
 * Handles push messages when the dealer PWA is in the background or fully
 * closed. It runs at its own FCM scope, separate from Angular's ngsw-worker.js
 * (which caches the app), so the two service workers don't collide.
 *
 * Loaded from the site root as /firebase-messaging-sw.js (see angular.json
 * assets). The Cloud Function sends a notification payload (auto-displayed by
 * the browser, which is what reaches a fully-closed app) plus a data block
 * carrying the same text and the screen a tap should open.
 */
importScripts('https://www.gstatic.com/firebasejs/10.12.2/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.12.2/firebase-messaging-compat.js');

// Same public web config as src/environments/environment.ts.
firebase.initializeApp({
  apiKey: 'AIzaSyDanbT4KRkBnfIud-IxBnXkC1WL9VBedu8',
  authDomain: 'glaron-ade19.firebaseapp.com',
  projectId: 'glaron-ade19',
  storageBucket: 'glaron-ade19.appspot.com',
  messagingSenderId: '125813476051',
  appId: '1:125813476051:web:582306ec207d535619e226'
});

// Tapping the notification opens the screen the admin chose (the `url` stored
// on the notification, never shown in the message itself). An already-open
// dealer window is navigated there rather than merely focused, so the tap
// always lands on the right tab.
//
// IMPORTANT: this must be registered BEFORE firebase.messaging() below. The
// FCM SDK installs its own notificationclick handler when that runs, and
// listeners fire in registration order — registering ours second meant both
// handlers acted on every tap (the SDK opening a second window at
// fcmOptions.link while this one navigated the existing window). Going first
// lets stopImmediatePropagation() below keep the SDK's handler out of it, so
// exactly one thing happens per tap.
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.stopImmediatePropagation();

  // Notifications we rendered ourselves keep the destination on data.url. Ones
  // the FCM SDK auto-displayed wrap the original payload in data.FCM_MSG, so
  // read the destination back out of that.
  const data = event.notification.data || {};
  const fcm = data.FCM_MSG || {};
  const target =
    data.url ||
    (fcm.data && fcm.data.url) ||
    (fcm.fcmOptions && fcm.fcmOptions.link) ||
    (fcm.notification && fcm.notification.click_action) ||
    '/dealer/catalog';

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
      for (const client of clients) {
        // Dealers and agents share this one installed app, so an open window
        // can be sitting on either panel — both are ours to navigate.
        if (!client.url.includes('/dealer') && !client.url.includes('/agent')) continue;
        if ('navigate' in client) {
          return client.navigate(target).then((c) => (c || client).focus()).catch(() => client.focus());
        }
        if ('focus' in client) return client.focus();
      }
      if (self.clients.openWindow) return self.clients.openWindow(target);
    })
  );
});

const messaging = firebase.messaging();

// Background/closed-app messages land here when the payload is data-only. The
// text and the tap destination both ride in that data block.
messaging.onBackgroundMessage((payload) => {
  const data = payload.data || {};
  const n = payload.notification || {};
  const title = data.title || n.title || 'Glaron India';
  // The optional picture the admin attached. It travels as a short URL served
  // by the notificationImage function, never as the original data URL.
  const image = data.image || n.image || '';
  self.registration.showNotification(title, {
    body: data.body || n.body || '',
    // A thumbnail of the picture while the notification is still collapsed, so
    // it is obvious there is something to expand; the app logo when there is
    // no picture. The badge stays the logo — it is the status-bar glyph.
    icon: image || '/assets/icon/icon-192.png',
    badge: '/assets/icon/icon-192.png',
    ...(image ? { image: image } : {}),
    tag: data.id || undefined,
    data: { url: data.url || '/dealer/catalog', id: data.id || '' },
    requireInteraction: true,
    vibrate: [120, 60, 120]
  });
});
