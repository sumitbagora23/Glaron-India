import { Component, inject, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { IonApp, IonRouterOutlet } from '@ionic/angular/standalone';
import { SwUpdate, UnrecoverableStateEvent, VersionReadyEvent } from '@angular/service-worker';
import { filter } from 'rxjs/operators';
import { APP_VERSION } from './version';
import { isAdminLoggedIn } from './app.routes';
import { isInstalledApp } from './installed-app';
import { AdminPushService } from './admin/admin-push.service';

// Guards against a reload loop: if activating an update somehow lands us on the
// same version again, we must not reload forever. Stored per browsing session.
const LAST_RELOAD_KEY = 'glaron_admin_update_reload_at';
const RELOAD_COOLDOWN_MS = 60_000;

// How long after launch an installed console will still restart itself into a
// newly downloaded build. Long enough for the download to finish on a slow
// connection, short enough that nobody is part-way through a form yet.
const LAUNCH_WINDOW_MS = 45_000;

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

    // Crash recovery, in both modes: a service worker in an unrecoverable state
    // cannot run the app at all, so heal it with one clean reload. This is not
    // an update.
    this.swUpdate.unrecoverable
      .subscribe((_e: UnrecoverableStateEvent) => document.location.reload());

    // Installed on a home screen: updates only in the first seconds after
    // launch. Still no foreground check and no timer — reloading out from under
    // someone who is part-way through a form is worse than running a build that
    // is an hour old. But a version the service worker has already downloaded
    // must not be left pending: an installed app that never activates what it
    // fetched is what makes the browser raise its own "update available" strip
    // on every launch, and tapping it changes nothing because the app comes
    // back on the same version. So take it once, at launch, before any form has
    // been opened. Settings → "Check for update" still works as before.
    if (isInstalledApp()) {
      this.swUpdate.versionUpdates
        .pipe(filter((e): e is VersionReadyEvent => e.type === 'VERSION_READY'))
        .subscribe(() => {
          if (performance.now() > LAUNCH_WINDOW_MS) return;
          this.applyUpdate();
        });
      this.checkForUpdate();
      return;
    }

    // Opened from a link in a browser: always the newest build. Nobody chose to
    // install this, so there is no cached copy worth preserving, and handing
    // out a stale page from a URL is the one thing a link must not do.
    this.swUpdate.versionUpdates
      .pipe(filter((e): e is VersionReadyEvent => e.type === 'VERSION_READY'))
      .subscribe(() => this.applyUpdate());

    // Ask on launch, and again whenever the tab comes back to the foreground —
    // a tab is often left open for days.
    this.checkForUpdate();
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) this.checkForUpdate();
    });
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
