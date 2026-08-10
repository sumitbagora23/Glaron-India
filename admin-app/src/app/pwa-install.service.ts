import { Injectable, signal } from '@angular/core';

/**
 * Install state for the Glaron Admin PWA.
 *
 * Unlike the dealer portal, the console is NOT app-only — an admin can work in
 * a desktop browser tab. Installing still matters on phones, because iOS only
 * allows Web Push for a home-screen app, which is what makes new-order alerts
 * arrive while the console is closed.
 */
@Injectable({ providedIn: 'root' })
export class PwaInstallService {
  // True once Chrome/Edge has offered a `beforeinstallprompt` we can replay.
  readonly canPrompt = signal<boolean>(!!(window as any).__glaronAdminInstallPrompt);
  // Flips to true right after the browser reports the app was installed.
  readonly installed = signal<boolean>(false);

  constructor() {
    window.addEventListener('glaron-admin-install-ready', () => this.canPrompt.set(true));
    window.addEventListener('glaron-admin-installed', () => {
      this.canPrompt.set(false);
      this.installed.set(true);
    });
  }

  /**
   * Is the app running standalone (installed) rather than in a browser tab?
   * Covers Android/desktop display-mode and iOS Safari's navigator.standalone.
   */
  get isStandalone(): boolean {
    try {
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
   * Firefox (FxiOS), Edge (EdgiOS) and in-app webviews cannot.
   */
  get isIosNonSafari(): boolean {
    if (!this.isIos) return false;
    const ua = window.navigator.userAgent || '';
    return /CriOS|FxiOS|EdgiOS|OPiOS|Instagram|FBAN|FBAV|Line\//.test(ua);
  }

  /**
   * Phones/tablets need the installed app for reliable background alerts;
   * a desktop browser can show notifications without installing.
   */
  get isMobile(): boolean {
    const ua = window.navigator.userAgent || '';
    return this.isIos || /Android|Mobile/.test(ua);
  }

  /** Shows the native install dialog. Resolves true if the user accepted. */
  async promptInstall(): Promise<boolean> {
    const evt = (window as any).__glaronAdminInstallPrompt;
    if (!evt) return false;
    try {
      evt.prompt();
      const choice = await evt.userChoice;
      if (choice?.outcome === 'accepted') {
        (window as any).__glaronAdminInstallPrompt = null;
        this.canPrompt.set(false);
        return true;
      }
    } catch (e) {}
    return false;
  }
}
