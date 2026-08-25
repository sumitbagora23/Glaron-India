import { bootstrapApplication } from '@angular/platform-browser';
import { RouteReuseStrategy, provideRouter, withPreloading, PreloadAllModules } from '@angular/router';
import { IonicRouteStrategy, provideIonicAngular } from '@ionic/angular/standalone';

import { routes } from './app/app.routes';
import { AppComponent } from './app/app.component';
import { environment } from './environments/environment';

// Firebase
import { initializeApp, provideFirebaseApp, getApp } from '@angular/fire/app';
import { initializeFirestore, provideFirestore, persistentLocalCache } from '@angular/fire/firestore';
import { getAuth, provideAuth } from '@angular/fire/auth';
import { getStorage, provideStorage } from '@angular/fire/storage';
import { getMessaging, provideMessaging } from '@angular/fire/messaging';
import { provideServiceWorker } from '@angular/service-worker';

// Older builds ran Firestore's multi-tab cache, which broadcast every pending
// write — each carrying a product's inline base64 image — into localStorage
// under `firestore_*` keys. That overran the ~5 MB quota and then made every
// new write crash (QuotaExceededError / INTERNAL ASSERTION FAILED, id b815),
// so add / edit / delete all failed with a "connection" error. The multi-tab
// manager is gone below (single-tab persistence keeps its data in IndexedDB
// instead); clear the stranded keys once here to reclaim the jammed space.
try {
  const stale: string[] = [];
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (k && k.startsWith('firestore_')) stale.push(k);
  }
  stale.forEach(k => localStorage.removeItem(k));
} catch { /* private mode / no storage — nothing to reclaim */ }

bootstrapApplication(AppComponent, {
  providers: [
    { provide: RouteReuseStrategy, useClass: IonicRouteStrategy },
    provideIonicAngular(),
    provideRouter(routes, withPreloading(PreloadAllModules)),

    provideFirebaseApp(() => initializeApp(environment.firebase)),
    // ignoreUndefinedProperties lets documents omit optional fields without
    // Firestore throwing. The persistent IndexedDB cache keeps the catalogue —
    // including inline base64 images — on the device, so the console opens
    // instantly on later launches and keeps working offline.
    // Single-tab persistence: the catalogue (inline images included) still lives
    // in IndexedDB for instant, offline loads — but Firestore no longer mirrors
    // its pending writes into localStorage, so a large save can never exhaust
    // the localStorage quota again. A second tab just falls back to memory.
    provideFirestore(() => initializeFirestore(getApp(), {
      ignoreUndefinedProperties: true,
      localCache: persistentLocalCache(),
      // Auto-detect long-polling: keep the fast streaming WebChannel on normal
      // networks (so the console, orders and the live quotations feed are
      // near-instant) and fall back to HTTPS long-polling only on a network or
      // proxy that actually blocks the stream. Blocked networks stay covered
      // without slowing every good one. See the matching note in the customer
      // app's main.ts.
      experimentalAutoDetectLongPolling: true,
    })),
    provideAuth(() => getAuth()),
    provideStorage(() => getStorage()),
    // Cloud Messaging — new-order alerts that reach the admin's phone even when
    // this app is fully closed. getMessaging() throws on browsers without push
    // support (older iOS), so it is guarded rather than left to break bootstrap.
    provideMessaging(() => {
      try {
        return getMessaging();
      } catch (e) {
        console.warn('Messaging unavailable on this browser:', (e as any)?.message || e);
        return null as any;
      }
    }),

    // PWA service worker — always enabled so an installed home-screen app can
    // detect and pull new versions on demand.
    provideServiceWorker('ngsw-worker.js', {
      enabled: true,
      registrationStrategy: 'registerWhenStable:30000',
    }),
  ],
})
  .then(() => {
    // App is up — drop the branded splash immediately (the console is a work
    // tool; no minimum splash time like the dealer app).
    // Hand the page background back to the light theme (see index.html).
    document.documentElement.classList.add('booted');

    const splash = document.getElementById('app-splash');
    if (!splash) return;
    splash.classList.add('hide');
    setTimeout(() => splash.remove(), 450);
  })
  .catch((err) => console.error(err));
