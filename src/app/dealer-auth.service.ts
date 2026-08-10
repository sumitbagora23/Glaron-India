import { Injectable, inject } from '@angular/core';
import { Auth, signInAnonymously } from '@angular/fire/auth';
import { DealerService, Dealer } from './admin/dealer.service';

/**
 * Dealer authentication — mobile number + password, stored in Firestore.
 *
 * Dealers do NOT use Firebase Authentication (that stays admin-only): their
 * credential is the 10-digit mobile number they registered with, and the
 * password lives as a salted hash on their own `dealers/{id}` document. Email is
 * an optional profile field everywhere and is never used to sign in.
 *
 * Firestore writes still need an authenticated caller, so every dealer device
 * takes an *anonymous* Firebase session in the background (see
 * `ensureFirebaseSession`). That session carries no identity — the dealer's real
 * identity is the mobile number held in `DEALER_SESSION_KEY`.
 */

// Where the signed-in dealer's mobile number is kept (see app.routes DEALER_AUTH_KEY).
export const DEALER_SESSION_KEY = 'glaron_logged_dealer_mobile';
// Sessions created before mobile login were keyed by email. They're cleared on
// sight so a stale one can't keep a dealer signed in against a dead identity.
const LEGACY_SESSION_KEY = 'glaron_logged_dealer_email';

// Developer bypass account — not a real Firestore dealer record.
export const DEALER_BYPASS_MOBILE = '9999999999';
const DEALER_BYPASS_PASSWORD = '123456789';

// Result of a sign-in attempt. Everything but 'ok' is a reason to stay put.
export type LoginOutcome =
  | { status: 'ok'; dealer: Dealer | null }
  | { status: 'not-found' }
  | { status: 'wrong-password' }
  | { status: 'pending'; dealer: Dealer }
  | { status: 'no-password'; dealer: Dealer };

export type RegisterOutcome =
  | { status: 'ok' }
  | { status: 'mobile-taken' }
  | { status: 'error'; message: string };

@Injectable({ providedIn: 'root' })
export class DealerAuthService {
  private auth = inject(Auth, { optional: true });
  private dealerService = inject(DealerService);

  private anonSession: Promise<void> | null = null;

  constructor() {
    // A dealer already signed in on this device (app relaunch) still needs the
    // anonymous Firebase session before they can place an order or edit their
    // profile, so restore it as soon as the service comes up.
    if (this.getSession()) this.ensureFirebaseSession();
  }

  // ---------------- Mobile normalisation ----------------

  // Reduce anything the dealer types (+91 98765 43210, 098765-43210, …) to the
  // bare 10 digits we key accounts by, so the same number always matches.
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
   * salt so two dealers who pick the same password don't share a hash.
   *
   * The algorithm is recorded as a prefix ('s256$' / 'fnv$') so a hash produced
   * on a device without Web Crypto (non-secure context) is still verifiable
   * later on a device that has it.
   */
  async hashPassword(mobile: string, password: string): Promise<string> {
    const salted = `glaron:${this.normalizeMobile(mobile)}:${password}`;
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

  // Last-resort hash for contexts where crypto.subtle is unavailable (plain
  // http). Weaker than SHA-256, but still avoids storing the raw password.
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

  // Verify a typed password against a stored hash, re-hashing with whichever
  // algorithm produced the stored value.
  async verifyPassword(mobile: string, password: string, storedHash: string): Promise<boolean> {
    if (!storedHash) return false;
    if (storedHash.startsWith('fnv$')) {
      const salted = `glaron:${this.normalizeMobile(mobile)}:${password}`;
      return storedHash === 'fnv$' + this.weakHash(salted);
    }
    return storedHash === (await this.hashPassword(mobile, password));
  }

  // ---------------- Firebase (anonymous) session ----------------

  /**
   * Take an anonymous Firebase session so Firestore writes (registration, order
   * placement, profile edits) satisfy rules that require `request.auth != null`.
   * Resolves either way — if the Anonymous provider isn't enabled in the Firebase
   * console this logs a notice and the app carries on exactly as before.
   */
  ensureFirebaseSession(): Promise<void> {
    if (!this.auth) return Promise.resolve();
    if (this.auth.currentUser) return Promise.resolve();
    if (this.anonSession) return this.anonSession;

    this.anonSession = signInAnonymously(this.auth)
      .then(() => undefined)
      .catch(err => {
        console.warn('Anonymous dealer session notice:', err?.code || err?.message || err);
        // Allow a later attempt (e.g. once the provider is enabled).
        this.anonSession = null;
      });
    return this.anonSession;
  }

  // ---------------- Session storage ----------------

  // The mobile number of the dealer signed in on this device ('' when none).
  getSession(): string {
    try {
      return localStorage.getItem(DEALER_SESSION_KEY) || sessionStorage.getItem(DEALER_SESSION_KEY) || '';
    } catch (e) {
      return '';
    }
  }

  /**
   * Remember the signed-in dealer on this device.
   *
   * `remember` decides how long for: localStorage keeps them signed in across
   * app launches, sessionStorage only until this session ends. Writing both
   * unconditionally made the "Remember me" checkbox do nothing.
   */
  persistSession(mobile: string, remember = true) {
    const m = this.normalizeMobile(mobile);
    try {
      sessionStorage.setItem(DEALER_SESSION_KEY, m);
      if (remember) {
        localStorage.setItem(DEALER_SESSION_KEY, m);
      } else {
        localStorage.removeItem(DEALER_SESSION_KEY);
      }
    } catch (e) {}
  }

  clearSession() {
    try {
      localStorage.removeItem(DEALER_SESSION_KEY);
      sessionStorage.removeItem(DEALER_SESSION_KEY);
      localStorage.removeItem(LEGACY_SESSION_KEY);
      sessionStorage.removeItem(LEGACY_SESSION_KEY);
    } catch (e) {}
  }

  // ---------------- Sign in ----------------

  async login(rawMobile: string, password: string): Promise<LoginOutcome> {
    const mobile = this.normalizeMobile(rawMobile);

    // Developer bypass account — no Firestore record behind it.
    if (mobile === DEALER_BYPASS_MOBILE && password === DEALER_BYPASS_PASSWORD) {
      return { status: 'ok', dealer: null };
    }

    // Prefer the locally-cached dealer list so returning dealers sign in
    // instantly; only wait on a fresh Firestore sync when this mobile isn't
    // recognised yet AND the list has never synced this session.
    let dealer = this.dealerService.findByMobile(mobile);
    if (!dealer && !this.dealerService.hasSynced) {
      await this.dealerService.whenReady(4000);
      dealer = this.dealerService.findByMobile(mobile);
    }
    if (!dealer) return { status: 'not-found' };

    // Legacy record from the old email/Firebase sign-in — there is no password
    // on it to check against, so the admin has to set one.
    if (!dealer.passwordHash) return { status: 'no-password', dealer };

    const ok = await this.verifyPassword(mobile, password, dealer.passwordHash);
    if (!ok) return { status: 'wrong-password' };

    // Correct credentials, but the admin hasn't approved the account yet.
    if (dealer.status !== 'Active') return { status: 'pending', dealer };

    return { status: 'ok', dealer };
  }

  // ---------------- Register ----------------

  async register(payload: {
    name: string;
    contactPerson?: string;
    mobile: string;
    email?: string;
    address: string;
    state?: string;
    city?: string;
    pincode?: string;
    location?: string;
    password: string;
  }): Promise<RegisterOutcome> {
    const mobile = this.normalizeMobile(payload.mobile);

    // Make sure we're looking at the real list before declaring a number free.
    if (!this.dealerService.hasSynced) await this.dealerService.whenReady(4000);
    if (this.dealerService.findByMobile(mobile)) return { status: 'mobile-taken' };

    try {
      // Firestore rules require an authenticated writer; the anonymous session
      // provides one without tying the dealer to a Firebase Auth account.
      await this.ensureFirebaseSession();

      const passwordHash = await this.hashPassword(mobile, payload.password);
      const write = this.dealerService.addDealer({
        name: payload.name,
        contactPerson: payload.contactPerson || payload.name,
        email: payload.email || '',
        phone: mobile,
        address: payload.address,
        state: payload.state,
        city: payload.city,
        pincode: payload.pincode,
        location: payload.location,
        status: 'Inactive',
        passwordHash
      });

      // The write must be confirmed before we tell the dealer they're
      // registered: an unsaved record is wiped by the next Firestore snapshot,
      // and they'd be left with a password nothing knows about.
      //
      // Offline is NOT a failure — Firestore queues the write and its promise
      // simply doesn't settle until the device reconnects. So a rejection is
      // reported, but a slow/pending write is accepted.
      await Promise.race([
        write,
        new Promise<void>(resolve => setTimeout(resolve, 8000))
      ]);

      return { status: 'ok' };
    } catch (e: any) {
      console.error('Dealer registration error:', e);
      if (e?.code === 'permission-denied' || e?.code === 'firestore/permission-denied') {
        return {
          status: 'error',
          message: 'Registration could not be saved — this app is not permitted to create dealer accounts right now. Please contact the Glaron team.'
        };
      }
      return { status: 'error', message: e?.message || 'Registration failed. Please try again.' };
    }
  }

  // Change the password of an existing dealer (used by the admin's reset action
  // and by a dealer changing their own password from the panel).
  async setPassword(dealerId: string, mobile: string, newPassword: string): Promise<void> {
    await this.ensureFirebaseSession();
    const passwordHash = await this.hashPassword(mobile, newPassword);
    this.dealerService.updateDealerPassword(dealerId, passwordHash);
  }
}
