import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { IonContent } from '@ionic/angular/standalone';
import { SearchService } from '../search.service';
import { DealerService, Dealer, DealerStatus } from '../dealer.service';
import { DealerAuthService } from '../../dealer-auth.service';

@Component({
  selector: 'app-dealers',
  templateUrl: './dealers.page.html',
  styleUrls: ['./dealers.page.scss'],
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    IonContent
  ]
})
export class DealersPage implements OnInit {
  // Status filter for the list ('All' | 'Active' | 'Inactive')
  statusFilter: 'All' | DealerStatus = 'All';
  statusOptions: DealerStatus[] = ['Active', 'Inactive'];

  constructor(
    private router: Router,
    private searchService: SearchService,
    private dealerService: DealerService,
    private dealerAuth: DealerAuthService
  ) {}

  ngOnInit() {}

  // Fetch dealers from shared DealerService
  get dealers(): Dealer[] {
    return this.dealerService.dealers;
  }

  // Normalize any status (incl. legacy 'Pending Approval') to Active/Inactive
  statusOf(dealer: Dealer): DealerStatus {
    return dealer.status === 'Active' ? 'Active' : 'Inactive';
  }

  // Filter list by status filter + search keyword
  // Prevents rebuilding every dealer row (and losing open dropdown state)
  // whenever a Firestore snapshot replaces the dealers array.
  trackByDealerId(_index: number, dealer: Dealer): string {
    return dealer.id || dealer.phone || '';
  }

  get filteredDealers(): Dealer[] {
    let list = this.dealers;

    if (this.statusFilter !== 'All') {
      list = list.filter(dealer => this.statusOf(dealer) === this.statusFilter);
    }

    const searchVal = this.searchService.searchKeyword();
    if (searchVal.trim()) {
      const keyword = searchVal.toLowerCase().trim();
      list = list.filter(dealer =>
        dealer.name.toLowerCase().includes(keyword) ||
        (dealer.contactPerson && dealer.contactPerson.toLowerCase().includes(keyword)) ||
        (dealer.email && dealer.email.toLowerCase().includes(keyword)) ||
        dealer.location.toLowerCase().includes(keyword) ||
        dealer.status.toLowerCase().includes(keyword) ||
        (dealer.phone || '').toLowerCase().includes(keyword)
      );
    }

    return list;
  }

  // Change dealer status via the dropdown
  changeStatus(dealer: Dealer, newStatus: string) {
    if (!dealer.id) return;
    const status = newStatus as DealerStatus;
    if (status && status !== this.statusOf(dealer)) {
      this.dealerService.updateDealerStatus(dealer.id, status);
    }
  }

  // Delete a dealer (with confirmation)
  deleteDealer(dealer: Dealer, event?: Event) {
    if (event) event.stopPropagation();
    if (!dealer.id) return;
    if (confirm(`Delete dealer "${dealer.name}"? This cannot be undone.`)) {
      this.dealerService.deleteDealer(dealer.id);
    }
  }

  // Navigate to the custom pricing sub-page
  setCustomPricing(dealer: Dealer) {
    this.router.navigate(['/admin/dealers/pricing', dealer.name]);
  }

  // Does this dealer have a password they can sign in with? Records created
  // before mobile sign-in don't, and need the admin to set one.
  hasPassword(dealer: Dealer): boolean {
    return !!dealer.passwordHash;
  }

  // Set (or replace) a dealer's sign-in password. This is the only reset path —
  // dealers sign in with mobile + password and there is no email link or OTP to
  // verify a self-serve reset with.
  async resetPassword(dealer: Dealer, event?: Event) {
    if (event) event.stopPropagation();
    if (!dealer.id) return;
    if (!this.dealerAuth.isValidMobile(dealer.phone)) {
      alert(`"${dealer.name}" has no valid 10-digit mobile number on record, so there is no account to set a password for.`);
      return;
    }

    const password = prompt(`Set a new sign-in password for "${dealer.name}" (+91 ${this.dealerAuth.normalizeMobile(dealer.phone)}).\n\nMinimum 6 characters. Share it with the dealer — it can't be read back later.`) || '';
    if (!password) return;
    if (password.length < 6) {
      alert('Password must be at least 6 characters long.');
      return;
    }

    try {
      await this.dealerAuth.setPassword(dealer.id, dealer.phone, password);
      alert(`Password updated. ${dealer.name} can now sign in with +91 ${this.dealerAuth.normalizeMobile(dealer.phone)}.`);
    } catch (e) {
      console.error('Dealer password reset error:', e);
      alert('Could not update the password. Please check your connection and try again.');
    }
  }

  // Add Dealer modal / prompt
  addDealer() {
    const name = prompt('Enter Dealer Business Name:');
    if (!name) return;
    const contactPerson = prompt('Enter Contact Person Name:') || '';
    // The mobile number is the dealer's sign-in identity, so it's required.
    const phone = prompt('Enter Mobile Number (10 digits — this is their login):') || '';
    if (!this.dealerAuth.isValidMobile(phone)) {
      alert('A valid 10-digit mobile number is required — it is what the dealer signs in with.');
      return;
    }
    if (this.dealerService.findByMobile(phone)) {
      alert('A dealer is already registered with that mobile number.');
      return;
    }
    const email = prompt('Enter Email Address (optional):') || '';
    const address = prompt('Enter Business Address:') || '';
    const gstNumber = prompt('Enter GST Number (Optional):') || '';
    const password = prompt('Set a sign-in password for this dealer (min. 6 characters). Leave blank to set one later:') || '';
    if (password && password.length < 6) {
      alert('Password must be at least 6 characters long.');
      return;
    }

    const create = (passwordHash?: string) => this.dealerService.addDealer({
      name,
      contactPerson,
      email,
      phone: this.dealerAuth.normalizeMobile(phone),
      address,
      gstNumber,
      status: 'Active',
      passwordHash
    });

    if (password) {
      this.dealerAuth.hashPassword(phone, password)
        .then(hash => create(hash))
        .catch(() => create());
    } else {
      create();
    }
  }

  exportCSV() {
    if (this.dealers.length === 0) {
      alert('No dealer records to export.');
      return;
    }
    const headers = ['Dealer Name', 'Contact Person', 'Email', 'Mobile', 'Address', 'GST Number', 'Status', 'Multiplier'];
    // A quote inside a field has to be doubled, or it ends the field early and
    // shifts every following column.
    const cell = (value: unknown) => `"${String(value ?? '').replace(/"/g, '""')}"`;
    const rows = this.dealers.map(d => [
      cell(d.name),
      cell(d.contactPerson),
      cell(d.email),
      cell(d.phone),
      cell(d.address || d.location),
      cell(d.gstNumber),
      cell(d.status),
      cell(`${d.multiplier}x`)
    ]);
    const csvContent = [headers.join(','), ...rows.map(e => e.join(','))].join('\r\n');

    // Downloaded as a Blob rather than a data: URI. encodeURI leaves '#'
    // untouched, and Indian addresses routinely start with one ("#12, MG
    // Road") — everything after it was read as a fragment and dropped.
    // The BOM keeps Excel from mangling non-ASCII names.
    const blob = new Blob(['﻿' + csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.setAttribute('href', url);
    link.setAttribute('download', 'glaron_dealers_export.csv');
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
  }
}
