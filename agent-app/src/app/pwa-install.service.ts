import { Injectable, signal } from '@angular/core';

/**
 * Tracks whether the agent app is running as an INSTALLED app (added to the
 * home screen) and drives the browser's install prompt.
 *
 * The agent panel is only reachable from the installed app — a plain browser
 * visit is sent to the install screen instead (see pwaInstalledGuard).
 */
@Injectable({ providedIn: 'root' })
export class PwaInstallService {
  // True once Chrome/Edge has offered a `beforeinstallprompt` we can replay.
  readonly canPrompt = signal<boolean>(!!(window as any).__glaronAgentInstallPrompt);
  // Flips to true right after the browser reports the app was installed.
  readonly installed = signal<boolean>(false);

  constructor() {
    window.addEventListener('glaron-agent-install-ready', () => this.canPrompt.set(true));
    window.addEventListener('glaron-agent-installed', () => {
      this.canPrompt.set(false);
      this.installed.set(true);
      this.resetFirstRunState();
    });
  }

  /**
   * A fresh install must feel fresh.
   *
   * On Android and desktop the installed app shares its storage with the
   * browser, so uninstalling does NOT clear localStorage — a reinstall would
   * otherwise jump straight past the splash and login into the panel. Wiping
   * the first-run keys the moment the browser reports an install guarantees the
   * full splash → login journey every time.
   */
  private resetFirstRunState(): void {
    try {
      localStorage.removeItem('glaron_logged_agent_mobile');
      sessionStorage.removeItem('glaron_logged_agent_mobile');
    } catch (e) {}
  }

  /**
   * Is the app running standalone (installed) rather than in a browser tab?
   * Covers Android/desktop display-mode and iOS Safari's navigator.standalone.
   */
  get isStandalone(): boolean {
    try {
      const cap = (window as any).Capacitor;
      if (cap?.isNativePlatform?.()) return true;

      const modes = ['standalone', 'fullscreen', 'minimal-ui', 'window-controls-overlay'];
      if (window.matchMedia) {
        for (const m of modes) {
          if (window.matchMedia(`(display-mode: ${m})`).matches) return true;
        }
      }
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
   * Firefox (FxiOS), Edge (EdgiOS) and in-app webviews cannot.
   */
  get isIosNonSafari(): boolean {
    if (!this.isIos) return false;
    const ua = window.navigator.userAgent || '';
    return /CriOS|FxiOS|EdgiOS|OPiOS|Instagram|FBAN|FBAV|Line\//.test(ua);
  }

  /** Shows the native install dialog. Resolves true if the user accepted. */
  async promptInstall(): Promise<boolean> {
    const evt = (window as any).__glaronAgentInstallPrompt;
    if (!evt) return false;
    try {
      evt.prompt();
      const choice = await evt.userChoice;
      if (choice?.outcome === 'accepted') {
        (window as any).__glaronAgentInstallPrompt = null;
        this.canPrompt.set(false);
        return true;
      }
    } catch (e) {}
    return false;
  }
}
