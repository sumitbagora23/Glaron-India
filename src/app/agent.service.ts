import { Injectable, signal, inject } from '@angular/core';
import { Firestore, collection, doc, setDoc, onSnapshot, deleteDoc } from '@angular/fire/firestore';

/**
 * Sales agents.
 *
 * An agent is NOT a dealer: they never place orders and never see pricing. They
 * carry the catalogue and earn a commission the admin records against them.
 *
 * Accounts exist only because the admin creates them — there is no self-serve
 * registration. The admin types a mobile number and a password and hands both to
 * the agent, exactly like handing over a key. The mobile number is the login
 * identity and the document id (`ag-<mobile>`), so one number can never end up
 * on two records.
 */

export type AgentStatus = 'Active' | 'Inactive';

export interface Agent {
  id?: string;
  /** Display name. Optional at creation — the admin may only know the number. */
  name: string;
  initial: string;
  /** 10-digit mobile number — this is the agent's login identity. */
  phone: string;
  /** Salted hash of the sign-in password (see AgentAuthService). */
  passwordHash?: string;
  status: AgentStatus;
  email?: string;
  location?: string;
  createdAt?: string;
}

@Injectable({ providedIn: 'root' })
export class AgentService {
  private STORAGE_KEY = 'glaron_agents_v1';
  private firestore = inject(Firestore, { optional: true });

  private agentsSignal = signal<Agent[]>(this.loadFromStorage());

  /** True once Firestore has delivered at least one snapshot of the agents. */
  hasSynced = false;
  private readyResolvers: Array<() => void> = [];

  constructor() {
    this.initFirestoreSync();
  }

  /** Resolves once the list has synced (or the timeout lapses) so callers never hang. */
  whenReady(timeoutMs = 4000): Promise<void> {
    if (this.hasSynced || !this.firestore) return Promise.resolve();
    return new Promise<void>(resolve => {
      let settled = false;
      const finish = () => { if (!settled) { settled = true; resolve(); } };
      this.readyResolvers.push(finish);
      setTimeout(finish, timeoutMs);
    });
  }

  private markSynced() {
    this.hasSynced = true;
    const resolvers = this.readyResolvers;
    this.readyResolvers = [];
    resolvers.forEach(r => r());
  }

  /** Reduce anything typed or stored (+91 …, spaces, dashes) to the bare 10 digits. */
  normalizePhone(value: string | null | undefined): string {
    const digits = (value || '').replace(/\D/g, '');
    return digits.length > 10 ? digits.slice(-10) : digits;
  }

  isValidMobile(value: string | null | undefined): boolean {
    return /^[6-9][0-9]{9}$/.test(this.normalizePhone(value));
  }

  findByMobile(mobile: string): Agent | undefined {
    const target = this.normalizePhone(mobile);
    if (target.length !== 10) return undefined;
    return this.agents.find(a => this.normalizePhone(a.phone) === target);
  }

  findById(id: string): Agent | undefined {
    return this.agents.find(a => a.id === id);
  }

  private initFirestoreSync() {
    if (!this.firestore) return;
    try {
      const col = collection(this.firestore, 'agents');
      onSnapshot(col, (snapshot) => {
        const list: Agent[] = [];
        snapshot.forEach(docSnap => list.push(docSnap.data() as Agent));
        const sorted = this.sort(list);
        this.agentsSignal.set(sorted);
        this.saveToStorage(sorted);
        this.markSynced();
      }, (err) => {
        console.warn('Firestore agents notice:', err?.message || err);
        // Fail open — never lock an agent out because a read failed.
        this.readyResolvers.forEach(r => r());
        this.readyResolvers = [];
      });
    } catch (e) {
      console.warn('Firestore agents init notice:', e);
    }
  }

  private sort(list: Agent[]): Agent[] {
    return [...list].sort((a, b) => (a.name || '').localeCompare(b.name || ''));
  }

  private loadFromStorage(): Agent[] {
    try {
      const stored = localStorage.getItem(this.STORAGE_KEY);
      if (stored) return JSON.parse(stored) as Agent[];
    } catch (e) {
      console.error('Error loading agents from localStorage', e);
    }
    return [];
  }

  private saveToStorage(agents: Agent[]) {
    try {
      localStorage.setItem(this.STORAGE_KEY, JSON.stringify(agents));
    } catch (e) {
      console.error('Error saving agents to localStorage', e);
    }
  }

  get agents(): Agent[] {
    return this.agentsSignal();
  }

  /**
   * Create (or overwrite) an agent. The Firestore write is surfaced to the
   * caller: an account the admin thinks they created but that never landed
   * would leave the agent holding a password nothing recognises.
   */
  addAgent(data: {
    name?: string;
    phone: string;
    passwordHash?: string;
    email?: string;
    location?: string;
    status?: AgentStatus;
  }): Promise<void> {
    const mobile = this.normalizePhone(data.phone);
    const existing = mobile.length === 10 ? this.findByMobile(mobile) : undefined;
    const id = existing?.id || 'ag-' + (mobile || Date.now());
    const name = (data.name || '').trim() || `Agent ${mobile}`;

    const agent: Agent = {
      id,
      name,
      initial: name.charAt(0).toUpperCase() || 'A',
      phone: mobile || data.phone,
      passwordHash: data.passwordHash || existing?.passwordHash || '',
      email: data.email || existing?.email || '',
      location: data.location || existing?.location || '',
      status: data.status || 'Active',
      createdAt: existing?.createdAt || new Date().toISOString()
    };

    this.agentsSignal.update(list => {
      const next = this.sort([agent, ...list.filter(a => a.id !== id)]);
      this.saveToStorage(next);
      return next;
    });

    if (!this.firestore) return Promise.resolve();
    return setDoc(doc(this.firestore, 'agents', id), agent)
      .catch(err => {
        console.warn('Firestore add agent notice:', err);
        throw err;
      });
  }

  updateAgent(id: string, data: Partial<Agent>) {
    this.agentsSignal.update(list => {
      const next = this.sort(list.map(a => {
        if (a.id !== id) return a;
        const merged = { ...a, ...data };
        if (data.name) merged.initial = data.name.charAt(0).toUpperCase() || a.initial;
        return merged;
      }));
      this.saveToStorage(next);
      return next;
    });
    this.persist(id);
  }

  updateAgentPassword(id: string, passwordHash: string) {
    this.updateAgent(id, { passwordHash });
  }

  updateAgentStatus(id: string, status: AgentStatus) {
    this.updateAgent(id, { status });
  }

  deleteAgent(id: string) {
    this.agentsSignal.update(list => {
      const next = list.filter(a => a.id !== id);
      this.saveToStorage(next);
      return next;
    });

    if (this.firestore) {
      deleteDoc(doc(this.firestore, 'agents', id))
        .catch(err => console.warn('Firestore delete agent notice:', err?.message || err));
    }
  }

  private persist(id: string) {
    if (!this.firestore) return;
    const target = this.agentsSignal().find(a => a.id === id);
    if (!target) return;
    setDoc(doc(this.firestore, 'agents', id), target)
      .catch(err => console.warn('Firestore update agent notice:', err?.message || err));
  }
}
