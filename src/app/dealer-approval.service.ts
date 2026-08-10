import { Injectable, signal, inject, effect } from '@angular/core';
import { DealerService } from './admin/dealer.service';
import { NotificationService } from './admin/notification.service';

/**
 * Watches the live dealer list and detects the moment an admin approves the
 * dealer registered on THIS device (status flips to 'Active').
 *
 * Flow:
 *  1. When a dealer applies (dealer-apply) or is blocked at login while still
 *     pending, we record their mobile number via `markPending()`.
 *  2. The admin approves them → `DealerService.updateDealerStatus(id,'Active')`
 *     → Firestore pushes the updated dealers list to every device in real time.
 *  3. The `effect()` below re-runs on that change; if the pending dealer is now
 *     Active we raise the "approval accepted" message on all three surfaces:
 *       • login page  — live success banner (via `justApproved` signal / flag)
 *       • dealer panel — a one-time welcome toast (consumes the flag)
 *       • installed PWA — an OS notification (when permission is granted)
 *
 * No Cloud Function or admin-side change is required — it rides the dealer list
 * sync that already exists.
 */
@Injectable({ providedIn: 'root' })
export class DealerApprovalService {
  private dealerService = inject(DealerService);
  private notifications = inject(NotificationService);

  // Mobile number we're waiting on approval for (survives reloads).
  private readonly PENDING_KEY = 'glaron_pending_dealer_mobile';
  // Pre-mobile-login builds stored a pending *email* here; cleared on sight so
  // a stale entry can't keep the watcher looking for an identity we no longer
  // sign in with.
  private readonly LEGACY_PENDING_KEY = 'glaron_pending_dealer_email';
  // Set once approval is detected; presence means "show the accepted message".
  private readonly APPROVED_KEY = 'glaron_dealer_approved_name';

  // Live, in-memory flags the UI binds to so the banner appears the instant
  // approval lands while the dealer is watching the login page.
  readonly justApproved = signal(false);
  readonly approvedName = signal('');

  constructor() {
    try { localStorage.removeItem(this.LEGACY_PENDING_KEY); } catch {}

    // Re-runs whenever the dealer list changes (i.e. a Firestore sync).
    effect(() => {
      // Touch the list so this effect tracks it, then evaluate.
      this.dealerService.dealers;
      this.evaluate();
    });
  }

  // Record that this device is awaiting approval for `mobile`.
  markPending(mobile: string) {
    const digits = (mobile || '').replace(/\D/g, '').slice(-10);
    if (digits.length !== 10) return;
    try { localStorage.setItem(this.PENDING_KEY, digits); } catch {}
  }

  // True if there's an "approval accepted" message to show (live or persisted).
  hasApprovedMessage(): boolean {
    if (this.justApproved()) return true;
    try { return !!localStorage.getItem(this.APPROVED_KEY); } catch { return false; }
  }

  // The dealer's name for the message, without clearing it.
  approvedLabel(): string {
    if (this.approvedName()) return this.approvedName();
    try { return localStorage.getItem(this.APPROVED_KEY) || ''; } catch { return ''; }
  }

  // Read + clear the accepted message (used by the panel so it shows once).
  consumeApproval(): string {
    const label = this.approvedLabel();
    try { localStorage.removeItem(this.APPROVED_KEY); } catch {}
    this.justApproved.set(false);
    this.approvedName.set('');
    return label;
  }

  // Called after a successful sign-in: we no longer need to watch this number.
  clearPending() {
    try { localStorage.removeItem(this.PENDING_KEY); } catch {}
  }

  private evaluate() {
    let pending = '';
    try { pending = localStorage.getItem(this.PENDING_KEY) || ''; } catch {}
    if (!pending) return;

    const dealer = this.dealerService.findByMobile(pending);
    if (!dealer || dealer.status !== 'Active') return;

    // Approved! Persist + raise the message (once — we clear PENDING here so a
    // later list sync doesn't re-fire the OS notification).
    const label = dealer.name || pending;
    try {
      localStorage.setItem(this.APPROVED_KEY, label);
      localStorage.removeItem(this.PENDING_KEY);
    } catch {}
    this.approvedName.set(label);
    this.justApproved.set(true);

    // OS notification for the installed PWA (no-ops if permission not granted).
    this.notifications.notifyLocal(
      'Application approved 🎉',
      `${label}, your Glaron India dealer account has been approved. You can now sign in.`,
      'dealer-approval'
    );
  }
}
