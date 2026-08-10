import { Injectable, inject } from '@angular/core';
import { Auth, signInAnonymously } from '@angular/fire/auth';
import { AgentService, Agent } from './agent.service';

/**
 * Agent authentication — mobile number + password, stored in Firestore.
 *
 * Agents do NOT use Firebase Authentication (that stays admin-only): their
 * credential is the 10-digit mobile number the admin registered them with, and
 * the password lives as a salted hash on their own `agents/{id}` document.
 *
 * There is no self-serve registration and no password reset link: the admin
 * creates the account, sets the password and hands both to the agent.
 *
 * This file is intentionally IDENTICAL in the admin console and the agent PWA —
 * the two must agree byte-for-byte on how a password is hashed, or a password
 * set in one could never be verified in the other.
 */

// Where the signed-in agent's mobile number is kept.
export const AGENT_SESSION_KEY = 'glaron_logged_agent_mobile';

export type AgentLoginOutcome =
  | { status: 'ok'; agent: Agent }
  | { status: 'not-found' }
  | { status: 'wrong-password' }
  | { status: 'inactive'; agent: Agent }
  | { status: 'no-password'; agent: Agent };

@Injectable({ providedIn: 'root' })
export class AgentAuthService {
  private auth = inject(Auth, { optional: true });
  private agentService = inject(AgentService);

  private anonSession: Promise<void> | null = null;

  constructor() {
    if (this.getSession()) this.ensureFirebaseSession();
  }

  // ---------------- Mobile normalisation ----------------

  normalizeMobile(value: string | null | undefined): string {
    const digits = (value || '').replace(/\D/g, '');
    return digits.length > 10 ? digits.slice(-10) : digits;
  }

  isValidMobile(value: string | null | undefined): boolean {
    return /^[6-9][0-9]{9}$/.test(this.normalizeMobile(value));
  }

  // ---------------- Password hashing ----------------

  /**
   * Hash a password for storage. The mobile number is mixed in as a per-account
   * salt, and the algorithm is recorded as a prefix ('s256$' / 'fnv$') so a hash
   * produced on a device without Web Crypto is still verifiable on one that has
   * it.
   */
  async hashPassword(mobile: string, password: string): Promise<string> {
    const salted = `glaron-agent:${this.normalizeMobile(mobile)}:${password}`;
    const subtle = typeof crypto !== 'undefined' ? crypto.subtle : undefined;
    if (subtle) {
      try {
        const bytes = new TextEncoder().encode(salted);
        const digest = await subtle.digest('SHA-256', bytes);
        const hex = Array.from(new Uint8Array(digest))
          .map(b => b.toString(16).padStart(2, '0'))
          .join('');
        return 's256$' + hex;
      } catch (e) {
        // Fall through to the non-crypto path below.
      }
    }
    return 'fnv$' + this.weakHash(salted);
  }

  // Last-resort hash for contexts without crypto.subtle (plain http). Weaker
  // than SHA-256, but still avoids storing the raw password.
  private weakHash(input: string): string {
    let h1 = 0x811c9dc5;
    let h2 = 0x01000193;
    for (let i = 0; i < input.length; i++) {
      const c = input.charCodeAt(i);
      h1 = Math.imul(h1 ^ c, 0x01000193) >>> 0;
      h2 = Math.imul(h2 + c, 0x85ebca6b) >>> 0;
    }
    return h1.toString(16).padStart(8, '0') + h2.toString(16).padStart(8, '0');
  }

  async verifyPassword(mobile: string, password: string, storedHash: string): Promise<boolean> {
    if (!storedHash) return false;
    if (storedHash.startsWith('fnv$')) {
      const salted = `glaron-agent:${this.normalizeMobile(mobile)}:${password}`;
      return storedHash === 'fnv$' + this.weakHash(salted);
    }
    return storedHash === (await this.hashPassword(mobile, password));
  }

  // ---------------- Firebase (anonymous) session ----------------

  /**
   * Take an anonymous Firebase session so Firestore reads/writes satisfy rules
   * that require `request.auth != null`. Resolves either way.
   */
  ensureFirebaseSession(): Promise<void> {
    if (!this.auth) return Promise.resolve();
    if (this.auth.currentUser) return Promise.resolve();
    if (this.anonSession) return this.anonSession;

    this.anonSession = signInAnonymously(this.auth)
      .then(() => undefined)
      .catch(err => {
        console.warn('Anonymous agent session notice:', err?.code || err?.message || err);
        this.anonSession = null;
      });
    return this.anonSession;
  }

  // ---------------- Session storage ----------------

  getSession(): string {
    try {
      return localStorage.getItem(AGENT_SESSION_KEY) || sessionStorage.getItem(AGENT_SESSION_KEY) || '';
    } catch (e) {
      return '';
    }
  }

  /**
   * Remember the signed-in account on this device. `remember` decides how long
   * for: localStorage survives app launches, sessionStorage only this session.
   */
  persistSession(mobile: string, remember = true) {
    const m = this.normalizeMobile(mobile);
    try {
      sessionStorage.setItem(AGENT_SESSION_KEY, m);
      if (remember) {
        localStorage.setItem(AGENT_SESSION_KEY, m);
      } else {
        localStorage.removeItem(AGENT_SESSION_KEY);
      }
    } catch (e) {}
  }

  clearSession() {
    try {
      localStorage.removeItem(AGENT_SESSION_KEY);
      sessionStorage.removeItem(AGENT_SESSION_KEY);
    } catch (e) {}
  }

  // ---------------- Sign in ----------------

  async login(rawMobile: string, password: string): Promise<AgentLoginOutcome> {
    const mobile = this.normalizeMobile(rawMobile);

    let agent = this.agentService.findByMobile(mobile);
    if (!agent && !this.agentService.hasSynced) {
      await this.agentService.whenReady(4000);
      agent = this.agentService.findByMobile(mobile);
    }
    if (!agent) return { status: 'not-found' };
    if (!agent.passwordHash) return { status: 'no-password', agent };

    const ok = await this.verifyPassword(mobile, password, agent.passwordHash);
    if (!ok) return { status: 'wrong-password' };

    if (agent.status !== 'Active') return { status: 'inactive', agent };

    return { status: 'ok', agent };
  }

  /** Set (or replace) an agent's sign-in password. Used by the admin console. */
  async setPassword(agentId: string, mobile: string, newPassword: string): Promise<void> {
    await this.ensureFirebaseSession();
    const passwordHash = await this.hashPassword(mobile, newPassword);
    this.agentService.updateAgentPassword(agentId, passwordHash);
  }
}
