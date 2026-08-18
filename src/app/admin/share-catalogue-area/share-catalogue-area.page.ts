import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { IonContent } from '@ionic/angular/standalone';
import { CatalogShareService } from '../../catalog-share.service';

/**
 * Share Catalogue (Area Wise) — the office's second catalogue link.
 *
 * It is the Share Catalogue link with one thing added. Whoever opens it gets
 * the same catalogue and the same two quotation routes, plus an Areas tab: they
 * name the spaces of their job — kitchen, lobby, master bedroom — and fill each
 * one from the catalogue. What arrives in the console is that same list already
 * split by room, and the quotation that goes back is read the same way.
 *
 * It is a separate link rather than a switch on the old one because the two are
 * sent to different people: a customer buying a few fittings wants the plain
 * list, and a customer doing a whole flat wants it room by room. The link they
 * are handed decides which page they get, with nothing to choose on arrival.
 *
 * Like every shared link, it shows no price. A rate belongs to a dealer
 * account, and nobody opening a link is signed in to one.
 */
@Component({
  selector: 'app-admin-share-catalogue-area',
  templateUrl: './share-catalogue-area.page.html',
  styleUrls: ['./share-catalogue-area.page.scss'],
  standalone: true,
  imports: [CommonModule, IonContent]
})
export class ShareCatalogueAreaPage {
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

  /** Hand the branded card and the area-wise link to the device share sheet. */
  async shareLink() {
    if (this.sharing) return;
    this.sharing = true;
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
