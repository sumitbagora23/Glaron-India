import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { IonContent } from '@ionic/angular/standalone';
import { SearchService } from '../search.service';
import { AgentService, Agent, AgentStatus } from '../agent.service';
import { AgentAuthService } from '../agent-auth.service';
import { AgentCommissionService } from '../agent-commission.service';

@Component({
  selector: 'app-agents',
  templateUrl: './agents.page.html',
  styleUrls: ['./agents.page.scss'],
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    IonContent
  ]
})
export class AgentsPage {
  statusFilter: 'All' | AgentStatus = 'All';
  statusOptions: AgentStatus[] = ['Active', 'Inactive'];

  // ---- Add-agent form (modal) ----
  // Agents never sign themselves up: the admin types a number and a password
  // here and hands both over. A real form rather than a chain of prompt()
  // dialogs, because a mistyped password is only discovered by the agent.
  showAddModal = false;
  addForm = { name: '', mobile: '', password: '', confirmPassword: '' };
  addError = '';
  addSaving = false;

  constructor(
    private router: Router,
    private searchService: SearchService,
    private agentService: AgentService,
    private agentAuth: AgentAuthService,
    private commissions: AgentCommissionService
  ) {}

  get agents(): Agent[] {
    return this.agentService.agents;
  }

  statusOf(agent: Agent): AgentStatus {
    return agent.status === 'Active' ? 'Active' : 'Inactive';
  }

  trackByAgentId(_index: number, agent: Agent): string {
    return agent.id || agent.phone || '';
  }

  get filteredAgents(): Agent[] {
    let list = this.agents;

    if (this.statusFilter !== 'All') {
      list = list.filter(a => this.statusOf(a) === this.statusFilter);
    }

    const searchVal = this.searchService.searchKeyword();
    if (searchVal.trim()) {
      const keyword = searchVal.toLowerCase().trim();
      list = list.filter(a =>
        (a.name || '').toLowerCase().includes(keyword) ||
        (a.phone || '').toLowerCase().includes(keyword) ||
        (a.email || '').toLowerCase().includes(keyword) ||
        (a.location || '').toLowerCase().includes(keyword)
      );
    }

    return list;
  }

  // ---- Per-agent commission roll-ups (shown in the list) ----

  totalSales(agent: Agent): number {
    return this.commissions.totalSales(agent.id || '');
  }

  totalCommission(agent: Agent): number {
    return this.commissions.totalCommission(agent.id || '');
  }

  // What the agent is still owed — earned less everything paid out.
  remaining(agent: Agent): number {
    return this.commissions.remaining(agent.id || '');
  }

  hasPassword(agent: Agent): boolean {
    return !!agent.passwordHash;
  }

  // ---- Row actions ----

  /**
   * The agent's account: commission and payouts as one statement.
   *
   * Opened by the name, the way a quotation is opened by its customer's. The
   * row is about this agent, so the agent is the way in.
   */
  openLedger(agent: Agent, event?: Event) {
    if (event) event.stopPropagation();
    if (!agent.id) return;
    this.router.navigate(['/admin/agents/ledger', agent.id]);
  }

  /**
   * How many lines an agent's account has — what decides whether they can be
   * deleted, and what the row's tooltip says when they cannot.
   */
  transactionCount(agent: Agent): number {
    return agent.id ? this.commissions.transactionCount(agent.id) : 0;
  }

  deleteBlockedReason(agent: Agent): string {
    const n = this.transactionCount(agent);
    if (!n) return '';
    return `${agent.name} has ${n} transaction${n === 1 ? '' : 's'} on their account. `
         + `Delete those first if this agent really should be removed.`;
  }

  changeStatus(agent: Agent, newStatus: string) {
    if (!agent.id) return;
    const status = newStatus as AgentStatus;
    if (status && status !== this.statusOf(agent)) {
      this.agentService.updateAgentStatus(agent.id, status);
    }
  }

  /**
   * Delete an agent — only one with nothing on their account.
   *
   * This used to delete the commission entries and payouts along with the
   * agent, which quietly destroyed a record of money: what was earned, what was
   * paid, and what was still owed, gone on one confirm. An account with history
   * in it is a record, not a fixture, so the history has to be dealt with
   * deliberately before the agent can go. The button says so rather than
   * failing on the click.
   */
  deleteAgent(agent: Agent, event?: Event) {
    if (event) event.stopPropagation();
    if (!agent.id) return;

    const blocked = this.deleteBlockedReason(agent);
    if (blocked) {
      alert(blocked);
      return;
    }

    if (!confirm(`Delete agent "${agent.name}"? Their account is empty, so nothing is lost — but this cannot be undone.`)) return;
    this.agentService.deleteAgent(agent.id);
  }

  // ---- Add agent ----

  openAddModal() {
    this.addForm = { name: '', mobile: '', password: '', confirmPassword: '' };
    this.addError = '';
    this.addSaving = false;
    this.showAddModal = true;
  }

  closeAddModal() {
    this.showAddModal = false;
  }

  onMobileInput(value: string) {
    this.addForm.mobile = this.agentAuth.normalizeMobile(value);
  }

  async saveAgent() {
    if (this.addSaving) return;
    this.addError = '';

    const mobile = this.agentAuth.normalizeMobile(this.addForm.mobile);
    if (!this.agentAuth.isValidMobile(mobile)) {
      this.addError = 'Enter a valid 10-digit mobile number — this is what the agent signs in with.';
      return;
    }
    if (this.agentService.findByMobile(mobile)) {
      this.addError = 'An agent is already registered with that mobile number.';
      return;
    }
    if (!this.addForm.password || this.addForm.password.length < 6) {
      this.addError = 'Password must be at least 6 characters long.';
      return;
    }
    if (this.addForm.password !== this.addForm.confirmPassword) {
      this.addError = 'The two passwords do not match.';
      return;
    }

    this.addSaving = true;
    try {
      const passwordHash = await this.agentAuth.hashPassword(mobile, this.addForm.password);
      await this.agentService.addAgent({
        name: this.addForm.name,
        phone: mobile,
        passwordHash,
        status: 'Active'
      });
      this.showAddModal = false;
      alert(`Agent created. Share these with them:\n\nMobile: ${mobile}\nPassword: ${this.addForm.password}`);
    } catch (e) {
      console.error('Add agent error:', e);
      this.addError = 'Could not save the agent. Please check your connection and try again.';
    } finally {
      this.addSaving = false;
    }
  }
}
