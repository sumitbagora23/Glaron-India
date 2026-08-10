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

  entryCount(agent: Agent): number {
    return this.commissions.entriesFor(agent.id || '').length;
  }

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

  // Opens the agent's own commission page: everything recorded so far at the
  // top, the "add entry" form under it.
  setCommission(agent: Agent) {
    if (!agent.id) return;
    this.router.navigate(['/admin/agents/commission', agent.id]);
  }

  // Opens the payout page: what is owed, what has been paid, and the form to
  // record another payment against the balance.
  payCommission(agent: Agent, event?: Event) {
    if (event) event.stopPropagation();
    if (!agent.id) return;
    this.router.navigate(['/admin/agents/pay', agent.id]);
  }

  changeStatus(agent: Agent, newStatus: string) {
    if (!agent.id) return;
    const status = newStatus as AgentStatus;
    if (status && status !== this.statusOf(agent)) {
      this.agentService.updateAgentStatus(agent.id, status);
    }
  }

  deleteAgent(agent: Agent, event?: Event) {
    if (event) event.stopPropagation();
    if (!agent.id) return;
    if (!confirm(`Delete agent "${agent.name}"? Their commission entries are removed too. This cannot be undone.`)) return;
    this.commissions.deleteForAgent(agent.id);
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
