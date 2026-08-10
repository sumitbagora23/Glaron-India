import { bootstrapApplication } from '@angular/platform-browser';
import { RouteReuseStrategy, provideRouter, withPreloading, PreloadAllModules } from '@angular/router';
import { IonicRouteStrategy, provideIonicAngular } from '@ionic/angular/standalone';

import { routes } from './app/app.routes';
import { AppComponent } from './app/app.component';
import { environment } from './environments/environment';

// Firebase imports
import { initializeApp, provideFirebaseApp, getApp } from '@angular/fire/app';
import { initializeFirestore, provideFirestore, persistentLocalCache, persistentMultipleTabManager } from '@angular/fire/firestore';
import { getAuth, provideAuth } from '@angular/fire/auth';
import { getStorage, provideStorage } from '@angular/fire/storage';
import { getMessaging, provideMessaging } from '@angular/fire/messaging';
import { provideServiceWorker } from '@angular/service-worker';

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
    provideFirestore(() => initializeFirestore(getApp(), {
      ignoreUndefinedProperties: true,
      localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }),
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
