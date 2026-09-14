import { environment } from '../environments/environment';
import { ADMIN_AUTH_KEY } from './app.routes';
import { DEALER_SESSION_KEY, DEALER_BYPASS_MOBILE } from './dealer-auth.service';
import { AGENT_SESSION_KEY, AGENT_BYPASS_MOBILE } from './agent-auth.service';

/**
 * Localhost-only test sessions, so the app can be exercised end to end on the
 * dev server without anyone typing a password.
 *
 * Open the dev server with an `as` query parameter:
 *
 *   ?as=dealer              the developer bypass dealer (no Firestore record)
 *   ?as=dealer:98xxxxxxxx   a real dealer, by mobile number
 *   ?as=agent               the developer bypass agent (no Firestore record)
 *   ?as=agent:98xxxxxxxx    a real agent, by mobile number
 *   ?as=admin               the console embedded in this app
 *   ?as=none                sign out of everything
 *
 * The parameter is consumed before Angular boots — the session keys the real
 * sign-in would have written are written directly, then the parameter is
 * stripped from the address so a reload keeps the session without re-applying.
 *
 * Two gates keep this off the live site: it is compiled against the dev
 * environment only (production builds return at once), and it refuses any host
 * but localhost even in a dev build.
 */
export function applyDevSession(): void {
  if (environment.production) return;
  const host = location.hostname;
  if (host !== 'localhost' && host !== '127.0.0.1' && host !== '[::1]') return;

  const params = new URLSearchParams(location.search);
  const as = params.get('as');
  if (!as) return;

  const [role, arg] = as.split(':');
  const mobile = (arg || '').replace(/\D/g, '').slice(-10);
  const set = (key: string, value: string) => {
    try { localStorage.setItem(key, value); sessionStorage.setItem(key, value); } catch {}
  };
  const clear = (key: string) => {
    try { localStorage.removeItem(key); sessionStorage.removeItem(key); } catch {}
  };

  // One role at a time: the real sign-in never leaves two sessions behind.
  [DEALER_SESSION_KEY, AGENT_SESSION_KEY, ADMIN_AUTH_KEY].forEach(clear);

  let who = '';
  switch (role) {
    case 'dealer':
      who = mobile.length === 10 ? mobile : DEALER_BYPASS_MOBILE;
      set(DEALER_SESSION_KEY, who);
      break;
    case 'agent':
      who = mobile.length === 10 ? mobile : AGENT_BYPASS_MOBILE;
      set(AGENT_SESSION_KEY, who);
      break;
    case 'admin':
      who = 'dev@localhost';
      set(ADMIN_AUTH_KEY, who);
      break;
    case 'none':
      who = 'nobody';
      break;
    default:
      console.warn(`[dev-session] unknown role "${role}" — use dealer, agent, admin or none`);
      return;
  }

  params.delete('as');
  const rest = params.toString();
  history.replaceState(null, '', location.pathname + (rest ? `?${rest}` : '') + location.hash);
  console.info(`[dev-session] localhost test session: ${role} (${who})`);
}
