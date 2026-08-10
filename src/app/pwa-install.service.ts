import { Injectable, signal } from '@angular/core';

/**
 * Tracks whether the dealer portal is running as an INSTALLED app (PWA added to
 * the home screen, or the Capacitor native shell) and drives the browser's
 * install prompt.
 *
 * The dealer panel is only reachable from the installed app — a plain browser
 * visit is sent to the install screen instead (see pwaInstalledGuard).
 */
@Injectable({ providedIn: 'root' })
export class PwaInstallService {
  // True once Chrome/Edge has offered a `beforeinstallprompt` we can replay.
  readonly canPrompt = signal<boolean>(!!(window as any).__glaronInstallPrompt);
  // Flips to true right after the browser reports the app was installed.
  readonly installed = signal<boolean>(false);

  constructor() {
    window.addEventListener('glaron-install-ready', () => this.canPrompt.set(true));
    window.addEventListener('glaron-app-installed', () => {
      this.canPrompt.set(false);
      this.installed.set(true);
      this.resetFirstRunState();
    });
  }

  /**
   * A fresh install must feel fresh.
   *
   * On Android and desktop the installed app shares its storage with the
   * browser, so uninstalling it does NOT clear localStorage. Without this, a
   * dealer who uninstalls and reinstalls still carries the old "onboarding
   * seen" flag and login, and the app would jump straight into the catalog —
   * no splash, no intro slides, no login screen. Wiping the first-run keys the
   * moment the browser reports an install guarantees the full
   * splash → intro → login journey on every reinstall.
   *
   * iOS needs no help here: deleting a home-screen web app also deletes its
   * storage, so a reinstall is already a clean slate.
   *
   * Keys are literals on purpose — importing them from app.routes would make
   * this service and the routes circularly dependent.
   */
  private resetFirstRunState(): void {
    try {
      localStorage.removeItem('glaron_dealer_onboarding_seen');
      localStorage.removeItem('glaron_dealer_tour_seen');
      localStorage.removeItem('glaron_logged_dealer_mobile');
      sessionStorage.removeItem('glaron_logged_dealer_mobile');
      // Legacy email-based session from builds before mobile sign-in.
      localStorage.removeItem('glaron_logged_dealer_email');
      sessionStorage.removeItem('glaron_logged_dealer_email');
    } catch (e) {}
  }

  /**
   * Is the app running standalone (installed) rather than in a browser tab?
   * Covers Android/desktop display-mode, iOS Safari's navigator.standalone and
   * the Capacitor native build.
   */
  get isStandalone(): boolean {
    try {
      // Capacitor native shell (Android/iOS build) is always "installed".
      const cap = (window as any).Capacitor;
      if (cap?.isNativePlatform?.()) return true;

      const modes = ['standalone', 'fullscreen', 'minimal-ui', 'window-controls-overlay'];
      if (window.matchMedia) {
        for (const m of modes) {
          if (window.matchMedia(`(display-mode: ${m})`).matches) return true;
        }
      }
      // iOS Safari home-screen apps.
      if ((window.navigator as any).standalone === true) return true;
    } catch (e) {}
    return false;
  }

  // iOS Safari never fires beforeinstallprompt — it needs manual instructions.
  get isIos(): boolean {
    const ua = window.navigator.userAgent || '';
    const iOsUa = /iPad|iPhone|iPod/.test(ua);
    // iPadOS 13+ reports as a Mac; touch points give it away.
    const iPadOs = /Macintosh/.test(ua) && (navigator as any).maxTouchPoints > 1;
    return iOsUa || iPadOs;
  }

  /**
   * On iOS only Safari can add an app to the home screen — Chrome (CriOS),
   * Firefox (FxiOS), Edge (EdgiOS) and in-app webviews cannot. Those users must
   * reopen the link in Safari first.
   */
  get isIosNonSafari(): boolean {
    if (!this.isIos) return false;
    const ua = window.navigator.userAgent || '';
    return /CriOS|FxiOS|EdgiOS|OPiOS|Instagram|FBAN|FBAV|Line\//.test(ua);
  }

  /** Shows the native install dialog. Resolves true if the user accepted. */
  async promptInstall(): Promise<boolean> {
    const evt = (window as any).__glaronInstallPrompt;
    if (!evt) return false;
    try {
      evt.prompt();
      const choice = await evt.userChoice;
      if (choice?.outcome === 'accepted') {
        (window as any).__glaronInstallPrompt = null;
        this.canPrompt.set(false);
        return true;
      }
    } catch (e) {}
    return false;
  }
}
