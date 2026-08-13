import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { IonContent } from '@ionic/angular/standalone';
import { QuotationService, CustomerQuotation, QuotationItem } from '../quotation.service';
import { ProductService } from '../product.service';

/**
 * Quotations — its own sidebar tab.
 *
 * The tab opens on a chooser with two jobs on it:
 *   • Requested Quotations — lists customers built themselves in the public
 *     catalogue and asked to be priced. That page shows no prices at all, so
 *     this is how a customer asks what something costs.
 *   • Compare Quotation — quotes customers have uploaded from the same link,
 *     with the name and mobile they left, so the admin can price against them.
 *
 * Replying is a row action on both, not a screen of its own: the customer is
 * already in front of you when you are reading what they sent, so the WhatsApp
 * button lives on their row.
 *
 * Both are views of this one page rather than separate routes: the chooser is
 * the landing screen and picking one swaps the body, so there is nowhere to get
 * lost and the sidebar tab stays highlighted throughout.
 */
@Component({
  selector: 'app-admin-quotations',
  templateUrl: './quotations.page.html',
  styleUrls: ['./quotations.page.scss'],
  standalone: true,
  imports: [CommonModule, IonContent]
})
export class QuotationsPage implements OnInit {
  view: 'menu' | 'requests' | 'compare' = 'menu';

  /** Full-size preview of a customer's uploaded quote. */
  previewImage: string | null = null;
  previewTitle = '';

  /** The picked lines of a requested quotation, opened in the same overlay. */
  previewItems: QuotationItem[] | null = null;

  constructor(
    private quotationService: QuotationService,
    private productService: ProductService
  ) {}

  ngOnInit() {
    this.quotationService.start();
  }

  // Live feed from Firestore, newest first.
  get quotations(): CustomerQuotation[] {
    return this.quotationService.quotations;
  }

  /** Lists built in the catalogue and sent over to be priced. */
  get requests(): CustomerQuotation[] {
    return this.quotations.filter(q => q.items && q.items.length);
  }

  /** Quotes from elsewhere, uploaded to be beaten. */
  get uploads(): CustomerQuotation[] {
    return this.quotations.filter(q => !!q.image);
  }

  /** How many pieces a request adds up to. Quantities only — never money. */
  totalPieces(q: CustomerQuotation): number {
    return (q.items || []).reduce((sum, item) => sum + (item.quantity || 0), 0);
  }

  /** One-line summary of a request, trimmed so a 30-line list fits in a cell. */
  itemsSummary(q: CustomerQuotation): string {
    const items = q.items || [];
    const head = items.slice(0, 3).map(i => `${i.name} ×${i.quantity}`).join(', ');
    return items.length > 3 ? `${head} +${items.length - 3} more` : head;
  }

  /**
   * The product picture for a requested line.
   *
   * The catalogue only sends a path, and only when it is small enough to carry,
   * so the live catalogue is asked first: it always holds the current image,
   * including the inline ones too large to have travelled on the request. What
   * the customer sent is the fallback, for a product since removed.
   */
  itemImage(item: QuotationItem): string {
    if (!item) return '';
    const product = item.sku
      ? this.productService.products.find(p => p.id === item.sku)
      : undefined;
    return product?.image || item.image || '';
  }

  /** The first few pictures on a request, for the thumbnail strip in the row. */
  itemThumbs(q: CustomerQuotation): string[] {
    return (q.items || [])
      .slice(0, 4)
      .map(item => this.itemImage(item))
      .filter(Boolean);
  }

  /** Hide a thumbnail whose file has gone missing rather than show a torn icon. */
  onThumbError(event: Event) {
    const target = event.target as HTMLElement | null;
    if (target) target.style.display = 'none';
  }

  trackById(_index: number, q: CustomerQuotation): string {
    return q.id;
  }

  trackByItemIndex(index: number): number {
    return index;
  }

  // ---- Navigation between the two jobs ----

  openRequests() { this.view = 'requests'; }
  openCompare() { this.view = 'compare'; }
  backToMenu() { this.view = 'menu'; }

  get heading(): string {
    if (this.view === 'requests') return 'Requested Quotations';
    if (this.view === 'compare') return 'Compare Quotation';
    return 'Quotations';
  }

  get subheading(): string {
    if (this.view === 'requests') return 'Lists customers built in the catalogue and asked to be priced.';
    if (this.view === 'compare') return 'Quotes customers uploaded from the catalogue link.';
    return 'Everything to do with customer quotations, in one place.';
  }

  /** The count shown beside the title — whichever list is on screen. */
  get visibleCount(): number {
    return this.view === 'requests' ? this.requests.length : this.uploads.length;
  }

  // ---- Preview ----

  openPreview(q: CustomerQuotation) {
    // A request has no picture; its lines go into the same overlay so both
    // kinds open the same way.
    this.previewImage = q.image || null;
    this.previewItems = q.items && q.items.length ? q.items : null;
    this.previewTitle = `${q.name} · ${this.formatMobile(q.mobile)}`;
  }

  closePreview() {
    this.previewImage = null;
    this.previewItems = null;
    this.previewTitle = '';
  }

  removeQuotation(q: CustomerQuotation, event: Event) {
    event.stopPropagation();
    if (!confirm(`Delete the quotation from ${q.name}? This cannot be undone.`)) return;
    this.quotationService.remove(q.id);
  }

  // ---- Reaching the customer ----

  formatMobile(mobile: string): string {
    const digits = (mobile || '').replace(/\D/g, '');
    return digits.length === 10 ? `${digits.slice(0, 5)} ${digits.slice(5)}` : digits;
  }

  callHref(mobile: string): string {
    return 'tel:+91' + (mobile || '').replace(/\D/g, '').slice(-10);
  }

  // WhatsApp is where these conversations actually happen, so "send" opens the
  // thread with the customer, greeting written. The quote itself is attached in
  // WhatsApp — a wa.me link cannot carry a file.
  //
  // A customer who built a list gets it read back to them, so the reply names
  // what they asked about instead of opening on a bare greeting.
  whatsappHref(q: CustomerQuotation): string {
    const digits = (q.mobile || '').replace(/\D/g, '').slice(-10);
    const items = q.items || [];

    const message = items.length
      ? `Hello ${q.name}, thank you for your quotation request to Glaron India.\n\n` +
        items.map(i => `• ${i.name}${i.variant ? ' (' + i.variant + ')' : ''} × ${i.quantity}`).join('\n') +
        `\n\nHere is our best price for this list.`
      : `Hello ${q.name}, thank you for sharing your quotation with Glaron India. ` +
        `Here is our best offer for the same requirement.`;

    return `https://wa.me/91${digits}?text=${encodeURIComponent(message)}`;
  }

  // A short human-readable "time ago" label.
  timeAgo(ts: number): string {
    const diff = Date.now() - (ts || 0);
    if (diff < 60_000) return 'just now';
    const mins = Math.floor(diff / 60_000);
    if (mins < 60) return mins + (mins === 1 ? ' min ago' : ' mins ago');
    const hours = Math.floor(mins / 60);
    if (hours < 24) return hours + (hours === 1 ? ' hour ago' : ' hours ago');
    const days = Math.floor(hours / 24);
    return days + (days === 1 ? ' day ago' : ' days ago');
  }
}
