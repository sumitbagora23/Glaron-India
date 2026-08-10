import { Component, inject, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { IonApp, IonRouterOutlet } from '@ionic/angular/standalone';
import { SwUpdate, UnrecoverableStateEvent } from '@angular/service-worker';
import { APP_VERSION } from './version';

@Component({
  selector: 'app-root',
  templateUrl: 'app.component.html',
  styleUrls: ['app.component.scss'],
  imports: [CommonModule, IonApp, IonRouterOutlet],
})
export class AppComponent implements OnInit {
  private swUpdate = inject(SwUpdate);

  // Current running version (shown in the app UI).
  readonly currentVersion = APP_VERSION;

  ngOnInit() {
    if (!this.swUpdate.isEnabled) return;

    // No automatic updates — same rule as the dealer app. A new version is
    // applied ONLY when the agent taps "Check for update" in the side menu,
    // which calls checkForUpdate() + activateUpdate() itself.

    // Safety net only: if the cached app reaches a broken/unrecoverable
    // service-worker state it cannot run at all, so force one clean reload to
    // heal it. This is crash recovery, not an update.
    this.swUpdate.unrecoverable
      .subscribe((_e: UnrecoverableStateEvent) => document.location.reload());
  }
}
