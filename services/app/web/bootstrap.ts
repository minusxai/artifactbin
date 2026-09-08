/**
 * The data the SERVER inlined for this page (server/app withBootstrap), read
 * once at module load. It is what makes the first paint the final one: the
 * page renders from it instead of from a fetch that lands a beat later.
 * Consumed ONCE per address — a client navigation to another page fetches,
 * because the inlined answer belongs to the address the document was served at.
 */
import type {PageBootstrap} from './page-bootstrap-contract';
const BOOTSTRAP_ID = 'mx-page-data';

/** Immutable startup read, safe during repeated StrictMode initial renders. */
export function pageBootstrap(path: string): Readonly<PageBootstrap> | null {
  return !invalidated && payload?.path === path && validSession(payload.session) ? payload as PageBootstrap : null;
}
/** Retire startup projections after a credential change; never read DOM again. */
export function invalidateBootstrap(): void { invalidated = true; }
let invalidated = false;

export function validSession(value: unknown): value is PageBootstrap['session'] {
  if (!value || typeof value !== 'object') return false;
  const s = value as PageBootstrap['session'];
  return ['account','anon','none'].includes(s.kind) && !!s.mixpanel && typeof s.mixpanel.host === 'string'
    && (s.mixpanel.token === null || typeof s.mixpanel.token === 'string')
    && (s.kind === 'account' ? !!s.user && typeof s.user.id === 'string' && (s.user.email === null || typeof s.user.email === 'string') : s.user === null);
}

type Payload = Partial<PageBootstrap> & {path: string};

const payload: Payload | null = (() => {
  try {
    const el = document.head.querySelector(`script#${BOOTSTRAP_ID}[type="application/json"]`);
    const parsed = el?.textContent ? JSON.parse(el.textContent) as Payload : null;
    return parsed?.path === window.location.pathname ? parsed : null;
  } catch {
    return null;
  }
})();

const taken = new Set<string>();

/**
 * The inlined answer for this address, if the page was served with one. A
 * pretty URL carries two (the resolution and the document page), each taken
 * once: a later client navigation fetches, because the inlined answers belong
 * to the address the document was served at.
 */
export function takeBootstrap<T>(path: string, which: 'profile' | 'artifact'): T | null {
  if (invalidated || !payload || payload.path !== path || taken.has(which)) return null;
  const value = payload[which];
  if (value === undefined) return null;
  taken.add(which);
  return value as T;
}
