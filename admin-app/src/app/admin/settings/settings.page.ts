import { Component, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { IonContent } from '@ionic/angular/standalone';
import { SettingsService } from '../settings.service';
import { SwUpdate } from '@angular/service-worker';
import { AdminPushService } from '../admin-push.service';
import { PwaInstallService } from '../../pwa-install.service';
import { APP_VERSION } from '../../version';

/**
 * Settings — console-wide options.
 *
 * Offer banners, push notifications and share posts each have their own sidebar
 * tab now (see BannersPage / NotificationsPage / PostsPage); what's left here is
 * configuration rather than content.
 */
@Component({
  selector: 'app-admin-settings',
  templateUrl: './settings.page.html',
  styleUrls: ['./settings.page.scss'],
  standalone: true,
  imports: [CommonModule, FormsModule, IonContent]
})
export class SettingsPage implements OnInit {
  // Which settings screen is showing: the menu, or one section opened as its
  // own full page. Each section is reached from the menu and returns to it.
  activeSection: 'menu' | 'call' | 'alerts' = 'menu';

  callNumber = '';
  saved = false;
  errorMsg = '';
  appVersion = APP_VERSION;

  constructor(
    private settingsService: SettingsService,
    private router: Router
  ) {}

  ngOnInit() {
    this.callNumber = this.settingsService.callNumber;
  }

  // ---- Full-page section navigation ----
  openSection(section: 'call' | 'alerts') {
    this.activeSection = section;
  }

  backToMenu() {
    this.activeSection = 'menu';
  }

  // ---- Order alerts (per device) ----

  readonly push = inject(AdminPushService);
  readonly pwa = inject(PwaInstallService);
  enablingAlerts = false;
  testSent = false;

  get alertsOn(): boolean { return this.push.permission() === 'granted'; }
  get alertsBlocked(): boolean { return this.push.permission() === 'denied'; }
  get pushActive(): boolean { return this.push.pushActive(); }

  // iOS exposes no notification prompt at all until the app has been added to
  // the Home Screen, so those devices get the install guide instead.
  get needsInstallFirst(): boolean {
    return this.pwa.isIos && !this.pwa.isStandalone;
  }

  async enableAlerts() {
    if (this.enablingAlerts) return;
    this.enablingAlerts = true;
    await this.push.enable();
    this.enablingAlerts = false;
  }

  async sendTestAlert() {
    this.testSent = await this.push.sendTest();
    if (this.testSent) setTimeout(() => (this.testSent = false), 3000);
  }

  openInstallGuide() {
    this.router.navigate(['/install']);
  }

  // ---- App version ----
  //
  // The console applies updates on its own (see AppComponent), so this is a
  // manual nudge rather than the only way in — useful when someone wants to
  // confirm they are on the build that just shipped.

  private swUpdate = inject(SwUpdate);
  updateState: 'idle' | 'checking' | 'latest' | 'updating' | 'unavailable' = 'idle';

  async checkUpdate() {
    if (this.updateState === 'checking' || this.updateState === 'updating') return;
    if (!this.swUpdate.isEnabled) {
      this.updateState = 'unavailable';
      return;
    }

    this.updateState = 'checking';
    try {
      const found = await this.swUpdate.checkForUpdate();
      if (!found) {
        this.updateState = 'latest';
        setTimeout(() => (this.updateState = 'idle'), 3000);
        return;
      }
      this.updateState = 'updating';
      await this.swUpdate.activateUpdate();
      document.location.reload();
    } catch (e) {
      this.updateState = 'idle';
      console.warn('Update check notice:', (e as any)?.message || e);
    }
  }

  save() {
    this.errorMsg = '';
    const value = (this.callNumber || '').trim();
    // Allow digits, spaces, +, -, and parentheses only.
    if (value && !/^[+]?[0-9\s\-()]{6,20}$/.test(value)) {
      this.errorMsg = 'Please enter a valid phone number.';
      return;
    }
    this.settingsService.updateCallNumber(value)
      .catch(err => console.warn('Firestore settings notice:', err?.message || err));
    this.callNumber = value;
    this.saved = true;
    setTimeout(() => (this.saved = false), 2500);
  }
}
