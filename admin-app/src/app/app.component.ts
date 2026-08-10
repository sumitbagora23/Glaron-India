import { Component, inject, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { IonApp, IonRouterOutlet } from '@ionic/angular/standalone';
import { SwUpdate, UnrecoverableStateEvent, VersionReadyEvent } from '@angular/service-worker';
import { filter } from 'rxjs/operators';
import { APP_VERSION } from './version';
import { isAdminLoggedIn } from './app.routes';
import { AdminPushService } from './admin/admin-push.service';

// Guards against a reload loop: if activating an update somehow lands us on the
// same version again, we must not reload forever. Stored per browsing session.
const LAST_RELOAD_KEY = 'glaron_admin_update_reload_at';
const RELOAD_COOLDOWN_MS = 60_000;

@Component({
  selector: 'app-root',
  templateUrl: 'app.component.html',
  styleUrls: ['app.component.scss'],
  imports: [CommonModule, IonApp, IonRouterOutlet],
})
export class AppComponent implements OnInit {
  private swUpdate = inject(SwUpdate);
  private push = inject(AdminPushService);

  readonly currentVersion = APP_VERSION;

  ngOnInit() {
    // Start listening for new-order pushes as soon as an admin is signed in.
    // Safe to call repeatedly; it only registers once per device.
    if (isAdminLoggedIn()) {
      this.push.start();
    }

    if (!this.swUpdate.isEnabled) return;

    // The console updates itself, unlike the dealer PWA.
    //
    // The dealer app deliberately pins its version and only updates when the
    // dealer taps "Check for update" in their profile — that keeps a shop from
    // having the catalogue change under them mid-order. The console has no
    // equivalent screen, so inheriting that policy left an installed admin app
    // permanently stuck on whatever build it first cached, with no way out
    // short of reinstalling. For an internal tool that is all cost and no
    // benefit: a stale console silently misses new features and fixes.
    this.swUpdate.versionUpdates
      .pipe(filter((e): e is VersionReadyEvent => e.type === 'VERSION_READY'))
      .subscribe(() => this.applyUpdate());

    // Ask on launch, and again whenever the app comes back to the foreground —
    // an installed PWA is often resumed for weeks without a cold start.
    this.checkForUpdate();
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) this.checkForUpdate();
    });

    // Crash recovery: a service worker in an unrecoverable state can't run the
    // app at all, so heal it with one clean reload.
    this.swUpdate.unrecoverable
      .subscribe((_e: UnrecoverableStateEvent) => document.location.reload());
  }

  /** Ask the service worker whether a newer build is on the server. */
  private async checkForUpdate(): Promise<void> {
    try {
      await this.swUpdate.checkForUpdate();
    } catch (e) {
      // Offline, or the check raced a reload — nothing to do but try later.
      console.warn('Update check notice:', (e as any)?.message || e);
    }
  }

  /** Swap in the downloaded version and restart into it. */
  private async applyUpdate(): Promise<void> {
    let last = 0;
    try { last = Number(sessionStorage.getItem(LAST_RELOAD_KEY) || 0); } catch (e) {}
    if (last && Date.now() - last < RELOAD_COOLDOWN_MS) return;

    try {
      await this.swUpdate.activateUpdate();
      try { sessionStorage.setItem(LAST_RELOAD_KEY, String(Date.now())); } catch (e) {}
      document.location.reload();
    } catch (e) {
      console.warn('Update activation notice:', (e as any)?.message || e);
    }
  }
}
