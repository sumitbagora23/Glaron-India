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
  activeMenu = 'Products';
  sidebarItems = [
    { name: 'Products', icon: 'cube' },
    { name: 'Dealers', icon: 'people' },
    { name: 'Orders', icon: 'receipt' },
    { name: 'Settings', icon: 'settings' }
  ];

  private routerSub!: Subscription;

  constructor(
    private router: Router,
    private searchService: SearchService
  ) {}

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
    } else if (url.includes('/admin/dashboard') || url.includes('/admin/products')) {
      this.activeMenu = 'Products';
    } else if (url.includes('/admin/settings')) {
      this.activeMenu = 'Settings';
    }
  }

  // Sidebar redirect
  selectMenu(menu: string) {
    this.activeMenu = menu;
    console.log('Static Sidebar Navigation to:', menu);
    if (menu === 'Products') {
      this.router.navigate(['/admin/dashboard']);
    } else if (menu === 'Dealers') {
      this.router.navigate(['/admin/dealers']);
    } else if (menu === 'Orders') {
      this.router.navigate(['/admin/orders']);
    } else if (menu === 'Settings') {
      alert('UX Microcopy: "Settings page under construction. Click options to edit catalog items."');
    }
  }

  // Logout Admin Console
  logout() {
    this.router.navigate(['/admin/login']);
  }

  // Dialog actions
  newOrder() {
    alert('UX Microcopy: "Direct Order checkout screen. Directing order forms details."');
    this.router.navigate(['/admin/dashboard']);
  }
}
