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
import { provideServiceWorker } from '@angular/service-worker';

bootstrapApplication(AppComponent, {
  providers: [
    { provide: RouteReuseStrategy, useClass: IonicRouteStrategy },
    provideIonicAngular(),
    provideRouter(routes, withPreloading(PreloadAllModules)),

    provideFirebaseApp(() => initializeApp(environment.firebase)),
    // ignoreUndefinedProperties lets documents omit optional fields without
    // Firestore throwing. The persistent IndexedDB cache keeps the catalogue —
    // including the inline base64 product images — on the device, so the app
    // opens instantly on later launches and an agent standing in a basement
    // showroom can still show the range.
    provideFirestore(() => initializeFirestore(getApp(), {
      ignoreUndefinedProperties: true,
      localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }),
    })),
    provideAuth(() => getAuth()),

    // PWA service worker — always enabled so an installed home-screen app can
    // detect and pull new versions on demand.
    provideServiceWorker('ngsw-worker.js', {
      enabled: true,
      registrationStrategy: 'registerWhenStable:30000',
    }),
  ],
})
  .then(() => {
    // Keep the branded splash up for a beat so it reads as a loading screen
    // rather than a flash, exactly like the dealer app.
    const splash = document.getElementById('app-splash');
    if (!splash) return;
    const wait = Math.max(0, 1800 - performance.now());
    setTimeout(() => {
      // Hand the page background back to the light theme (see index.html).
      document.documentElement.classList.add('booted');
      splash.classList.add('hide');
      setTimeout(() => splash.remove(), 450);
    }, wait);
  })
  .catch((err) => console.error(err));
