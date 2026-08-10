import { Component, inject, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { IonApp, IonRouterOutlet } from '@ionic/angular/standalone';
import { SwUpdate, UnrecoverableStateEvent } from '@angular/service-worker';
import { APP_VERSION } from './version';
import { isDealerLoggedIn, isAgentLoggedIn } from './app.routes';
import { NotificationService } from './admin/notification.service';
import { DealerApprovalService } from './dealer-approval.service';

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

    // No automatic updates. The installed PWA must NEVER check for, download-and-
    // activate, or reload into a new version on its own — not on launch, not when
    // brought to the foreground, and not on any timer. A new version is applied
    // ONLY when the user taps "Check for update" in the panel profile, which
    // calls swUpdate.checkForUpdate() + activateUpdate() itself. Deliberately no
    // versionUpdates auto-activation and no proactive checkForUpdate() here.

    // Safety net only: if the cached app reaches a broken/unrecoverable service-
    // worker state it cannot run at all, so force one clean reload to heal it.
    // This is crash recovery, not an update.
    this.swUpdate.unrecoverable
      .subscribe((_e: UnrecoverableStateEvent) => document.location.reload());
  }
}
