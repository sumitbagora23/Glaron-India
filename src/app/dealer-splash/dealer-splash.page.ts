import { Component, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { IonContent } from '@ionic/angular/standalone';
import { APP_VERSION } from '../version';

/**
 * Animated brand splash — the first in-app screen of the dealer journey.
 *
 * Flow: Splash → (first launch) Onboarding → Login → Catalog.
 * It only ROUTES the user; it changes no auth/business logic. Decisions:
 *   - already signed in on this device  → straight to the catalog
 *   - onboarding not seen yet           → onboarding carousel
 *   - otherwise                         → login
 */
@Component({
  selector: 'app-dealer-splash',
  templateUrl: './dealer-splash.page.html',
  styleUrls: ['./dealer-splash.page.scss'],
  standalone: true,
  imports: [CommonModule, IonContent],
})
export class DealerSplashPage implements OnInit, OnDestroy {
  readonly appVersion = APP_VERSION;
  leaving = false;

  private timers: any[] = [];

  // Keys reused elsewhere — kept as literals to avoid coupling.
  private readonly AUTH_KEY = 'glaron_logged_dealer_mobile';
  private readonly ONBOARD_KEY = 'glaron_dealer_onboarding_seen';

  constructor(private router: Router) {}

  ngOnInit() {
    // Show the branded full-logo splash with its loader, then move on.
    this.timers.push(setTimeout(() => this.advance(), 2800));
  }

  ngOnDestroy() {
    this.timers.forEach(t => clearTimeout(t));
  }

  // Let an impatient user tap through immediately.
  skip() {
    this.timers.forEach(t => clearTimeout(t));
    this.advance();
  }

  private advance() {
    if (this.leaving) return;
    this.leaving = true;

    let loggedIn = false;
    let onboarded = false;
    try {
      loggedIn = !!(localStorage.getItem(this.AUTH_KEY) || sessionStorage.getItem(this.AUTH_KEY));
      onboarded = localStorage.getItem(this.ONBOARD_KEY) === '1';
    } catch (e) {}

    const dest = loggedIn ? '/dealer/catalog' : (onboarded ? '/dealer/login' : '/dealer/onboarding');
    // Small fade-out before navigating for a smooth hand-off.
    setTimeout(() => this.router.navigateByUrl(dest, { replaceUrl: true }), 340);
  }
}
