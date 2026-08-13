import { Routes, Router, CanActivateFn } from '@angular/router';
import { Component, OnInit, inject } from '@angular/core';
import { DealerService } from './admin/dealer.service';
import { DEALER_SESSION_KEY, DEALER_BYPASS_MOBILE } from './dealer-auth.service';
import { AGENT_SESSION_KEY } from './agent-auth.service';
import { AgentService } from './agent.service';
import { PwaInstallService } from './pwa-install.service';

// Dealers sign in with their mobile number; that number is the session key.
export const DEALER_AUTH_KEY = DEALER_SESSION_KEY;
// Sales accounts sign in through the SAME form and live in the same installed
// app; only the list their number is found in decides which panel opens.
export const AGENT_AUTH_KEY = AGENT_SESSION_KEY;
export const ADMIN_AUTH_KEY = 'glaron_admin_logged_in';

export function isDealerLoggedIn(): boolean {
  try {
    return !!(localStorage.getItem(DEALER_AUTH_KEY) || sessionStorage.getItem(DEALER_AUTH_KEY));
  } catch (e) {
    return false;
  }
}

export function getLoggedDealerMobile(): string {
  try {
    return localStorage.getItem(DEALER_AUTH_KEY) || sessionStorage.getItem(DEALER_AUTH_KEY) || '';
  } catch (e) {
    return '';
  }
}

export function clearDealerLogin(): void {
  try {
    localStorage.removeItem(DEALER_AUTH_KEY);
    sessionStorage.removeItem(DEALER_AUTH_KEY);
  } catch (e) {}
}

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

export function isAdminLoggedIn(): boolean {
  try {
    return !!(localStorage.getItem(ADMIN_AUTH_KEY) || sessionStorage.getItem(ADMIN_AUTH_KEY));
  } catch (e) {
    return false;
  }
}

// The dealer portal is app-only: opening it in a normal browser tab shows the
// install screen instead. Once the PWA is installed and launched from the home
// screen (standalone display-mode) — or running in the Capacitor native shell —
// the dealer gets through. Localhost is exempt so `ng serve` stays usable.
export const pwaInstalledGuard: CanActivateFn = () => {
  const router = inject(Router);
  const pwa = inject(PwaInstallService);

  const host = window.location.hostname;
  const isLocalDev = host === 'localhost' || host === '127.0.0.1' || host === '::1';
  if (isLocalDev || pwa.isStandalone) return true;

  router.navigateByUrl('/dealer/install', { replaceUrl: true });
  return false;
};

// Guards dealer pages: only a logged-in (registered) device can enter,
// otherwise it's sent to the login screen. This also blocks shared links
// opened on devices that have never signed in.
export const dealerAuthGuard: CanActivateFn = () => {
  const router = inject(Router);
  if (!isDealerLoggedIn()) {
    router.navigateByUrl('/dealer/login', { replaceUrl: true });
    return false;
  }

  // A dealer removed by the admin must lose access. Once the dealer list has
  // synced from Firestore, if the logged-in mobile no longer matches any dealer,
  // clear the session and send them back to login (they must re-register).
  const mobile = getLoggedDealerMobile();
  if (mobile === DEALER_BYPASS_MOBILE) return true;

  const dealerService = inject(DealerService);
  if (dealerService.hasSynced && mobile && !dealerService.findByMobile(mobile)) {
    clearDealerLogin();
    router.navigateByUrl('/dealer/login', { replaceUrl: true });
    return false;
  }

  return true;
};

/**
 * Guards the sales panel: only a signed-in device gets in. An account the admin
 * has deleted must also lose access, so once the list has synced a session whose
 * mobile no longer matches any record is cleared.
 */
export const agentAuthGuard: CanActivateFn = () => {
  const router = inject(Router);
  if (!isAgentLoggedIn()) {
    router.navigateByUrl('/dealer/login', { replaceUrl: true });
    return false;
  }

  const mobile = getLoggedAgentMobile();
  const agentService = inject(AgentService);
  if (agentService.hasSynced && mobile && !agentService.findByMobile(mobile)) {
    clearAgentLogin();
    router.navigateByUrl('/dealer/login', { replaceUrl: true });
    return false;
  }

  return true;
};

// Guards all admin pages the same way.
export const adminAuthGuard: CanActivateFn = () => {
  const router = inject(Router);
  if (isAdminLoggedIn()) return true;
  router.navigateByUrl('/admin/login', { replaceUrl: true });
  return false;
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
    // The catalogue site is a customer-facing address: its bare root has to open
    // the catalogue, not an admin sign-in.
    if (hostname.includes('catalogue')) {
      this.router.navigateByUrl('/catalogue', { replaceUrl: true });
      return;
    }
    // `agent` as well as `dealer`: the two apps are now one build behind one
    // link, and the old agent host still resolves here for anyone who kept the
    // bookmark. Without it that host fell through to the admin branch below.
    if (hostname.includes('dealer') || hostname.includes('agent')) {
      const isLocalDev = hostname === 'localhost' || hostname === '127.0.0.1';
      // Browser tab (not the installed app) → install wall, no portal flash.
      if (!isLocalDev && !this.pwa.isStandalone) {
        this.router.navigateByUrl('/dealer/install', { replaceUrl: true });
        return;
      }
      // Already signed in on this device → straight to work, no splash delay on
      // a daily launch. Whichever session exists picks the panel.
      if (isDealerLoggedIn()) {
        this.router.navigateByUrl('/dealer/catalog', { replaceUrl: true });
      } else if (isAgentLoggedIn()) {
        this.router.navigateByUrl('/agent/panel', { replaceUrl: true });
      } else {
        // Not signed in (this is what a freshly installed app hits): show the
        // branded splash first. DealerSplashPage then hands off to the
        // onboarding carousel on a first launch, or to login after that.
        this.router.navigateByUrl('/dealer/welcome', { replaceUrl: true });
      }
    } else {
      this.router.navigateByUrl(isAdminLoggedIn() ? '/admin/home' : '/admin/login', { replaceUrl: true });
    }
  }
}

export const routes: Routes = [
  {
    path: 'admin/login',
    loadComponent: () => import('./admin/login/login.page').then((m) => m.LoginPage),
  },
  {
    path: 'admin/forgot-password',
    loadComponent: () => import('./admin/forgot-password/forgot-password.page').then((m) => m.ForgotPasswordPage),
  },
  {
    path: 'admin/reset-password',
    loadComponent: () => import('./admin/reset-password/reset-password.page').then((m) => m.ResetPasswordPage),
  },
  {
    path: 'admin',
    canActivate: [adminAuthGuard],
    loadComponent: () => import('./admin/admin-layout/admin-layout.component').then((m) => m.AdminLayoutComponent),
    children: [
      {
        path: '',
        redirectTo: 'home',
        pathMatch: 'full'
      },
      {
        path: 'home',
        loadComponent: () => import('./admin/home/home.page').then((m) => m.AdminHomePage),
      },
      {
        path: 'dashboard',
        loadComponent: () => import('./admin/dashboard/dashboard.page').then((m) => m.DashboardPage),
      },
      {
        path: 'categories',
        loadComponent: () => import('./admin/categories/categories.page').then((m) => m.CategoriesPage),
      },
      {
        path: 'categories/new',
        loadComponent: () => import('./admin/category-form/category-form.page').then((m) => m.CategoryFormPage),
      },
      {
        path: 'categories/edit/:id',
        loadComponent: () => import('./admin/category-form/category-form.page').then((m) => m.CategoryFormPage),
      },
      {
        path: 'products/new',
        loadComponent: () => import('./admin/product-form/product-form.page').then((m) => m.ProductFormPage),
      },
      {
        path: 'products/edit/:id',
        loadComponent: () => import('./admin/product-form/product-form.page').then((m) => m.ProductFormPage),
      },
      {
        path: 'dealers',
        loadComponent: () => import('./admin/dealers/dealers.page').then((m) => m.DealersPage),
      },
      {
        path: 'dealers/pricing/:id',
        loadComponent: () => import('./admin/dealer-pricing/dealer-pricing.page').then((m) => m.DealerPricingPage),
      },
      {
        path: 'orders',
        loadComponent: () => import('./admin/orders/orders.page').then((m) => m.OrdersPage),
      },
      {
        path: 'orders/create',
        loadComponent: () => import('./admin/order-compose/order-compose.page').then((m) => m.OrderComposePage),
      },
      {
        path: 'orders/add/:id',
        loadComponent: () => import('./admin/order-compose/order-compose.page').then((m) => m.OrderComposePage),
      },
      {
        path: 'banners',
        loadComponent: () => import('./admin/banners/banners.page').then((m) => m.BannersPage),
      },
      {
        path: 'banners/new',
        loadComponent: () => import('./admin/banner-form/banner-form.page').then((m) => m.BannerFormPage),
      },
      {
        path: 'banners/dealers',
        loadComponent: () => import('./admin/offer-dealers/offer-dealers.page').then((m) => m.OfferDealersPage),
      },
      {
        path: 'notifications',
        loadComponent: () => import('./admin/notifications/notifications.page').then((m) => m.NotificationsPage),
      },
      {
        path: 'notifications/new',
        loadComponent: () => import('./admin/notification-form/notification-form.page').then((m) => m.NotificationFormPage),
      },
      {
        path: 'quotations',
        loadComponent: () => import('./admin/quotations/quotations.page').then((m) => m.QuotationsPage),
      },
      {
        path: 'posts',
        loadComponent: () => import('./admin/posts/posts.page').then((m) => m.PostsPage),
      },
      {
        path: 'posts/new',
        loadComponent: () => import('./admin/post-form/post-form.page').then((m) => m.PostFormPage),
      },
      {
        path: 'logs',
        loadComponent: () => import('./admin/logs/logs.page').then((m) => m.LogsPage),
      },
      {
        path: 'share-catalogue',
        loadComponent: () => import('./admin/share-catalogue/share-catalogue.page').then((m) => m.ShareCataloguePage),
      },
      {
        path: 'settings',
        loadComponent: () => import('./admin/settings/settings.page').then((m) => m.SettingsPage),
      },
      {
        // Old location of the banner audience picker, kept so any bookmark or
        // in-flight link still lands on the right screen.
        path: 'settings/offer-dealers',
        redirectTo: 'banners/dealers',
        pathMatch: 'full',
      },
    ]
  },
  {
    // Install wall — the only dealer screen a plain browser tab can reach.
    path: 'dealer/install',
    loadComponent: () => import('./dealer-install/dealer-install.page').then((m) => m.DealerInstallPage),
  },
  {
    path: 'dealer/welcome',
    canActivate: [pwaInstalledGuard],
    loadComponent: () => import('./dealer-splash/dealer-splash.page').then((m) => m.DealerSplashPage),
  },
  {
    path: 'dealer/onboarding',
    canActivate: [pwaInstalledGuard],
    loadComponent: () => import('./dealer-onboarding/dealer-onboarding.page').then((m) => m.DealerOnboardingPage),
  },
  {
    path: 'dealer/login',
    canActivate: [pwaInstalledGuard],
    loadComponent: () => import('./dealer-login/dealer-login.page').then((m) => m.DealerLoginPage),
  },
  {
    path: 'dealer/forgot-password',
    canActivate: [pwaInstalledGuard],
    loadComponent: () => import('./dealer-forgot-password/dealer-forgot-password.page').then((m) => m.DealerForgotPasswordPage),
  },
  {
    // Dealers sign in with a mobile number, so there are no emailed reset links
    // to land on. Any old link is bounced to the help screen.
    path: 'dealer/reset-password',
    redirectTo: 'dealer/forgot-password',
    pathMatch: 'full',
  },
  {
    path: 'dealer/apply',
    canActivate: [pwaInstalledGuard],
    loadComponent: () => import('./dealer-apply/dealer-apply.page').then((m) => m.DealerApplyPage),
  },
  {
    path: 'dealer/catalog',
    canActivate: [pwaInstalledGuard, dealerAuthGuard],
    loadComponent: () => import('./dealer-panel/dealer-panel.page').then((m) => m.DealerPanelPage),
  },
  {
    path: 'dealer/checkout',
    canActivate: [pwaInstalledGuard, dealerAuthGuard],
    loadComponent: () => import('./dealer-checkout/dealer-checkout.page').then((m) => m.DealerCheckoutPage),
  },
  {
    path: 'dealer/orders',
    canActivate: [pwaInstalledGuard, dealerAuthGuard],
    loadComponent: () => import('./dealer-orders/dealer-orders.page').then((m) => m.DealerOrdersPage),
  },
  {
    path: 'dealer',
    redirectTo: 'dealer/login',
    pathMatch: 'full',
  },
  {
    // The sales panel, reached from the SAME sign-in form as the dealer catalog
    // — there is no separate login, install wall or app for it any more.
    path: 'agent/panel',
    canActivate: [pwaInstalledGuard, agentAuthGuard],
    loadComponent: () => import('./agent-panel/agent-panel.page').then((m) => m.AgentPanelPage),
  },
  {
    // Everything the retired agent app used to serve now lives behind the one
    // shared sign-in, so its old deep links land there rather than 404.
    path: 'agent/login',
    redirectTo: 'dealer/login',
    pathMatch: 'full',
  },
  {
    path: 'agent/forgot-password',
    redirectTo: 'dealer/forgot-password',
    pathMatch: 'full',
  },
  {
    path: 'agent/install',
    redirectTo: 'dealer/install',
    pathMatch: 'full',
  },
  {
    path: 'agent/welcome',
    redirectTo: 'dealer/welcome',
    pathMatch: 'full',
  },
  {
    path: 'agent',
    redirectTo: 'dealer/login',
    pathMatch: 'full',
  },
  {
    // Public catalogue — what a shared "Share Catalogue" link opens. Guard-free
    // on purpose: the recipient is a customer with no app and no sign-in, so
    // neither the install wall nor the auth guards may stand in front of it.
    // The :ref segment is what makes each shared link its own.
    path: 'catalogue/:ref',
    loadComponent: () => import('./public-catalog/public-catalog.page').then((m) => m.PublicCatalogPage),
  },
  {
    path: 'catalogue',
    loadComponent: () => import('./public-catalog/public-catalog.page').then((m) => m.PublicCatalogPage),
  },
  {
    path: 'home',
    loadComponent: () => import('./home/home.page').then((m) => m.HomePage),
  },
  {
    path: '',
    component: RootRedirectComponent,
    pathMatch: 'full'
  },
  {
    // The catalogue site serves the link straight off its root, so the address
    // a customer is sent reads as the catalogue and nothing else:
    // https://glaron-catalogue.web.app/q-glaron
    //
    // Last on purpose. Every real path above is matched first, so this only
    // ever catches a bare code. The /catalogue/:ref route above stays exactly
    // as it was — links already sitting in people's chat threads must keep
    // working forever.
    path: ':ref',
    loadComponent: () => import('./public-catalog/public-catalog.page').then((m) => m.PublicCatalogPage),
  },
];
