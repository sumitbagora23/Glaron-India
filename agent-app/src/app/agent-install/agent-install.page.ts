import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { IonContent } from '@ionic/angular/standalone';
import { PwaInstallService } from '../pwa-install.service';
import { APP_VERSION } from '../version';

/**
 * Install wall for the agent app.
 *
 * The agent panel is an app-only experience: opening the agent site in a normal
 * browser tab lands here instead. Once the PWA is installed and launched from
 * the home screen (standalone display-mode), the guard lets the agent through.
 */
@Component({
  selector: 'app-agent-install',
  templateUrl: './agent-install.page.html',
  styleUrls: ['./agent-install.page.scss'],
  standalone: true,
  imports: [CommonModule, IonContent]
})
export class AgentInstallPage implements OnInit {
  readonly appVersion = APP_VERSION;
  installing = false;
  justInstalled = false;

  constructor(
    private router: Router,
    public pwa: PwaInstallService
  ) {}

  ngOnInit() {
    // Already running installed (e.g. hit this URL from inside the app) —
    // there is nothing to install, so go straight in.
    if (this.pwa.isStandalone) {
      this.router.navigateByUrl('/agent/welcome', { replaceUrl: true });
    }
  }

  get isIos(): boolean {
    return this.pwa.isIos;
  }

  // iOS Chrome/Firefox/in-app browsers can't add to the home screen.
  get isIosNonSafari(): boolean {
    return this.pwa.isIosNonSafari;
  }

  get canPrompt(): boolean {
    return this.pwa.canPrompt();
  }

  async install() {
    if (this.installing) return;
    this.installing = true;
    const accepted = await this.pwa.promptInstall();
    this.installing = false;
    if (accepted) this.justInstalled = true;
  }
}
