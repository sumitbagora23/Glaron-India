import { bootstrapApplication } from '@angular/platform-browser';
import { RouteReuseStrategy, provideRouter, withPreloading, PreloadAllModules } from '@angular/router';
import { IonicRouteStrategy, provideIonicAngular } from '@ionic/angular/standalone';

import { routes } from './app/app.routes';
import { AppComponent } from './app/app.component';
import { environment } from './environments/environment';

// Firebase
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

    provideFirebaseApp(() => initializeApp(environment.firebase)),
    // ignoreUndefinedProperties lets documents omit optional fields without
    // Firestore throwing. The persistent IndexedDB cache keeps the catalogue —
    // including inline base64 images — on the device, so the console opens
    // instantly on later launches and keeps working offline.
    provideFirestore(() => initializeFirestore(getApp(), {
      ignoreUndefinedProperties: true,
      localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }),
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
