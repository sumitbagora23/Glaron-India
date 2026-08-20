import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
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
 * Editing a commission entry from here hands off to the commission form with
 * the entry's id in the query string, which is the only place an entry is ever
 * written. Payouts have no edit: a payment is a fact about money that moved,
 * and correcting one means deleting it and recording what actually happened.
 */
@Component({
  selector: 'app-agent-ledger',
  templateUrl: './agent-ledger.page.html',
  styleUrls: ['./agent-ledger.page.scss'],
  standalone: true,
  imports: [CommonModule, IonContent]
})
export class AgentLedgerPage implements OnInit {
  agentId = '';

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

  // ---- Actions ----

  /**
   * Correct a commission entry on the form that writes them, with this entry
   * loaded into it — rather than growing a second, near-identical form here.
   */
  editEntry(row: LedgerRow) {
    if (row.kind !== 'commission') return;
    this.router.navigate(['/admin/agents/commission', this.agentId], {
      queryParams: { entry: row.id }
    });
  }

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

  addCommission() {
    this.router.navigate(['/admin/agents/commission', this.agentId]);
  }

  recordPayment() {
    this.router.navigate(['/admin/agents/pay', this.agentId]);
  }

  goBack() {
    this.router.navigate(['/admin/agents']);
  }
}
