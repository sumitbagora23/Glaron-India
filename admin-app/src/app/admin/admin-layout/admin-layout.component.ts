import { Component, OnInit, OnDestroy, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router, NavigationEnd, RouterModule } from '@angular/router';
import { IonContent, IonRouterOutlet } from '@ionic/angular/standalone';
import { SearchService } from '../search.service';
import { AdminPushService } from '../admin-push.service';
import { PwaInstallService } from '../../pwa-install.service';
import { Subscription } from 'rxjs';
import { filter } from 'rxjs/operators';

// Set once the admin dismisses the "turn on order alerts" strip, so it does not
// nag on every page load. The Settings page keeps a permanent control.
const ALERT_BANNER_DISMISSED = 'glaron_admin_alert_banner_dismissed';

@Component({
  selector: 'app-admin-layout',
  templateUrl: './admin-layout.component.html',
  styleUrls: ['./admin-layout.component.scss'],
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    RouterModule,
    IonContent,
    IonRouterOutlet
  ]
})
export class AdminLayoutComponent implements OnInit, OnDestroy {
  activeMenu = 'Home';
  sidebarItems = [
    { name: 'Home', icon: 'home' },
    { name: 'Categories', icon: 'grid' },
    { name: 'Products', icon: 'cube' },
    { name: 'Dealers', icon: 'people' },
    { name: 'Agents', icon: 'badge' },
    { name: 'Orders', icon: 'receipt' },
    // One entry: a request built room by room and one built as a single list
    // are the same job and are priced on the same page, so two entries only
    // made the console look like it had two features.
    { name: 'Quotations', icon: 'quote' },
    { name: 'Compare Quotation', icon: 'compare' },
    { name: 'Offer Banners', icon: 'pricetag' },
    { name: 'Notifications', icon: 'notifications' },
    { name: 'Posts', icon: 'image' },
    { name: 'Activity Logs', icon: 'activity' },
    { name: 'Share Catalogue', icon: 'share' },
    { name: 'Share Catalogue (Area)', icon: 'share-area' },
    { name: 'Settings', icon: 'settings' }
  ];

  showProfileMenu = false;
  private routerSub!: Subscription;

  readonly push = inject(AdminPushService);
  readonly pwa = inject(PwaInstallService);
  enablingAlerts = false;
  private bannerDismissed = false;

  // ---- Mobile shell ----
  // Below this width the sidebar stops being a fixed column and becomes a
  // drawer over the content, and the topbar's search collapses behind an icon.
  // Which controls are visible is decided in CSS at this same breakpoint, not
  // by this flag — a template that renders the shell from a cached boolean got
  // it wrong the moment the window was resized. This is read on demand, inside
  // click handlers, so it is never stale.
  private static readonly MOBILE_QUERY = '(max-width: 900px)';
  sidebarOpen = false;
  searchOpen = false;

  get isMobile(): boolean {
    return !!window.matchMedia && window.matchMedia(AdminLayoutComponent.MOBILE_QUERY).matches;
  }

  // ---- Back navigation ----
  //
  // Every screen that is not a sidebar tab needs a way out. On desktop the
  // sidebar is always on screen, so it is the way out. On a phone it is behind
  // the drawer, and an installed PWA has no browser chrome at all — iOS
  // standalone draws no back button and no back gesture — so from a detail
  // screen (an agent's payments, a product form, one quotation) there was
  // nothing to press. The only escape was the drawer, which lands on a tab
  // rather than the list the screen was opened from.
  //
  // Each sub-route below names the list it belongs to. First match wins, so
  // the more specific patterns are listed above the ones that would also
  // match them. A route that is not listed here is a tab in its own right and
  // shows no back button — there is nothing above it to go back to.
  private static readonly PARENT_ROUTES: ReadonlyArray<readonly [RegExp, string]> = [
    [/^\/admin\/categories\/(new|edit)/,               '/admin/categories'],
    [/^\/admin\/products\/(new|edit)/,                 '/admin/dashboard'],
    [/^\/admin\/dealers\/pricing/,                     '/admin/dealers'],
    [/^\/admin\/agents\/(commission|pay|pricing)/,     '/admin/agents'],
    [/^\/admin\/orders\/(create|add)/,                 '/admin/orders'],
    [/^\/admin\/banners\/(new|dealers)/,               '/admin/banners'],
    [/^\/admin\/notifications\/new/,                   '/admin/notifications'],
    [/^\/admin\/posts\/new/,                           '/admin/posts'],
    [/^\/admin\/quotations\/areas\/[^/]+/,             '/admin/quotations/areas'],
    [/^\/admin\/quotations\/requests\/[^/]+\/add/,     '/admin/quotations/requests'],
    [/^\/admin\/quotations\/requests\/[^/]+/,          '/admin/quotations/requests'],
    [/^\/admin\/settings\/offer-dealers/,              '/admin/settings'],
  ];

  /** The list this screen belongs to, or null on a tab. Set on every route change. */
  backTarget: string | null = null;

  /**
   * Go up one level.
   *
   * Deliberately a route, not `history.back()`. This app is opened from a
   * notification and from a home-screen shortcut as often as it is walked
   * into, and in both of those the previous history entry is another site or
   * nothing at all — `back()` would leave the console. Going to the named
   * parent is the same move every time, however the screen was reached.
   */
  goBack() {
    if (this.backTarget) this.router.navigateByUrl(this.backTarget);
  }

  private updateBackTarget(url: string) {
    const path = (url || '').split('?')[0].split('#')[0];
    const hit = AdminLayoutComponent.PARENT_ROUTES.find(([re]) => re.test(path));
    this.backTarget = hit ? hit[1] : null;
  }

  constructor(
    private router: Router,
    private searchService: SearchService
  ) {}

  toggleProfileMenu() {
    this.showProfileMenu = !this.showProfileMenu;
  }

  ngOnInit() {
    this.updateActiveMenu(this.router.url);
    // Also on first paint, not just on later navigations: the console is
    // routinely opened straight onto a detail screen from a notification.
    this.updateBackTarget(this.router.url);

    // Start receiving new-order alerts. Idempotent, and it only registers for
    // push when permission was already granted — asking needs a button tap.
    this.push.start();
    try { this.bannerDismissed = !!localStorage.getItem(ALERT_BANNER_DISMISSED); } catch (e) {}

    // Track page changes to update sidebar active marker
    this.routerSub = this.router.events.pipe(
      filter(event => event instanceof NavigationEnd)
    ).subscribe((event: any) => {
      this.updateActiveMenu(event.urlAfterRedirects || event.url);
      this.updateBackTarget(event.urlAfterRedirects || event.url);
      // Clear search when switching tabs for a clean UX
      this.searchService.clear();
      // A drawer left open over the new page would hide it.
      this.sidebarOpen = false;
      this.searchOpen = false;
    });
  }

  ngOnDestroy() {
    if (this.routerSub) {
      this.routerSub.unsubscribe();
    }
  }

  // ---- Mobile drawer / search ----

  toggleSidebar() {
    this.sidebarOpen = !this.sidebarOpen;
    if (this.sidebarOpen) this.searchOpen = false;
  }

  closeSidebar() {
    this.sidebarOpen = false;
  }

  toggleSearch() {
    this.searchOpen = !this.searchOpen;
    if (this.searchOpen) {
      this.sidebarOpen = false;
      // Focus after the input has actually been rendered.
      setTimeout(() => {
        const el = document.querySelector<HTMLInputElement>('.search-input');
        el?.focus();
      });
    } else {
      this.searchService.clear();
    }
  }

  // Set top-bar input binding
  get searchVal(): string {
    return this.searchService.searchKeyword();
  }

  set searchVal(val: string) {
    this.searchService.setKeyword(val);
  }

  // Update active sidebar selection based on URL path
  private updateActiveMenu(url: string) {
    if (url.includes('/admin/dealers')) {
      this.activeMenu = 'Dealers';
    } else if (url.includes('/admin/agents')) {
      this.activeMenu = 'Agents';
    } else if (url.includes('/admin/orders')) {
      this.activeMenu = 'Orders';
    } else if (url.includes('/admin/quotations/compare')) {
      this.activeMenu = 'Compare Quotation';
    } else if (url.includes('/admin/quotations')) {
      this.activeMenu = 'Quotations';
    } else if (url.includes('/admin/categories')) {
      this.activeMenu = 'Categories';
    } else if (url.includes('/admin/dashboard') || url.includes('/admin/products')) {
      this.activeMenu = 'Products';
    } else if (url.includes('/admin/home')) {
      this.activeMenu = 'Home';
    } else if (url.includes('/admin/banners')) {
      this.activeMenu = 'Offer Banners';
    } else if (url.includes('/admin/notifications')) {
      this.activeMenu = 'Notifications';
    } else if (url.includes('/admin/posts')) {
      this.activeMenu = 'Posts';
    } else if (url.includes('/admin/logs')) {
      this.activeMenu = 'Activity Logs';
    } else if (url.includes('/admin/share-catalogue-area')) {
      this.activeMenu = 'Share Catalogue (Area)';
    } else if (url.includes('/admin/share-catalogue')) {
      this.activeMenu = 'Share Catalogue';
    } else if (url.includes('/admin/settings')) {
      this.activeMenu = 'Settings';
    }
  }

  // Sidebar redirect
  selectMenu(menu: string) {
    this.activeMenu = menu;
    if (menu === 'Home') {
      this.router.navigate(['/admin/home']);
    } else if (menu === 'Categories') {
      this.router.navigate(['/admin/categories']);
    } else if (menu === 'Products') {
      this.router.navigate(['/admin/dashboard']);
    } else if (menu === 'Dealers') {
      this.router.navigate(['/admin/dealers']);
    } else if (menu === 'Agents') {
      this.router.navigate(['/admin/agents']);
    } else if (menu === 'Orders') {
      this.router.navigate(['/admin/orders']);
    } else if (menu === 'Quotations') {
      this.router.navigate(['/admin/quotations/requests']);
    } else if (menu === 'Compare Quotation') {
      this.router.navigate(['/admin/quotations/compare']);
    } else if (menu === 'Offer Banners') {
      this.router.navigate(['/admin/banners']);
    } else if (menu === 'Notifications') {
      this.router.navigate(['/admin/notifications']);
    } else if (menu === 'Posts') {
      this.router.navigate(['/admin/posts']);
    } else if (menu === 'Activity Logs') {
      this.router.navigate(['/admin/logs']);
    } else if (menu === 'Share Catalogue') {
      this.router.navigate(['/admin/share-catalogue']);
    } else if (menu === 'Share Catalogue (Area)') {
      this.router.navigate(['/admin/share-catalogue-area']);
    } else if (menu === 'Settings') {
      this.router.navigate(['/admin/settings']);
    }
  }

  // ---- New-order alerts ----

  get alertsOn(): boolean {
    return this.push.permission() === 'granted';
  }

  // On iPhone/iPad the notification prompt simply doesn't exist until the app
  // has been added to the Home Screen, so those devices are sent to /install
  // instead of being offered a button that cannot work.
  get needsInstallFirst(): boolean {
    return this.pwa.isIos && !this.pwa.isStandalone;
  }

  get showAlertBanner(): boolean {
    return !this.alertsOn && !this.bannerDismissed && this.push.permission() !== 'denied';
  }

  async enableAlerts() {
    if (this.enablingAlerts) return;
    if (this.needsInstallFirst) {
      this.router.navigate(['/install']);
      return;
    }
    this.enablingAlerts = true;
    await this.push.enable();
    this.enablingAlerts = false;
  }

  dismissAlertBanner() {
    this.bannerDismissed = true;
    try { localStorage.setItem(ALERT_BANNER_DISMISSED, '1'); } catch (e) {}
  }

  // Logout Admin Console
  async logout() {
    this.showProfileMenu = false;
    // Stop this device receiving order pushes meant for a signed-in admin.
    await this.push.disable();
    try {
      localStorage.removeItem('glaron_admin_logged_in');
      sessionStorage.removeItem('glaron_admin_logged_in');
    } catch (e) {}
    this.router.navigate(['/admin/login']);
  }

  // Dialog actions
  newOrder() {
    this.router.navigate(['/admin/dashboard']);
  }
}
