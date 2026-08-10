import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { IonContent } from '@ionic/angular/standalone';
import { SearchService } from '../search.service';
import { DealerService, Dealer } from '../dealer.service';

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

  constructor(
    private router: Router,
    private searchService: SearchService,
    private dealerService: DealerService
  ) {}

  ngOnInit() {}

  // Fetch dealers from shared DealerService
  get dealers(): Dealer[] {
    return this.dealerService.dealers;
  }

  // Filter list by name, location, or status
  get filteredDealers(): Dealer[] {
    const searchVal = this.searchService.searchKeyword();
    if (!searchVal.trim()) {
      return this.dealers;
    }
    const keyword = searchVal.toLowerCase().trim();
    return this.dealers.filter(dealer =>
      dealer.name.toLowerCase().includes(keyword) ||
      dealer.location.toLowerCase().includes(keyword) ||
      dealer.status.toLowerCase().includes(keyword) ||
      dealer.phone.toLowerCase().includes(keyword)
    );
  }

  // Navigate to the custom pricing sub-page
  setCustomPricing(dealer: Dealer) {
    this.router.navigate(['/admin/dealers/pricing', dealer.name]);
  }

  // Dialog triggers
  addDealer() {
    alert('UX Microcopy: "Add Partner portal will open shortly. Prepare dealer credentials, billing address, and credit parameters."');
  }

  exportCSV() {
    alert('UX Microcopy: "Downloading Dealer Catalog CSV sheet. Saving partner list to local files."');
  }
}
