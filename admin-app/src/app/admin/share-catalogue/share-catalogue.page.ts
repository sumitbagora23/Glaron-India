import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { IonContent } from '@ionic/angular/standalone';
import { CatalogShareService } from '../../catalog-share.service';

/**
 * Share Catalogue — the office's own catalogue link.
 *
 * Dealers and agents each share their own link from their panel, and those open
 * a plain catalogue: their customer can browse the range but cannot ask Glaron
 * to price anything, because that sale belongs to the dealer who sent it.
 *
 * The link shared here is the exception. It is the one Glaron sends out itself,
 * and it carries the quotation flow — a customer can build a list and ask for a
 * price, or send in a quote they already hold to be beaten.
 *
 * One button, and the link never appears on screen. It travels as the caption
 * on a branded card, which is how it should arrive in a chat; a URL sitting in
 * a box invites pasting it somewhere bare.
 *
 * Neither link shows a price. Prices are a dealer's rate; a stranger opening a
 * link has none.
 */
@Component({
  selector: 'app-admin-share-catalogue',
  templateUrl: './share-catalogue.page.html',
  styleUrls: ['./share-catalogue.page.scss'],
  standalone: true,
  imports: [CommonModule, IonContent]
})
export class ShareCataloguePage {
  sharing = false;
  shareNote = '';

  private noteTimer: any = null;

  constructor(private catalogShare: CatalogShareService) {}

  /**
   * On `ng serve` the console runs on its own port, which serves no catalogue —
   * the dealer dev server does. Deployed, the service already knows the
   * catalogue's address and this stays out of its way.
   */
  private get devOrigin(): string | undefined {
    const host = window.location.hostname;
    return host === 'localhost' || host === '127.0.0.1' ? 'http://localhost:4200' : undefined;
  }

  /**
   * Hand the branded card and the link to the device share sheet.
   *
   * Desktop browsers mostly have no share sheet, so the service falls back to
   * the clipboard — which is why this reports what actually happened rather
   * than assuming a sheet opened.
   */
  async shareLink() {
    if (this.sharing) return;
    this.sharing = true;
    // The area-wise link, which is now the only one. It could always do
    // everything the plain office link could — see isOfficeRef, which is true
    // for both prefixes — and adds areas on top, so sharing it takes nothing
    // away from a customer who only ever wants one flat list.
    const outcome = await this.catalogShare.share('', {
      area: true,
      origin: this.devOrigin
    });
    this.sharing = false;

    if (outcome === 'copied') this.flashNote('No share sheet on this device — the link is on your clipboard.');
    else if (outcome === 'failed') this.flashNote('Could not share that just now. Please try again.');
  }

  private flashNote(text: string) {
    this.shareNote = text;
    if (this.noteTimer) clearTimeout(this.noteTimer);
    this.noteTimer = setTimeout(() => (this.shareNote = ''), 3600);
  }
}
