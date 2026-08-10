import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { IonContent } from '@ionic/angular/standalone';
import { PwaInstallService } from '../pwa-install.service';
import { AdminPushService } from '../admin/admin-push.service';
import { APP_VERSION } from '../version';

/**
 * Install + alerts setup for the admin console.
 *
 * Reachable at /install from anywhere (there is a link in Settings). It exists
 * because "notify me when a dealer orders, even with the app closed" has real
 * platform requirements the admin has to complete once per device:
 *
 *  • iPhone/iPad — iOS only allows Web Push for an app added to the Home Screen
 *    from Safari, and only on iOS 16.4+. In a plain Safari tab the permission
 *    prompt does not even exist.
 *  • Android/desktop — installing is optional but recommended: an installed app
 *    keeps its service worker alive more reliably, so alerts arrive faster.
 *
 * Unlike the dealer app's install wall, this screen never blocks anything.
 */
@Component({
  selector: 'app-admin-install',
  templateUrl: './admin-install.page.html',
  styleUrls: ['./admin-install.page.scss'],
  standalone: true,
  imports: [CommonModule, IonContent]
})
export class AdminInstallPage {
  private router = inject(Router);
  readonly pwa = inject(PwaInstallService);
  readonly push = inject(AdminPushService);

  readonly appVersion = APP_VERSION;
  installing = false;
  enabling = false;
  justInstalled = false;

  get isIos(): boolean { return this.pwa.isIos; }
  get isIosNonSafari(): boolean { return this.pwa.isIosNonSafari; }
  get isStandalone(): boolean { return this.pwa.isStandalone; }
  get canPrompt(): boolean { return this.pwa.canPrompt(); }

  // iOS refuses to expose the Notification API outside a home-screen app, so
  // "unsupported" on an iPhone means "not installed yet" rather than "never".
  get needsInstallForAlerts(): boolean {
    return this.isIos && !this.isStandalone;
  }

  get alertsOn(): boolean {
    return this.push.permission() === 'granted';
  }

  get alertsBlocked(): boolean {
    return this.push.permission() === 'denied';
  }

  async install() {
    if (this.installing) return;
    this.installing = true;
    const accepted = await this.pwa.promptInstall();
    this.installing = false;
    if (accepted) this.justInstalled = true;
  }

  async enableAlerts() {
    if (this.enabling) return;
    this.enabling = true;
    await this.push.enable();
    this.enabling = false;
  }

  back() {
    this.router.navigateByUrl('/admin/home', { replaceUrl: true });
  }
}
