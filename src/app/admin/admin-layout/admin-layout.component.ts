import { Component, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router, NavigationEnd, RouterModule } from '@angular/router';
import { IonContent, IonRouterOutlet } from '@ionic/angular/standalone';
import { SearchService } from '../search.service';
import { Subscription } from 'rxjs';
import { filter } from 'rxjs/operators';

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
    { name: 'Orders', icon: 'receipt' },
    { name: 'Quotations', icon: 'quote' },
    { name: 'Offer Banners', icon: 'pricetag' },
    { name: 'Notifications', icon: 'notifications' },
    { name: 'Posts', icon: 'image' },
    { name: 'Activity Logs', icon: 'activity' },
    { name: 'Share Catalogue', icon: 'share' },
    { name: 'Settings', icon: 'settings' }
  ];

  showProfileMenu = false;
  private routerSub!: Subscription;

  constructor(
    private router: Router,
    private searchService: SearchService
  ) {}

  toggleProfileMenu() {
    this.showProfileMenu = !this.showProfileMenu;
  }

  ngOnInit() {
    this.updateActiveMenu(this.router.url);

    // Track page changes to update sidebar active marker
    this.routerSub = this.router.events.pipe(
      filter(event => event instanceof NavigationEnd)
    ).subscribe((event: any) => {
      this.updateActiveMenu(event.urlAfterRedirects || event.url);
      // Clear search when switching tabs for a clean UX
      this.searchService.clear();
    });
  }

  ngOnDestroy() {
    if (this.routerSub) {
      this.routerSub.unsubscribe();
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
    } else if (url.includes('/admin/orders')) {
      this.activeMenu = 'Orders';
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
    } else if (menu === 'Orders') {
      this.router.navigate(['/admin/orders']);
    } else if (menu === 'Quotations') {
      this.router.navigate(['/admin/quotations']);
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
    } else if (menu === 'Settings') {
      this.router.navigate(['/admin/settings']);
    }
  }

  // Logout Admin Console
  logout() {
    this.showProfileMenu = false;
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
