import { environment } from '../environments/environment';
import { ADMIN_AUTH_KEY } from './app.routes';

/**
 * Localhost-only test session for the admin console, so it can be exercised on
 * the dev server without anyone typing a password.
 *
 *   ?as=admin   sign in to the console
 *   ?as=none    sign out
 *
 * The parameter is consumed before Angular boots — the session key the login
 * page would have written is written directly, then the parameter is stripped
 * from the address so a reload keeps the session without re-applying.
 *
 * Two gates keep this off the live site: it is compiled against the dev
 * environment only (production builds return at once), and it refuses any host
 * but localhost even in a dev build. The dealer/agent app has the same hook in
 * src/app/dev-session.ts.
 */
export function applyDevSession(): void {
  if (environment.production) return;
  const host = location.hostname;
  if (host !== 'localhost' && host !== '127.0.0.1' && host !== '[::1]') return;

  const params = new URLSearchParams(location.search);
  const as = params.get('as');
  if (!as) return;

  const set = (value: string) => {
    try { localStorage.setItem(ADMIN_AUTH_KEY, value); sessionStorage.setItem(ADMIN_AUTH_KEY, value); } catch {}
  };
  const clear = () => {
    try { localStorage.removeItem(ADMIN_AUTH_KEY); sessionStorage.removeItem(ADMIN_AUTH_KEY); } catch {}
  };

  switch (as) {
    case 'admin':
      set('dev@localhost');
      break;
    case 'none':
      clear();
      break;
    default:
      console.warn(`[dev-session] unknown role "${as}" — use admin or none`);
      return;
  }

  params.delete('as');
  const rest = params.toString();
  history.replaceState(null, '', location.pathname + (rest ? `?${rest}` : '') + location.hash);
  console.info(`[dev-session] localhost test session: ${as}`);
}
