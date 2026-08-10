import { Component, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { IonContent } from '@ionic/angular/standalone';
import { APP_VERSION } from '../version';

/**
 * Animated brand splash — the first in-app screen of the agent journey.
 *
 * Flow: Splash → Login → Panel. There is no onboarding carousel: an agent
 * account only exists because the admin handed over a number and a password,
 * so the first thing they need is the sign-in form.
 */
@Component({
  selector: 'app-agent-splash',
  templateUrl: './agent-splash.page.html',
  styleUrls: ['./agent-splash.page.scss'],
  standalone: true,
  imports: [CommonModule, IonContent],
})
export class AgentSplashPage implements OnInit, OnDestroy {
  readonly appVersion = APP_VERSION;
  leaving = false;

  private timers: any[] = [];

  // Kept as a literal to avoid coupling this screen to the auth service.
  private readonly AUTH_KEY = 'glaron_logged_agent_mobile';

  constructor(private router: Router) {}

  ngOnInit() {
    this.timers.push(setTimeout(() => this.advance(), 2600));
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
    try {
      loggedIn = !!(localStorage.getItem(this.AUTH_KEY) || sessionStorage.getItem(this.AUTH_KEY));
    } catch (e) {}

    const dest = loggedIn ? '/agent/panel' : '/agent/login';
    // Small fade-out before navigating for a smooth hand-off.
    setTimeout(() => this.router.navigateByUrl(dest, { replaceUrl: true }), 340);
  }
}
