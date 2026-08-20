import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { IonContent } from '@ionic/angular/standalone';
import { AgentService, Agent } from '../agent.service';
import { AgentCommissionService, LedgerRow } from '../agent-commission.service';

/**
 * One agent's account, as a single running statement.
 *
 * Commission earned and money paid out used to be two tables on two screens,
 * each carrying half the story and each attached to a form for adding more of
 * its own kind. Neither could answer "what happened in October", because the
 * answer was split between them — and the two screens each had to explain the
 * other to make sense.
 *
 * So the history came off both forms and became this: every line of the
 * account, newest first, with a balance beside each one. The forms are forms
 * now; this is the record.
 *
 * Adding to the account happens here too, in a dialog over the statement rather
 * than on a page of its own. Recording commission or a payout is one short form
 * whose whole point is what it does to the balance behind it — sending the
 * admin to another screen to fill it in took the balance off-screen at exactly
 * the moment it mattered, and landed them somewhere they then had to navigate
 * back from. The dialog closes onto the line it just wrote.
 *
 * Payouts have no edit: a payment is a fact about money that moved, and
 * correcting one means deleting it and recording what actually happened.
 * Commission entries do, and editing reuses the same dialog that adds them, so
 * there is exactly one place an entry is ever written.
 *
 * Custom Rate stays a page. It is a whole pricing sheet — a catalogue-wide
 * discount plus a price per product — and nothing about it fits in a dialog.
 */
@Component({
  selector: 'app-agent-ledger',
  templateUrl: './agent-ledger.page.html',
  styleUrls: ['./agent-ledger.page.scss'],
  standalone: true,
  imports: [CommonModule, FormsModule, IonContent]
})
export class AgentLedgerPage implements OnInit {
  agentId = '';

  // ---- Commission dialog ----
  showCommission = false;
  /** Set while an existing entry is being corrected rather than a new one added. */
  editingId: string | null = null;
  cForm = this.blankCommission();
  cError = '';
  cSaving = false;

  // ---- Payment dialog ----
  showPay = false;
  pForm = this.blankPayment();
  pError = '';
  pSaving = false;

  /** Shown briefly on the statement after either dialog writes a line. */
  savedMessage = '';

  constructor(
    private route: ActivatedRoute,
    private router: Router,
    private agentService: AgentService,
    private commissions: AgentCommissionService
  ) {}

  ngOnInit() {
    this.agentId = this.route.snapshot.paramMap.get('id') || '';
  }

  get agent(): Agent | undefined {
    return this.agentService.findById(this.agentId);
  }

  get agentName(): string {
    return this.agent?.name || 'Agent';
  }

  // ---- The account ----

  get rows(): LedgerRow[] {
    return this.commissions.ledgerFor(this.agentId);
  }

  get totalSales(): number {
    return this.commissions.totalSales(this.agentId);
  }

  get totalEarned(): number {
    return this.commissions.totalCommission(this.agentId);
  }

  get totalPaid(): number {
    return this.commissions.totalPaid(this.agentId);
  }

  get remaining(): number {
    return this.commissions.remaining(this.agentId);
  }

  trackByRowId(_index: number, row: LedgerRow): string {
    return row.kind + ':' + row.id;
  }

  /**
   * The one-line description of what a row is.
   *
   * A commission line is named by the client it was earned on, because that is
   * what the admin recognises it by; a payout has no client, so it is named by
   * the money. The note, where there is one, is shown under it either way.
   */
  title(row: LedgerRow): string {
    if (row.kind === 'commission') {
      return row.entry?.clientName?.trim() || 'Commission earned';
    }
    return 'Payment made';
  }

  detail(row: LedgerRow): string {
    if (row.kind !== 'commission' || !row.entry) return '';
    const entry = row.entry;
    if (!entry.salesAmount) return '';
    return `₹${entry.salesAmount.toLocaleString('en-IN')} sales · ${entry.percentage}%`;
  }

  note(row: LedgerRow): string {
    return (row.kind === 'commission' ? row.entry?.note : row.payment?.note) || '';
  }

  // ---- The commission dialog ----

  private today(): string {
    const d = new Date();
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  }

  private blankCommission() {
    return {
      date: this.today(),
      clientName: '',
      salesAmount: null as number | null,
      percentage: null as number | null,
      commissionAmount: null as number | null,
      note: ''
    };
  }

  private blankPayment() {
    return { date: this.today(), amount: null as number | null, note: '' };
  }

  private num(value: number | null): number {
    const n = Number(value);
    return isFinite(n) && n > 0 ? n : 0;
  }

  addCommission() {
    this.editingId = null;
    this.cForm = this.blankCommission();
    this.cError = '';
    this.showCommission = true;
  }

  /** The same dialog, opened on an existing line. */
  editEntry(row: LedgerRow) {
    if (row.kind !== 'commission' || !row.entry) return;
    const entry = row.entry;
    this.editingId = entry.id;
    this.cForm = {
      date: entry.date,
      clientName: entry.clientName || '',
      salesAmount: entry.salesAmount || null,
      percentage: entry.percentage || null,
      commissionAmount: entry.commissionAmount || null,
      note: entry.note || ''
    };
    this.cError = '';
    this.showCommission = true;
  }

  closeCommission() {
    this.showCommission = false;
    this.editingId = null;
    this.cError = '';
  }

  // Rate and money stay in step: whichever the admin types, the other follows
  // from the sales amount. Both are stored — see AgentCommissionService.
  onSalesInput() {
    const sales = this.num(this.cForm.salesAmount);
    if (!sales) return;
    if (this.num(this.cForm.percentage)) {
      this.cForm.commissionAmount = AgentCommissionService.commissionFrom(sales, this.num(this.cForm.percentage));
    } else if (this.num(this.cForm.commissionAmount)) {
      this.cForm.percentage = AgentCommissionService.percentageFrom(sales, this.num(this.cForm.commissionAmount));
    }
  }

  onPercentInput() {
    const sales = this.num(this.cForm.salesAmount);
    const pct = this.num(this.cForm.percentage);
    if (!sales || !pct) return;
    this.cForm.commissionAmount = AgentCommissionService.commissionFrom(sales, pct);
  }

  onCommissionInput() {
    const sales = this.num(this.cForm.salesAmount);
    const amount = this.num(this.cForm.commissionAmount);
    if (!sales || !amount) return;
    this.cForm.percentage = AgentCommissionService.percentageFrom(sales, amount);
  }

  async saveCommission() {
    if (this.cSaving) return;
    this.cError = '';

    const agent = this.agent;
    if (!agent || !agent.id) {
      this.cError = 'This agent no longer exists.';
      return;
    }
    if (!this.cForm.date) {
      this.cError = 'Pick the date this business belongs to.';
      return;
    }
    const sales = this.num(this.cForm.salesAmount);
    if (!sales) {
      this.cError = 'Enter the sales amount this commission is calculated on.';
      return;
    }
    const pct = this.num(this.cForm.percentage);
    const amount = this.num(this.cForm.commissionAmount);
    if (!pct && !amount) {
      this.cError = 'Enter either a commission percentage or a commission amount — the other is filled in for you.';
      return;
    }

    const payload = {
      date: this.cForm.date,
      clientName: this.cForm.clientName,
      salesAmount: sales,
      percentage: pct || AgentCommissionService.percentageFrom(sales, amount),
      commissionAmount: amount || AgentCommissionService.commissionFrom(sales, pct),
      note: this.cForm.note
    };

    this.cSaving = true;
    try {
      if (this.editingId) {
        await this.commissions.updateEntry(this.editingId, payload);
        this.flash('Entry updated — the agent sees the new figures straight away.');
      } else {
        await this.commissions.addEntry({ agentId: agent.id, agentMobile: agent.phone, ...payload });
        this.flash('Commission added — the agent can see it in their app now.');
      }
      this.closeCommission();
    } catch (e) {
      console.error('Save commission error:', e);
      this.cError = 'Could not save the entry. Please check your connection and try again.';
    } finally {
      this.cSaving = false;
    }
  }

  // ---- The payment dialog ----

  recordPayment() {
    if (this.remaining <= 0) return;
    this.pForm = this.blankPayment();
    this.pError = '';
    this.showPay = true;
  }

  closePay() {
    this.showPay = false;
    this.pError = '';
  }

  payFullRemaining() {
    if (this.remaining <= 0) return;
    this.pForm.amount = this.remaining;
    this.pError = '';
  }

  /** What the balance becomes once the amount typed is paid, shown live. */
  get remainingAfter(): number {
    return Math.round((this.remaining - this.num(this.pForm.amount)) * 100) / 100;
  }

  async savePayment() {
    if (this.pSaving) return;
    this.pError = '';

    const agent = this.agent;
    if (!agent || !agent.id) {
      this.pError = 'This agent no longer exists.';
      return;
    }
    if (!this.pForm.date) {
      this.pError = 'Pick the date this payment was made.';
      return;
    }
    const amount = this.num(this.pForm.amount);
    if (!amount) {
      this.pError = 'Enter the amount you are paying.';
      return;
    }
    if (this.remaining <= 0) {
      this.pError = 'There is nothing outstanding — everything earned has already been paid.';
      return;
    }
    // Overpaying would read as a negative balance in the agent's own app, which
    // means nothing to them.
    if (amount > this.remaining) {
      this.pError = `That is more than the ₹${this.remaining} outstanding. Enter ₹${this.remaining} or less.`;
      return;
    }

    this.pSaving = true;
    try {
      await this.commissions.addPayment({
        agentId: agent.id,
        agentMobile: agent.phone,
        date: this.pForm.date,
        amount,
        note: this.pForm.note
      });
      this.closePay();
      this.flash(`Payment recorded. ₹${this.remaining} remaining.`);
    } catch (e) {
      console.error('Add payment error:', e);
      this.pError = 'Could not save the payment. Please check your connection and try again.';
    } finally {
      this.pSaving = false;
    }
  }

  private flash(message: string) {
    this.savedMessage = message;
    setTimeout(() => { this.savedMessage = ''; }, 4000);
  }

  // ---- Deleting a line ----

  deleteRow(row: LedgerRow) {
    if (row.kind === 'commission') {
      const entry = row.entry;
      if (!entry) return;
      if (!confirm(`Delete the ₹${entry.commissionAmount} commission entry dated ${entry.date}? ${this.agentName} will stop seeing it, and the balance drops by that much.`)) return;
      this.commissions.deleteEntry(entry.id);
      return;
    }

    const payment = row.payment;
    if (!payment) return;
    if (!confirm(`Delete the ₹${payment.amount} payment dated ${payment.date}? It goes back onto ${this.agentName}'s outstanding balance.`)) return;
    this.commissions.deletePayment(payment.id);
  }

  /**
   * The rate this agent sees on the catalogue. A page, not a dialog: it is a
   * whole pricing sheet, and nothing about it is short.
   */
  openPricing() {
    this.router.navigate(['/admin/agents/pricing', this.agentId]);
  }

  goBack() {
    this.router.navigate(['/admin/agents']);
  }
}
