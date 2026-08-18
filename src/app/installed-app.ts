/**
 * Is this running as an installed app, or as a page in a browser?
 *
 * The two get opposite update policies, and this is the only thing that
 * separates them:
 *
 *   - Opened from a link, in a browser tab, the app updates itself the moment
 *     a new build is on the server. A link should never hand someone a stale
 *     page — they did not choose to install anything, so there is nothing to
 *     preserve, and a reload costs them nothing.
 *
 *   - Installed on a home screen, it never updates on its own. Not on launch,
 *     not when brought back to the foreground, not on a timer. A new build is
 *     applied only when the user taps "Check for update". Reloading out from
 *     under someone mid-order is the thing this avoids.
 *
 * Both apps share this file (admin-app/src and src hold identical copies).
 */
export function isInstalledApp(): boolean {
  try {
    // The standard signal: an installed PWA runs in its own window rather than
    // a browser tab. `minimal-ui` and `fullscreen` are installed too — only
    // `browser` is not.
    if (window.matchMedia) {
      for (const mode of ['standalone', 'minimal-ui', 'fullscreen', 'window-controls-overlay']) {
        if (window.matchMedia(`(display-mode: ${mode})`).matches) return true;
      }
    }

    // iOS Safari predates display-mode and sets this instead. Home-screen web
    // apps on iOS report nothing else, so without this branch every installed
    // iPhone would be treated as a browser tab and would self-reload.
    if ((navigator as any).standalone === true) return true;

    // A Play Store wrapper (TWA) launches the page from an intent.
    if (typeof document !== 'undefined' && document.referrer.startsWith('android-app://')) return true;
  } catch (e) {
    // A locked-down browser that throws on matchMedia is a browser, not an
    // installed app — fall through.
  }

  return false;
}
