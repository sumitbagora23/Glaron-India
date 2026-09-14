import { bootstrapApplication } from '@angular/platform-browser';
import { RouteReuseStrategy, provideRouter, withPreloading, PreloadAllModules } from '@angular/router';
import { IonicRouteStrategy, provideIonicAngular } from '@ionic/angular/standalone';

import { routes } from './app/app.routes';
import { AppComponent } from './app/app.component';
import { environment } from './environments/environment';
import { applyDevSession } from './app/dev-session';

// Firebase imports
import { initializeApp, provideFirebaseApp, getApp } from '@angular/fire/app';
import { initializeFirestore, provideFirestore, persistentLocalCache } from '@angular/fire/firestore';
import { getAuth, provideAuth } from '@angular/fire/auth';
import { getStorage, provideStorage } from '@angular/fire/storage';
import { getMessaging, provideMessaging } from '@angular/fire/messaging';
import { provideServiceWorker } from '@angular/service-worker';

// Older builds ran Firestore's multi-tab cache, which broadcast every pending
// write — each carrying a product's inline base64 image — into localStorage
// under `firestore_*` keys. That overran the ~5 MB quota and then made every
// new write crash (QuotaExceededError / INTERNAL ASSERTION FAILED, id b815).
// The multi-tab manager is gone below (single-tab persistence keeps its data in
// IndexedDB instead); clear the stranded keys once here to reclaim the space.
try {
  const stale: string[] = [];
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (k && k.startsWith('firestore_')) stale.push(k);
  }
  stale.forEach(k => localStorage.removeItem(k));
} catch { /* private mode / no storage — nothing to reclaim */ }

// Localhost-only `?as=…` test sessions (see app/dev-session.ts). Must run
// before the router reads the session keys.
applyDevSession();

bootstrapApplication(AppComponent, {
  providers: [
    { provide: RouteReuseStrategy, useClass: IonicRouteStrategy },
    provideIonicAngular(),
    provideRouter(routes, withPreloading(PreloadAllModules)),
    
    // Firebase providers
    provideFirebaseApp(() => initializeApp(environment.firebase)),
    // ignoreUndefinedProperties lets us save documents that omit optional fields
    // (e.g. a product with no image) without Firestore throwing on `undefined`.
    // Persistent (IndexedDB) offline cache: after the first sync, all documents —
    // including the inline base64 product/category/banner images — are served
    // instantly from the device on every later open (and while offline), instead
    // of being re-downloaded from the network each launch. This is what makes the
    // images appear immediately rather than after a load delay.
    // Single-tab persistence: the catalogue (inline images included) still lives
    // in IndexedDB for instant, offline loads — but Firestore no longer mirrors
    // its pending writes into localStorage, so a large save can never exhaust
    // the localStorage quota again. A second tab just falls back to memory.
    provideFirestore(() => initializeFirestore(getApp(), {
      ignoreUndefinedProperties: true,
      localCache: persistentLocalCache(),
      // Some networks, proxies and mobile carriers silently block or buffer
      // Firestore's streaming WebChannel connection. When that happens reads
      // still come from the cache, but a write (setDoc) never gets its server
      // ack and the promise hangs forever — which is what left "Sending your
      // list…" spinning and made quotation requests impossible to submit.
      //
      // Auto-detect (rather than *forcing* long-polling on every device) probes
      // the connection once at start-up: on a normal network it keeps the fast
      // streaming WebChannel, so reads, live feeds and writes are near-instant;
      // only on a network that actually blocks the stream does it fall back to
      // ordinary HTTPS long-polling. Blocked networks stay covered — the very
      // reason forced long-polling was added — without taxing every good one.
      // (Dealer writes already go over plain REST via firestore-rest.ts, so the
      // hanging-setDoc case has a second safety net regardless.)
      experimentalAutoDetectLongPolling: true,
    })),
    provideAuth(() => getAuth()),
    provideStorage(() => getStorage()),
    // Firebase Cloud Messaging — powers push notifications that reach dealer
    // devices even when the PWA is fully closed.
    provideMessaging(() => getMessaging()),

    // PWA service worker — always enabled so installed home-screen apps can
    // detect and pull new versions automatically. (Enabled even in the dev
    // build config, which is what we deploy.)
    provideServiceWorker('ngsw-worker.js', {
      enabled: true,
      registrationStrategy: 'registerWhenStable:30000',
    }),
  ],
})
  .then(() => {
    // App is up — fade out and remove the branded splash overlay. On the dealer
    // app, keep the splash visible for at least 2.5s so it reads as a proper
    // branded loading screen every open; the admin side removes it immediately.
    const splash = document.getElementById('app-splash');
    if (!splash) return;
    const isDealer = window.location.hostname.includes('dealer');
    const minMs = isDealer ? 2500 : 0;
    const wait = Math.max(0, minMs - performance.now());
    setTimeout(() => {
      // Hand the page background back to the light theme (see index.html).
      document.documentElement.classList.add('booted');
      splash.classList.add('hide');
      setTimeout(() => splash.remove(), 450);
    }, wait);
  })
  .catch((err) => console.error(err));
