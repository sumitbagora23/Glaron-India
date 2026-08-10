import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { IonContent } from '@ionic/angular/standalone';
import { AgentService, Agent } from '../agent.service';
import { AgentCommissionService, CommissionEntry } from '../agent-commission.service';

@Component({
  selector: 'app-agent-commission',
  templateUrl: './agent-commission.page.html',
  styleUrls: ['./agent-commission.page.scss'],
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    IonContent
  ]
})
export class AgentCommissionPage implements OnInit {
  agentId = '';

  // The entry being composed. `percentage` and `commissionAmount` stay in step
  // with each other: whichever one the admin types, the other is derived from
  // the sales amount. Storing both is deliberate — see AgentCommissionService.
  form = {
    date: this.today(),
    salesAmount: null as number | null,
    percentage: null as number | null,
    commissionAmount: null as number | null,
    note: ''
  };

  error = '';
  saving = false;
  savedMessage = '';

  // Set while an existing entry is being edited — the composer doubles as the
  // edit form rather than opening a second, near-identical dialog.
  editingId: string | null = null;

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

  // ---- Ledger (shown above the form) ----

  get entries(): CommissionEntry[] {
    return this.commissions.entriesFor(this.agentId);
  }

  get totalSales(): number {
    return this.commissions.totalSales(this.agentId);
  }

  get totalCommission(): number {
    return this.commissions.totalCommission(this.agentId);
  }

  get totalPaid(): number {
    return this.commissions.totalPaid(this.agentId);
  }

  // Earned less paid — the same balance the Pay page settles against.
  get remaining(): number {
    return this.commissions.remaining(this.agentId);
  }

  trackByEntryId(_index: number, entry: CommissionEntry): string {
    return entry.id;
  }

  // ---- Two-way rate/amount derivation ----

  private num(value: number | null): number {
    const n = Number(value);
    return isFinite(n) && n > 0 ? n : 0;
  }

  onSalesInput() {
    const sales = this.num(this.form.salesAmount);
    if (!sales) return;
    // Keep whichever figure the admin already committed to and re-derive the other.
    if (this.num(this.form.percentage)) {
      this.form.commissionAmount = AgentCommissionService.commissionFrom(sales, this.num(this.form.percentage));
    } else if (this.num(this.form.commissionAmount)) {
      this.form.percentage = AgentCommissionService.percentageFrom(sales, this.num(this.form.commissionAmount));
    }
  }

  // Admin typed a rate → the money follows from it.
  onPercentInput() {
    const sales = this.num(this.form.salesAmount);
    const pct = this.num(this.form.percentage);
    if (!sales || !pct) return;
    this.form.commissionAmount = AgentCommissionService.commissionFrom(sales, pct);
  }

  // Admin typed the money → the rate follows from it.
  onCommissionInput() {
    const sales = this.num(this.form.salesAmount);
    const amount = this.num(this.form.commissionAmount);
    if (!sales || !amount) return;
    this.form.percentage = AgentCommissionService.percentageFrom(sales, amount);
  }

  // ---- Edit / save / delete ----

  // Loads a row into the composer. The form is the single place an entry is
  // written, so editing and adding cannot drift apart.
  editEntry(entry: CommissionEntry) {
    this.editingId = entry.id;
    this.form = {
      date: entry.date,
      salesAmount: entry.salesAmount || null,
      percentage: entry.percentage || null,
      commissionAmount: entry.commissionAmount || null,
      note: entry.note || ''
    };
    this.error = '';
    this.savedMessage = '';
    // The composer sits below the ledger — bring it into view.
    setTimeout(() => document.getElementById('commission-composer')?.scrollIntoView({ behavior: 'smooth', block: 'center' }));
  }

  cancelEdit() {
    this.editingId = null;
    this.resetForm();
    this.error = '';
  }

  private resetForm() {
    this.form = {
      date: this.today(),
      salesAmount: null,
      percentage: null,
      commissionAmount: null,
      note: ''
    };
  }

  async saveEntry() {
    if (this.saving) return;
    this.error = '';
    this.savedMessage = '';

    const agent = this.agent;
    if (!agent || !agent.id) {
      this.error = 'This agent no longer exists.';
      return;
    }
    if (!this.form.date) {
      this.error = 'Pick the date this business belongs to.';
      return;
    }
    const sales = this.num(this.form.salesAmount);
    if (!sales) {
      this.error = 'Enter the sales amount this commission is calculated on.';
      return;
    }
    const pct = this.num(this.form.percentage);
    const amount = this.num(this.form.commissionAmount);
    if (!pct && !amount) {
      this.error = 'Enter either a commission percentage or a commission amount — the other is filled in for you.';
      return;
    }

    const payload = {
      date: this.form.date,
      salesAmount: sales,
      percentage: pct || AgentCommissionService.percentageFrom(sales, amount),
      commissionAmount: amount || AgentCommissionService.commissionFrom(sales, pct),
      note: this.form.note
    };

    this.saving = true;
    try {
      if (this.editingId) {
        await this.commissions.updateEntry(this.editingId, payload);
        this.editingId = null;
        this.savedMessage = 'Entry updated — the agent sees the new figures straight away.';
      } else {
        await this.commissions.addEntry({
          agentId: agent.id,
          agentMobile: agent.phone,
          ...payload
        });
        this.savedMessage = 'Commission entry added — the agent can see it in their app now.';
      }

      this.resetForm();
      setTimeout(() => { this.savedMessage = ''; }, 4000);
    } catch (e) {
      console.error('Save commission error:', e);
      this.error = 'Could not save the entry. Please check your connection and try again.';
    } finally {
      this.saving = false;
    }
  }

  deleteEntry(entry: CommissionEntry) {
    if (!confirm(`Delete the ₹${entry.commissionAmount} commission entry dated ${entry.date}?`)) return;
    // Editing the row that is being removed would leave the form pointing at a
    // document that no longer exists.
    if (this.editingId === entry.id) this.cancelEdit();
    this.commissions.deleteEntry(entry.id);
  }

  goBack() {
    this.router.navigate(['/admin/agents']);
  }
}
