import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { IonContent } from '@ionic/angular/standalone';
import { DealerService, Dealer } from '../dealer.service';
import { SettingsService } from '../settings.service';

@Component({
  selector: 'app-offer-dealers',
  templateUrl: './offer-dealers.page.html',
  styleUrls: ['./offer-dealers.page.scss'],
  standalone: true,
  imports: [CommonModule, FormsModule, IonContent]
})
export class OfferDealersPage implements OnInit {
  // Live search box over the dealer list.
  searchQuery = '';

  // Set of currently-ticked dealer ids (working copy until Save).
  private selectedIds = new Set<string>();

  saved = false;

  constructor(
    private dealerService: DealerService,
    private settingsService: SettingsService,
    private router: Router
  ) {}

  async ngOnInit() {
    // Seed the working selection from what's already saved.
    this.selectedIds = new Set(this.settingsService.offerDealerIds);
    // Once the dealer list has actually synced, drop ids whose dealer has since
    // been deleted — they can't be shown or unticked here, so keeping them would
    // only inflate the count. Waiting for the sync avoids clearing the selection
    // just because the list hadn't loaded yet.
    await this.dealerService.whenReady();
    const existing = new Set(this.dealerService.dealers.map(d => d.id).filter(Boolean));
    this.selectedIds.forEach(id => {
      if (!existing.has(id)) this.selectedIds.delete(id);
    });
  }

  get dealers(): Dealer[] {
    return this.dealerService.dealers;
  }

  get filteredDealers(): Dealer[] {
    const q = this.searchQuery.toLowerCase().trim();
    if (!q) return this.dealers;
    return this.dealers.filter(d =>
      d.name.toLowerCase().includes(q) ||
      (d.email && d.email.toLowerCase().includes(q)) ||
      (d.phone && d.phone.toLowerCase().includes(q)) ||
      (d.location && d.location.toLowerCase().includes(q))
    );
  }

  trackByDealerId(_index: number, dealer: Dealer): string {
    return dealer.id || dealer.email || '';
  }

  get selectedCount(): number {
    return this.selectedIds.size;
  }

  isSelected(dealer: Dealer): boolean {
    return !!dealer.id && this.selectedIds.has(dealer.id);
  }

  toggleDealer(dealer: Dealer) {
    if (!dealer.id) return;
    if (this.selectedIds.has(dealer.id)) {
      this.selectedIds.delete(dealer.id);
    } else {
      this.selectedIds.add(dealer.id);
    }
  }

  // "Select all" reflects the currently-filtered list: checked only when every
  // visible dealer is selected.
  get allSelected(): boolean {
    const list = this.filteredDealers.filter(d => !!d.id);
    return list.length > 0 && list.every(d => this.selectedIds.has(d.id!));
  }

  toggleSelectAll() {
    const list = this.filteredDealers.filter(d => !!d.id);
    if (this.allSelected) {
      list.forEach(d => this.selectedIds.delete(d.id!));
    } else {
      list.forEach(d => this.selectedIds.add(d.id!));
    }
  }

  save() {
    this.settingsService.updateOfferDealerIds(Array.from(this.selectedIds))
      .catch(err => console.warn('Firestore settings notice:', err?.message || err));
    this.saved = true;
    setTimeout(() => this.router.navigate(['/admin/banners']), 700);
  }

  cancel() {
    this.router.navigate(['/admin/banners']);
  }
}
