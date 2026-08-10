/* Firebase Cloud Messaging service worker — Glaron Admin console.
 *
 * This is what puts "a dealer placed an order" into the phone's notification
 * bar while the admin PWA is in the background or fully closed.
 *
 * It runs at its own scope (/firebase-cloud-messaging-push-scope), separate
 * from Angular's ngsw-worker.js which caches the app at scope '/'. Two workers,
 * two jobs, no collision.
 *
 * Served from the admin site root as /admin-messaging-sw.js (see the `assets`
 * entry for the `admin` project in angular.json).
 */
importScripts('https://www.gstatic.com/firebasejs/10.12.2/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.12.2/firebase-messaging-compat.js');

// Same public web config as admin-app/src/environments/environment.ts.
firebase.initializeApp({
  apiKey: 'AIzaSyDanbT4KRkBnfIud-IxBnXkC1WL9VBedu8',
  authDomain: 'glaron-ade19.firebaseapp.com',
  projectId: 'glaron-ade19',
  storageBucket: 'glaron-ade19.appspot.com',
  messagingSenderId: '125813476051',
  appId: '1:125813476051:web:582306ec207d535619e226'
});

// Tapping the notification opens the order it is about.
//
// IMPORTANT: registered BEFORE firebase.messaging() below. The FCM SDK installs
// its own notificationclick handler when that runs and listeners fire in
// registration order — going first lets stopImmediatePropagation() keep the
// SDK's handler out of it, so exactly one thing happens per tap instead of the
// SDK opening a second window alongside ours.
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.stopImmediatePropagation();

  // Notifications we drew ourselves keep the destination on data.url; ones the
  // FCM SDK auto-displayed wrap the original payload in data.FCM_MSG.
  const data = event.notification.data || {};
  const fcm = data.FCM_MSG || {};
  const target =
    data.url ||
    (fcm.data && fcm.data.url) ||
    (fcm.fcmOptions && fcm.fcmOptions.link) ||
    (fcm.notification && fcm.notification.click_action) ||
    '/admin/orders';

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
      for (const client of clients) {
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

// Data-only messages land here. The Cloud Function also sends a webpush
// notification block (which the browser auto-displays even with the app killed),
// so this mainly covers the data-only case.
messaging.onBackgroundMessage((payload) => {
  const data = payload.data || {};
  const n = payload.notification || {};
  const title = data.title || n.title || 'New order';
  self.registration.showNotification(title, {
    body: data.body || n.body || '',
    icon: '/assets/admin/icon-192.png',
    badge: '/assets/admin/icon-192.png',
    tag: data.id || undefined,
    data: { url: data.url || '/admin/orders', id: data.id || '' },
    requireInteraction: true,
    vibrate: [140, 70, 140]
  });
});
