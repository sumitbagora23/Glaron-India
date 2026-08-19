import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, Router } from '@angular/router';
import { IonContent } from '@ionic/angular/standalone';
import { QuotationService, CustomerQuotation } from '../quotation.service';

/**
 * Quotations — two sidebar tabs sharing one page.
 *
 *   • Request Quotation — lists customers built themselves in the public
 *     catalogue and asked to be priced. That page shows no prices at all, so
 *     this is how a customer asks what something costs.
 *   • Compare Quotation — quotes customers have uploaded from the same link,
 *     with the name and mobile they left, so the admin can price against them.
 *
 * Each is its own route and its own sidebar entry, so either is one click from
 * anywhere. Which list the page shows comes from the route's `view` data, and
 * the component is otherwise the same for both.
 */
@Component({
  selector: 'app-admin-quotations',
  templateUrl: './quotations.page.html',
  styleUrls: ['./quotations.page.scss'],
  standalone: true,
  imports: [CommonModule, IonContent]
})
export class QuotationsPage implements OnInit {
  view: 'requests' | 'areas' | 'compare' = 'requests';

  constructor(
    private quotationService: QuotationService,
    private route: ActivatedRoute,
    private router: Router
  ) {}

  ngOnInit() {
    this.quotationService.start();
    // Which of the two lists this tab is. Set from the route so the sidebar
    // entry, the URL and the heading can never disagree.
    this.route.data.subscribe(data => {
      const view = data['view'];
      this.view = view === 'compare' ? 'compare' : view === 'areas' ? 'areas' : 'requests';
    });
  }

  // Live feed from Firestore, newest first.
  get quotations(): CustomerQuotation[] {
    return this.quotationService.quotations;
  }

  /**
   * Every list a customer sent to be priced, however it arrived.
   *
   * The area-wise link splits a job by room and the plain link does not, but
   * they are the same request and they are priced on the same page, so they
   * are not worth two lists in the sidebar.
   */
  get requests(): CustomerQuotation[] {
    return this.quotations.filter(q =>
      (q.items && q.items.length) || (q.areas && q.areas.length));
  }

  /** Quotes from elsewhere, uploaded to be beaten. */
  get uploads(): CustomerQuotation[] {
    return this.quotations.filter(q => !!q.image);
  }

  /** Jobs sent in from the area-wise link, already split by room. */
  get areaRequests(): CustomerQuotation[] {
    return this.quotations.filter(q => q.areas && q.areas.length);
  }

  /** Every piece on a request that arrived as one list. */
  itemPieces(q: CustomerQuotation): number {
    return (q.items || []).reduce((n, item) => n + (item.quantity || 0), 0);
  }

  /** How many areas a request carries, for the row. */
  areaCount(q: CustomerQuotation): number {
    return q.areas?.length || 0;
  }

  /** Every piece across every area of that request. */
  areaPieces(q: CustomerQuotation): number {
    return (q.areas || []).reduce(
      (sum, area) => sum + (area.items || []).reduce((n, item) => n + (item.quantity || 0), 0), 0
    );
  }

  /** The first few area names, so a row says what the job is at a glance. */
  areaNames(q: CustomerQuotation): string {
    const names = (q.areas || []).map(a => a.name).filter(Boolean);
    if (names.length <= 3) return names.join(', ');
    return names.slice(0, 3).join(', ') + ` +${names.length - 3} more`;
  }

  /** Open an area-wise request, where it gets priced area by area. */
  openAreaQuotation(q: CustomerQuotation) {
    this.router.navigate(['/admin/quotations/areas', q.id]);
  }

  /**
   * Open a request in full, where it gets priced.
   *
   * The lines used to open in an overlay here, which could only be read. The
   * page they open on now is where the quotation is actually made: MRP on every
   * line, more products added, a discount, and the PDF that goes back.
   */
  openQuotation(q: CustomerQuotation) {
    this.router.navigate(['/admin/quotations/areas', q.id]);
  }

  // ---- The link to an uploaded quotation ----

  /**
   * A link to the uploaded file that works outside this console.
   *
   * The file itself is stored inline on the document as a data URL, which no
   * browser will navigate to and nothing can be pasted anywhere. The hosting
   * rewrite `/quotation-image/<id>` hands the same bytes back as a real
   * response — a picture or a PDF, whichever was sent — so that URL can be
   * opened, pasted or forwarded, and the browser's own viewer shows it. A
   * quotation already held at a real URL is simply that URL.
   */
  imageLink(q: CustomerQuotation): string {
    const src = (q?.image || '').trim();
    if (!src) return '';
    if (/^https?:\/\//i.test(src)) return src;
    // The extension is what makes this work inside the installed app: a service
    // worker answers a link with no extension out of its own cache, which meant
    // tapping View showed the console again rather than the quotation.
    return `${window.location.origin}/quotation-image/${q.id}.${this.fileExt(src)}`;
  }

  /** The extension for what was uploaded. The response's own type still rules. */
  private fileExt(src: string): string {
    const mime = (/^data:([^;,]+)/.exec(src)?.[1] || '').toLowerCase();
    if (mime === 'application/pdf') return 'pdf';
    if (mime === 'image/png') return 'png';
    if (mime === 'image/webp') return 'webp';
    return 'jpg';
  }

  /**
   * Whether the customer sent a PDF rather than a picture.
   *
   * Only decides what the row shows in place of a thumbnail — a PDF has no
   * frame to draw, and an <img> pointed at one leaves a torn icon. The link
   * itself is the same either way.
   */
  isPdf(q: CustomerQuotation): boolean {
    const src = (q?.image || '').trim().toLowerCase();
    return src.startsWith('data:application/pdf') || /\.pdf(\?|#|$)/.test(src);
  }

  trackById(_index: number, q: CustomerQuotation): string {
    return q.id;
  }

  // ---- The two jobs ----

  get heading(): string {
    if (this.view === 'compare') return 'Compare Quotation';
    return 'Request Quotation';
  }

  get subheading(): string {
    if (this.view === 'compare') return 'Quotes customers uploaded from the catalogue link.';
    return 'Lists customers built in the catalogue and asked to be priced.';
  }

  /** The count shown beside the title — whichever list is on screen. */
  get visibleCount(): number {
    if (this.view === 'compare') return this.uploads.length;
    return this.requests.length;
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
