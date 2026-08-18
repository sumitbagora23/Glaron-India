import { Component, inject, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { IonApp, IonRouterOutlet } from '@ionic/angular/standalone';
import { SwUpdate, UnrecoverableStateEvent, VersionReadyEvent } from '@angular/service-worker';
import { filter } from 'rxjs/operators';
import { APP_VERSION } from './version';
import { isDealerLoggedIn, isAgentLoggedIn } from './app.routes';
import { NotificationService } from './admin/notification.service';
import { DealerApprovalService } from './dealer-approval.service';
import { isInstalledApp } from './installed-app';

// Guards against a reload loop when an activated update reports the same
// version again. Stored per browsing session.
const LAST_RELOAD_KEY = 'glaron_update_reload_at';
const RELOAD_COOLDOWN_MS = 60_000;

// How long after launch an installed app will still restart itself into a newly
// downloaded build. Long enough for the download to finish on a slow phone,
// short enough that nobody is mid-order yet.
const LAUNCH_WINDOW_MS = 45_000;

@Component({
  selector: 'app-root',
  templateUrl: 'app.component.html',
  styleUrls: ['app.component.scss'],
  imports: [CommonModule, IonApp, IonRouterOutlet],
})
export class AppComponent implements OnInit {
  private swUpdate = inject(SwUpdate);
  private notificationService = inject(NotificationService);
  // Injected so its live approval watcher starts running from app launch.
  private approvalService = inject(DealerApprovalService);

  // Current running version (shown in the app UI).
  readonly currentVersion = APP_VERSION;

  ngOnInit() {
    // Listen for admin broadcasts and raise OS notifications, on whichever side
    // this device is signed in as — the two see different broadcasts. Same
    // precedence as the root redirect: the session that exists picks the panel,
    // dealer first. Idempotent, so the panels starting it too is fine.
    if (isDealerLoggedIn()) {
      this.notificationService.startDealerListener();
    } else if (isAgentLoggedIn()) {
      this.notificationService.startAgentListener();
    }

    if (!this.swUpdate.isEnabled) return;

    // Safety net, in both modes: if the cached app reaches a broken/unrecoverable
    // service-worker state it cannot run at all, so force one clean reload to
    // heal it. This is crash recovery, not an update.
    this.swUpdate.unrecoverable
      .subscribe((_e: UnrecoverableStateEvent) => document.location.reload());

    // ---- Installed PWA: updates only in the first seconds after launch ----
    // Still no foreground checks and no timers — a shop must not have the
    // catalogue change under them mid-order. But a build the service worker has
    // already fetched must not be left sitting unapplied either: an installed
    // app carrying a version it never activates is what makes the browser put
    // its own "update available" strip up on every single launch, and taking it
    // there does not clear it because the app goes straight back to the version
    // it was on. So take a ready version once, during the launch window, before
    // anyone has touched anything — a reload costs nothing at that moment (the
    // cart comes back from storage) and it leaves nothing pending afterwards.
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

    // ---- Opened from a link, in a browser: always the newest build ----
    // Nothing was installed here, so there is no cached copy worth protecting
    // and no order to interrupt that a reload would not also restore from the
    // session cart. A shared catalogue link that serves last week's prices is
    // the failure this avoids.
    this.swUpdate.versionUpdates
      .pipe(filter((e): e is VersionReadyEvent => e.type === 'VERSION_READY'))
      .subscribe(() => this.applyUpdate());

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
    // Guards against a reload loop: if activating somehow lands us on the same
    // version again, we must not reload forever.
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
