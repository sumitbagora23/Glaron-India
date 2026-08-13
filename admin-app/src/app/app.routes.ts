import { Routes, Router, CanActivateFn } from '@angular/router';
import { Component, OnInit, inject } from '@angular/core';

/**
 * Routing for the Glaron Admin PWA.
 *
 * This app ships ONLY the admin console. It shares no routes, guards or session
 * state with the dealer PWA — the two are separate builds deployed to separate
 * hosting sites, and a dealer session on a device means nothing here.
 */

// Where a signed-in admin's email is kept. Written by the login page.
export const ADMIN_AUTH_KEY = 'glaron_admin_logged_in';

export function isAdminLoggedIn(): boolean {
  try {
    return !!(localStorage.getItem(ADMIN_AUTH_KEY) || sessionStorage.getItem(ADMIN_AUTH_KEY));
  } catch (e) {
    return false;
  }
}

export function getLoggedAdminEmail(): string {
  try {
    return localStorage.getItem(ADMIN_AUTH_KEY) || sessionStorage.getItem(ADMIN_AUTH_KEY) || '';
  } catch (e) {
    return '';
  }
}

// Every console page sits behind this: no admin session → login screen.
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

  ngOnInit() {
    this.router.navigateByUrl(isAdminLoggedIn() ? '/admin/home' : '/admin/login', { replaceUrl: true });
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
        path: 'agents',
        loadComponent: () => import('./admin/agents/agents.page').then((m) => m.AgentsPage),
      },
      {
        path: 'agents/commission/:id',
        loadComponent: () => import('./admin/agent-commission/agent-commission.page').then((m) => m.AgentCommissionPage),
      },
      {
        path: 'agents/pay/:id',
        loadComponent: () => import('./admin/agent-pay/agent-pay.page').then((m) => m.AgentPayPage),
      },
      {
        path: 'agents/pricing/:id',
        loadComponent: () => import('./admin/agent-pricing/agent-pricing.page').then((m) => m.AgentPricingPage),
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
    // How to install the console on a phone. Reachable from a browser tab so an
    // admin can find the instructions before installing; unlike the dealer app
    // this is guidance, not a wall — the console stays usable in a desktop tab.
    path: 'install',
    loadComponent: () => import('./install/admin-install.page').then((m) => m.AdminInstallPage),
  },
  {
    path: '',
    component: RootRedirectComponent,
    pathMatch: 'full'
  },
  {
    // Push notifications open deep links; anything unrecognised lands on home.
    path: '**',
    redirectTo: '',
  },
];
