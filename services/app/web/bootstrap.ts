/**
 * The data the SERVER inlined for this page (server/app withBootstrap), read
 * once at module load. It is what makes the first paint the final one: the
 * page renders from it instead of from a fetch that lands a beat later.
 * Consumed ONCE per address — a client navigation to another page fetches,
 * because the inlined answer belongs to the address the document was served at.
 */
const BOOTSTRAP_ID = 'mx-page-data';

interface Payload {
  path: string; profile?: unknown; artifact?: unknown;
  /** The canonical path, when the document was served at another address (server/app; web/heal-address). */
  address?: string;
}

const payload: Payload | null = (() => {
  try {
    const el = document.getElementById(BOOTSTRAP_ID);
    return el?.textContent ? (JSON.parse(el.textContent) as Payload) : null;
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
  if (!payload || payload.path !== path || taken.has(which)) return null;
  const value = payload[which];
  if (value === undefined) return null;
  taken.add(which);
  return value as T;
}

/**
 * The canonical path the server named for this page, when it served the
 * document at another address (`/a/<id>`, a stale slug) instead of redirecting.
 * Null otherwise.
 */
export function canonicalAddress(): string | null {
  return typeof payload?.address === 'string' ? payload.address : null;
}
