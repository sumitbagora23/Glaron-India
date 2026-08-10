import { Routes, Router, CanActivateFn } from '@angular/router';
import { Component, OnInit, inject } from '@angular/core';
import { AgentService } from './agent.service';
import { AGENT_SESSION_KEY } from './agent-auth.service';
import { PwaInstallService } from './pwa-install.service';

/**
 * Routing for the Glaron Agent PWA.
 *
 * This app ships ONLY the agent panel. It shares no routes, guards or session
 * state with the dealer or admin apps — three separate builds on three separate
 * hosting sites; a dealer session on a device means nothing here.
 */

// Agents sign in with their mobile number; that number is the session key.
export const AGENT_AUTH_KEY = AGENT_SESSION_KEY;

export function isAgentLoggedIn(): boolean {
  try {
    return !!(localStorage.getItem(AGENT_AUTH_KEY) || sessionStorage.getItem(AGENT_AUTH_KEY));
  } catch (e) {
    return false;
  }
}

export function getLoggedAgentMobile(): string {
  try {
    return localStorage.getItem(AGENT_AUTH_KEY) || sessionStorage.getItem(AGENT_AUTH_KEY) || '';
  } catch (e) {
    return '';
  }
}

export function clearAgentLogin(): void {
  try {
    localStorage.removeItem(AGENT_AUTH_KEY);
    sessionStorage.removeItem(AGENT_AUTH_KEY);
  } catch (e) {}
}

/**
 * The agent app is app-only: opening it in a normal browser tab shows the
 * install screen instead. Once installed and launched from the home screen
 * (standalone display-mode) the agent gets through. Localhost is exempt so
 * `ng serve` stays usable.
 */
export const pwaInstalledGuard: CanActivateFn = () => {
  const router = inject(Router);
  const pwa = inject(PwaInstallService);

  const host = window.location.hostname;
  const isLocalDev = host === 'localhost' || host === '127.0.0.1' || host === '::1';
  if (isLocalDev || pwa.isStandalone) return true;

  router.navigateByUrl('/agent/install', { replaceUrl: true });
  return false;
};

/**
 * Guards the panel: only a signed-in device gets in. An agent the admin has
 * deleted must also lose access, so once the agents list has synced a session
 * whose mobile no longer matches any record is cleared.
 */
export const agentAuthGuard: CanActivateFn = () => {
  const router = inject(Router);
  if (!isAgentLoggedIn()) {
    router.navigateByUrl('/agent/login', { replaceUrl: true });
    return false;
  }

  const mobile = getLoggedAgentMobile();
  const agentService = inject(AgentService);
  if (agentService.hasSynced && mobile && !agentService.findByMobile(mobile)) {
    clearAgentLogin();
    router.navigateByUrl('/agent/login', { replaceUrl: true });
    return false;
  }

  return true;
};

@Component({
  standalone: true,
  template: '<div></div>'
})
export class RootRedirectComponent implements OnInit {
  private router = inject(Router);
  private pwa = inject(PwaInstallService);

  ngOnInit() {
    const hostname = window.location.hostname;
    const isLocalDev = hostname === 'localhost' || hostname === '127.0.0.1';

    // Browser tab (not the installed app) → install wall, no panel flash.
    if (!isLocalDev && !this.pwa.isStandalone) {
      this.router.navigateByUrl('/agent/install', { replaceUrl: true });
      return;
    }

    // An agent already signed in on this device goes straight to work — no
    // splash delay on a daily launch.
    if (isAgentLoggedIn()) {
      this.router.navigateByUrl('/agent/panel', { replaceUrl: true });
    } else {
      this.router.navigateByUrl('/agent/welcome', { replaceUrl: true });
    }
  }
}

export const routes: Routes = [
  {
    // Install wall — the only agent screen a plain browser tab can reach.
    path: 'agent/install',
    loadComponent: () => import('./agent-install/agent-install.page').then((m) => m.AgentInstallPage),
  },
  {
    path: 'agent/welcome',
    canActivate: [pwaInstalledGuard],
    loadComponent: () => import('./agent-splash/agent-splash.page').then((m) => m.AgentSplashPage),
  },
  {
    path: 'agent/login',
    canActivate: [pwaInstalledGuard],
    loadComponent: () => import('./agent-login/agent-login.page').then((m) => m.AgentLoginPage),
  },
  {
    path: 'agent/forgot-password',
    canActivate: [pwaInstalledGuard],
    loadComponent: () => import('./agent-forgot-password/agent-forgot-password.page').then((m) => m.AgentForgotPasswordPage),
  },
  {
    path: 'agent/panel',
    canActivate: [pwaInstalledGuard, agentAuthGuard],
    loadComponent: () => import('./agent-panel/agent-panel.page').then((m) => m.AgentPanelPage),
  },
  {
    path: 'agent',
    redirectTo: 'agent/login',
    pathMatch: 'full',
  },
  {
    path: '',
    component: RootRedirectComponent,
    pathMatch: 'full'
  },
  {
    path: '**',
    redirectTo: '',
  },
];
