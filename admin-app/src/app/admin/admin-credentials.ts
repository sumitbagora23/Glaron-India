// ────────────────────────────────────────────────────────────────────────────
// ADMIN CREDENTIAL STORE — the single admin account (admin@glaronindia.com).
//
// The console is gated by one account. Its password lives on the device so the
// "Recreate password" screen can reset it instantly, with no email round-trip:
// Firebase reset emails never arrive for this account, and the console has to
// stay usable on networks that block the SDK. The default matches the original
// built-in password; once the admin sets a new one it is remembered here and
// every later sign-in is checked against it.
//
// Reset is scoped to this email only — any other address is rejected on the
// recreate screen, so nothing else can have its password changed here.
// ────────────────────────────────────────────────────────────────────────────
export const ADMIN_EMAIL = 'admin@glaronindia.com';
const DEFAULT_ADMIN_PASSWORD = '123456789';
const ADMIN_PASSWORD_KEY = 'glaron_admin_password';

/** True when the supplied email is the admin account (case/space-insensitive). */
export function isAdminEmail(email: string): boolean {
  return (email || '').trim().toLowerCase() === ADMIN_EMAIL;
}

/** The current admin password — the one the admin last set, or the default. */
export function getAdminPassword(): string {
  try {
    const stored = localStorage.getItem(ADMIN_PASSWORD_KEY);
    if (stored && stored.length >= 6) return stored;
  } catch (e) {}
  return DEFAULT_ADMIN_PASSWORD;
}

/** Remember a new admin password on this device. */
export function setAdminPassword(password: string): void {
  try {
    localStorage.setItem(ADMIN_PASSWORD_KEY, password);
  } catch (e) {}
}
