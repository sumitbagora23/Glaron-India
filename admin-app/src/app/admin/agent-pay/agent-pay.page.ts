import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { IonContent } from '@ionic/angular/standalone';
import { AgentService, Agent } from '../agent.service';
import { AgentCommissionService, CommissionPayment } from '../agent-commission.service';

/**
 * Pay an agent's commission.
 *
 * The balance is always `earned − paid`, so a payout is recorded as its own
 * entry rather than by marking commission rows settled: one payment rarely
 * lines up with one month's business, and the agent is owed a running balance.
 * Paying more than is outstanding is refused — an overpayment here would read
 * as a negative balance in the agent's app, which means nothing to them.
 */
@Component({
  selector: 'app-agent-pay',
  templateUrl: './agent-pay.page.html',
  styleUrls: ['./agent-pay.page.scss'],
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    IonContent
  ]
})
export class AgentPayPage implements OnInit {
  agentId = '';

  form = {
    date: this.today(),
    amount: null as number | null,
    note: ''
  };

  error = '';
  saving = false;
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

  private today(): string {
    const d = new Date();
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  }

  get agent(): Agent | undefined {
    return this.agentService.findById(this.agentId);
  }

  get agentName(): string {
    return this.agent?.name || 'Agent';
  }

  // ---- Balance ----

  get totalEarned(): number {
    return this.commissions.totalCommission(this.agentId);
  }

  get totalPaid(): number {
    return this.commissions.totalPaid(this.agentId);
  }

  get remaining(): number {
    return this.commissions.remaining(this.agentId);
  }

  // What the balance becomes once the amount currently typed is paid. Shown
  // live under the field so the admin sees the effect before saving.
  get remainingAfter(): number {
    const amount = this.num(this.form.amount);
    return Math.round((this.remaining - amount) * 100) / 100;
  }

  get payments(): CommissionPayment[] {
    return this.commissions.paymentsFor(this.agentId);
  }

  trackByPaymentId(_index: number, payment: CommissionPayment): string {
    return payment.id;
  }

  private num(value: number | null): number {
    const n = Number(value);
    return isFinite(n) && n > 0 ? n : 0;
  }

  // ---- Actions ----

  payFullRemaining() {
    if (this.remaining <= 0) return;
    this.form.amount = this.remaining;
    this.error = '';
  }

  async savePayment() {
    if (this.saving) return;
    this.error = '';
    this.savedMessage = '';

    const agent = this.agent;
    if (!agent || !agent.id) {
      this.error = 'This agent no longer exists.';
      return;
    }
    if (!this.form.date) {
      this.error = 'Pick the date this payment was made.';
      return;
    }
    const amount = this.num(this.form.amount);
    if (!amount) {
      this.error = 'Enter the amount you are paying.';
      return;
    }
    if (this.remaining <= 0) {
      this.error = 'There is nothing outstanding — everything earned has already been paid.';
      return;
    }
    if (amount > this.remaining) {
      this.error = `That is more than the ₹${this.remaining} outstanding. Enter ₹${this.remaining} or less.`;
      return;
    }

    this.saving = true;
    try {
      await this.commissions.addPayment({
        agentId: agent.id,
        agentMobile: agent.phone,
        date: this.form.date,
        amount,
        note: this.form.note
      });

      this.form = { date: this.today(), amount: null, note: '' };
      this.savedMessage = `Payment recorded. ₹${this.remaining} remaining.`;
      setTimeout(() => { this.savedMessage = ''; }, 4000);
    } catch (e) {
      console.error('Add payment error:', e);
      this.error = 'Could not save the payment. Please check your connection and try again.';
    } finally {
      this.saving = false;
    }
  }

  deletePayment(payment: CommissionPayment) {
    if (!confirm(`Delete the ₹${payment.amount} payment dated ${payment.date}? It will go back onto the agent's outstanding balance.`)) return;
    this.commissions.deletePayment(payment.id);
  }

  openCommission() {
    this.router.navigate(['/admin/agents/commission', this.agentId]);
  }

  goBack() {
    this.router.navigate(['/admin/agents']);
  }
}
