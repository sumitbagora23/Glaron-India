import { Component, OnInit, effect, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { IonContent } from '@ionic/angular/standalone';
import { QuotationService, CustomerQuotation } from '../quotation.service';
import { QuotationDraftService, QuoteLine } from '../quotations/quotation-draft.service';
import { orderRefDigits } from '../order-ref';
import { createQuotationPdf, quotationFileName, inr } from '../quotations/quotation-pdf';
import { lightColourSwatch, splitLightColourLabel } from '../light-colours';
import { LightColourService } from '../light-colour.service';

/**
 * A requested quotation, opened in full.
 *
 * What arrives from the public catalogue is only half a quotation: the customer
 * picked products and quantities, and that page shows no prices at all. This is
 * where it becomes one — every line carries its MRP, a discount goes across the
 * lot, and the result leaves as a PDF on Glaron letterhead. Adding products has
 * its own page, the same way adding products to an order does.
 *
 * The working list lives in QuotationDraftService so the trip to that page and
 * back loses nothing.
 */
@Component({
  selector: 'app-quotation-detail',
  templateUrl: './quotation-detail.page.html',
  styleUrls: ['./quotation-detail.page.scss'],
  standalone: true,
  imports: [CommonModule, FormsModule, IonContent]
})
export class QuotationDetailPage implements OnInit {

  // The box of colour drawn before a light colour name. Worked out from the
  // name itself, so a shade added today is painted without a code change.
  swatch(colour: string): string {
    return lightColourSwatch(colour);
  }

  // A saved line keeps what was ordered as one string — "7W · 2ft · Cool
  // White". These two split the shade off its end so the box of colour sits
  // right before the shade, not in front of the wattage.
  private lightColourNames = inject(LightColourService);

  labelHead(label?: string): string {
    return splitLightColourLabel(label || '', this.lightColourNames.names).head;
  }

  labelColour(label?: string): string {
    return splitLightColourLabel(label || '', this.lightColourNames.names).colour;
  }

  id = '';

  building = false;
  error = '';

  /**
   * Whether the MRP column is open for editing.
   *
   * Off by default: the price comes from the catalogue and is normally right,
   * and an input box on every row invites a stray keystroke into a document
   * that goes to a customer. Edit Price opens them all when a particular
   * product does need its own figure.
   */
  editPrices = false;

  /** What the last Apply did, shown beside the button until the next change. */
  applied = '';

  /** The last file built, so its URL can be released when the next one is. */
  private pdfUrl: string | null = null;

  constructor(
    private route: ActivatedRoute,
    private router: Router,
    private quotationService: QuotationService,
    public draft: QuotationDraftService
  ) {
    // Read before the effect below, which needs it on its very first run.
    this.id = this.route.snapshot.paramMap.get('id') || '';
    this.draft.use(this.id);

    // The feed arrives after the page does, so the list is seeded the moment
    // the request itself shows up — and only ever once, or an edit would be
    // wiped by the next snapshot.
    effect(() => {
      const q = this.quotationService.quotations.find(item => item.id === this.id);
      if (q && !this.draft.isSeeded) this.draft.seedFrom(q.items);
    });
  }

  ngOnInit() {
    this.quotationService.start();
  }

  // ---- The request behind it ----

  get quotation(): CustomerQuotation | undefined {
    return this.quotationService.quotations.find(q => q.id === this.id);
  }

  get lines(): QuoteLine[] {
    return this.draft.lines;
  }

  /** Short label, the same shape orders use: `QTN - 417`. */
  get quoteRef(): string {
    return `QTN - ${orderRefDigits(this.id)}`;
  }

  get customerName(): string {
    return this.quotation?.name || 'Customer';
  }

  get customerMobile(): string {
    const digits = (this.quotation?.mobile || '').replace(/\D/g, '');
    return digits.length === 10 ? `${digits.slice(0, 5)} ${digits.slice(5)}` : digits;
  }

  callHref(): string {
    return 'tel:+91' + (this.quotation?.mobile || '').replace(/\D/g, '').slice(-10);
  }

  /** Waiting only means the feed has not reached us — not that it is missing. */
  get loading(): boolean {
    return !this.quotation && !this.draft.isSeeded;
  }

  // ---- Editing the list ----

  inc(line: QuoteLine) {
    line.quantity += 1;
  }

  dec(line: QuoteLine) {
    if (line.quantity > 1) line.quantity -= 1;
  }

  onQtyInput(line: QuoteLine, value: string) {
    const n = Math.floor(Number(value));
    line.quantity = n > 0 ? n : 1;
  }

  /**
   * The quoted price for one product, set by hand. The MRP beside it stands.
   *
   * Held in whole rupees, like every other price here: the columns are shown
   * rounded, so a stored 607.5 would print as 608 while the amount was worked
   * out on 607.5 and the row would not add up.
   */
  onPriceInput(line: QuoteLine, value: string) {
    const n = Math.round(Number(value));
    line.price = n > 0 ? n : 0;
  }

  removeLine(line: QuoteLine) {
    this.draft.removeLine(line);
  }

  toggleEditPrices() {
    this.editPrices = !this.editPrices;
    this.applied = '';
  }

  /**
   * One Apply for both ways of pricing.
   *
   * With a percentage typed in, it takes that off every product's MRP. With the
   * price column open instead, the figures typed there are already on the
   * lines, so this closes the column and confirms them. Either way the MRP is
   * untouched.
   */
  apply() {
    if (this.draft.discountPercent > 0) {
      this.draft.applyDiscount();
      this.applied = `${this.draft.discountPercent}% applied to every product`;
    } else if (this.editPrices) {
      this.applied = 'Prices updated';
    } else {
      this.draft.applyDiscount();
      this.applied = 'Prices reset to MRP';
    }
    this.editPrices = false;
  }

  onImgError(event: Event) {
    const target = event.target as HTMLElement | null;
    if (target) target.style.display = 'none';
  }

  trackByKey(_index: number, line: QuoteLine): string {
    return line.key;
  }

  /** Rupees, grouped the Indian way — the same helper the PDF prints with. */
  money(value: number): string {
    return inr(value);
  }

  get canBuild(): boolean {
    return this.draft.lines.length > 0 && !this.building;
  }

  // ---- Going to add products ----

  addProducts() {
    this.router.navigate(['/admin/quotations/requests', this.id, 'add']);
  }

  // ---- The document ----

  /**
   * Build the PDF, open it, and leave a copy saved.
   *
   * The tab is claimed here, before anything is awaited: a browser only allows
   * window.open while it is still handling the click, so opening it after the
   * document is drawn is what gets blocked. It is filled in once the file
   * exists — which is why the quotation appears rather than a stray blank tab.
   */
  async createPdf() {
    if (!this.canBuild) return;
    this.building = true;
    this.error = '';

    const tab = window.open('', '_blank');

    try {
      const blob = await createQuotationPdf({
        // So the shade at the end of a line is drawn with its box of colour.
        lightColourNames: this.lightColourNames.names,
        quoteNo: this.quoteRef.replace(/\s/g, ''),
        dateLabel: new Date().toLocaleDateString('en-IN', {
          day: '2-digit', month: 'short', year: 'numeric'
        }),
        customerName: this.customerName,
        customerMobile: (this.quotation?.mobile || '').replace(/\D/g, ''),
        discountPercent: this.draft.discountPercent,
        lines: this.draft.lines.map(l => ({
          name: l.name,
          variant: l.variant,
          sku: l.sku,
          mrp: l.mrp,
          rate: this.draft.netPrice(l),
          quantity: l.quantity
        })),
        subtotal: this.draft.subtotal,
        discountLabel: this.draft.discountLabel,
        discount: this.draft.discount,
        total: this.draft.total
      });

      // The previous one is no longer the current quotation.
      if (this.pdfUrl) URL.revokeObjectURL(this.pdfUrl);
      this.pdfUrl = URL.createObjectURL(blob);

      // Saved as a file to forward, and shown in the tab claimed above.
      const a = document.createElement('a');
      a.href = this.pdfUrl;
      a.download = quotationFileName(this.quoteRef.replace(/\s/g, ''), this.customerName);
      a.click();

      if (tab) tab.location.href = this.pdfUrl;
      else window.open(this.pdfUrl, '_blank', 'noopener');
    } catch (err) {
      console.warn('Quotation PDF notice:', (err as any)?.message || err);
      this.error = 'The PDF could not be built. Please try again.';
      tab?.close();
    } finally {
      this.building = false;
    }
  }

  back() {
    this.router.navigate(['/admin/quotations/requests']);
  }
}
