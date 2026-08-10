import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { IonContent } from '@ionic/angular/standalone';
import { SettingsService } from '../settings.service';
import { DealerService } from '../dealer.service';

/**
 * Offer Banners — its own sidebar tab.
 *
 * Lists every banner currently configured, in the order dealers see them in the
 * home-tab carousel, and carries the "who can see them" selection. Adding a
 * banner opens its own full page (see BannerFormPage).
 */
@Component({
  selector: 'app-admin-banners',
  templateUrl: './banners.page.html',
  styleUrls: ['./banners.page.scss'],
  standalone: true,
  imports: [CommonModule, IonContent]
})
export class BannersPage {
  constructor(
    private settingsService: SettingsService,
    private dealerService: DealerService,
    private router: Router
  ) {}

  // Live list straight from settings, so a change made anywhere shows up here.
  get banners(): string[] {
    return this.settingsService.offerBanners;
  }

  // How many dealers are currently ticked. Ids left over from dealers that have
  // since been deleted are ignored, otherwise the pill could read something
  // impossible like "3 / 1 selected".
  get selectedDealerCount(): number {
    const existing = new Set(this.dealerService.dealers.map(d => d.id).filter(Boolean));
    return this.settingsService.offerDealerIds.filter(id => existing.has(id)).length;
  }

  get totalDealerCount(): number {
    return this.dealerService.dealers.length;
  }

  trackByIndex(index: number): number {
    return index;
  }

  addBanner() {
    this.router.navigate(['/admin/banners/new']);
  }

  openDealerSelection() {
    this.router.navigate(['/admin/banners/dealers']);
  }

  // Reordering and deleting are applied straight away — there is no Save button
  // on this page, so what the admin sees here is exactly what dealers get.
  moveUp(index: number) {
    if (index <= 0) return;
    const list = [...this.banners];
    [list[index - 1], list[index]] = [list[index], list[index - 1]];
    this.settingsService.updateOfferBanners(list)
      .catch(err => console.warn('Firestore settings notice:', err?.message || err));
  }

  moveDown(index: number) {
    if (index >= this.banners.length - 1) return;
    const list = [...this.banners];
    [list[index + 1], list[index]] = [list[index], list[index + 1]];
    this.settingsService.updateOfferBanners(list)
      .catch(err => console.warn('Firestore settings notice:', err?.message || err));
  }

  removeBanner(index: number, event: Event) {
    event.stopPropagation();
    if (!confirm('Delete this banner? Dealers will stop seeing it right away.')) return;
    this.settingsService.updateOfferBanners(this.banners.filter((_, i) => i !== index))
      .catch(err => console.warn('Firestore settings notice:', err?.message || err));
  }
}
