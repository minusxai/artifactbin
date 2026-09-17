/**
 * WHO THE SELECTED SERVER IS.
 *
 * One deployment can answer at several hostnames. This module is the ONE place
 * that decides whether two origins are the same server, and the only place that
 * fetches the server's public identity document. Everything else asks it a
 * question — "is this origin the server I selected?" — and gets a yes or no.
 *
 * THE TRUST RULE, which is the whole point of the module:
 *
 *   An alias relation is believed only when the CANONICAL origin's own document
 *   lists the alias. If the origin the person selected says "my canonical is X",
 *   X's own document must say "my origin is X" and name the selected origin
 *   among its aliases; anything else and the claim is ignored entirely.
 *
 *   Requests and credentials are only ever sent to the canonical origin of the
 *   server the person SELECTED — never to an origin merely named in a pasted
 *   URL, and never to an alias. A pasted URL is used for its artifact id alone.
 *
 * Both discovery fetches carry no credential, refuse redirects and give up
 * quickly. A server that does not answer — an older build, a proxy, an offline
 * network — means "no aliases", which is exactly the behaviour every command
 * had before this endpoint existed.
 */
import {SERVER_IDENTITY_PATH, normalizeOrigin, parseServerIdentityDocument, type ServerIdentityDocument} from '@artifactbin/contracts';
import {CLI_VERSION} from './version';
import {HOME_SCOPE} from './state';
import {readState, stateFor} from './state-access';

export interface ServerIdentity {
  /** The origin the person selected, normalized. */
  selected: string;
  /** Where requests and credentials go: the selected origin, or the canonical origin it verified against. */
  canonical: string;
  /** The canonical origin's verified other addresses. `selected` is one of these when it is not canonical. */
  aliases: string[];
}

/** Discovery never holds a command up: a server that has not answered by now has no aliases. */
const IDENTITY_TIMEOUT_MS = 5_000;
/** A verified relation is stable deployment configuration; re-read it once a day. */
const VERIFIED_TTL_MS = 24 * 60 * 60 * 1000;
/**
 * "No aliases" is remembered far more briefly: it is also what an offline
 * laptop, a restarting server and a deployment that has just set the setting
 * look like, and a day-long memory of it would keep the folder broken.
 */
const UNVERIFIED_TTL_MS = 10 * 60 * 1000;

interface CachedIdentity {canonical: string; aliases: string[]; checkedAt: number}

export interface IdentityOptions {
  home: string;
  env?: NodeJS.ProcessEnv;
  fetch?: typeof fetch;
  now?: () => number;
  timeoutMs?: number;
  /** Skip the cache read; the write still happens. */
  refresh?: boolean;
}

/** Is `origin` another address of the same server? Selected, canonical and every verified alias are. */
export function sameServer(identity: ServerIdentity, origin: string): boolean {
  const value = normalizeOrigin(origin);
  return !!value && (value === identity.selected || value === identity.canonical || identity.aliases.includes(value));
}

/** Every address of this server, canonical first — what a caller hands `resolveReference` as `aliases`. */
export function serverAddresses(identity: ServerIdentity): string[] {
  const addresses = [identity.canonical, ...identity.aliases];
  return addresses.includes(identity.selected) ? addresses : [...addresses, identity.selected];
}

/**
 * The identity of the selected origin: cached, verified, and never a reason for
 * a command to fail. Any local-state or network trouble degrades to "this
 * origin is its own server and has no aliases".
 */
export async function serverIdentity(selected: string, options: IdentityOptions): Promise<ServerIdentity> {
  const origin = normalizeOrigin(selected);
  if (!origin) return {selected, canonical: selected, aliases: []};
  const now = (options.now ?? Date.now)();
  if (!options.refresh) {
    const cached = await readCache(origin, options);
    if (cached && fresh(cached, origin, now)) return {selected: origin, canonical: cached.canonical, aliases: cached.aliases};
  }
  const discovered = await discover(origin, options);
  await writeCache(origin, {...discovered, checkedAt: now}, options);
  return {selected: origin, ...discovered};
}

function fresh(cached: CachedIdentity, selected: string, now: number): boolean {
  if (!Number.isFinite(cached.checkedAt) || cached.checkedAt > now) return false;
  const verified = cached.canonical !== selected || cached.aliases.length > 0;
  return now - cached.checkedAt < (verified ? VERIFIED_TTL_MS : UNVERIFIED_TTL_MS);
}

/**
 * The mutual check. Two fetches at most, and the second one only to an origin
 * that has already passed the origin rule — a served document must never be
 * able to steer an outbound request at an arbitrary address.
 */
async function discover(selected: string, options: IdentityOptions): Promise<{canonical: string; aliases: string[]}> {
  const own = await fetchIdentity(selected, options);
  if (!own) return {canonical: selected, aliases: []};
  // The selected origin IS the canonical one: its own document names its aliases.
  if (own.origin === selected) return {canonical: selected, aliases: own.aliases};
  // It claims to be an alias of another server. Believe it only when THAT server agrees,
  // and only one hop: a canonical that names a further canonical is not a canonical.
  const canonical = await fetchIdentity(own.origin, options);
  if (!canonical || canonical.origin !== own.origin || !canonical.aliases.includes(selected)) return {canonical: selected, aliases: []};
  return {canonical: own.origin, aliases: canonical.aliases};
}

/** No Authorization, no account header, no cookie, no redirect, no waiting. */
async function fetchIdentity(origin: string, options: IdentityOptions): Promise<ServerIdentityDocument | null> {
  try {
    const response = await (options.fetch ?? fetch)(`${origin}${SERVER_IDENTITY_PATH}`, {
      method: 'GET',
      redirect: 'error',
      credentials: 'omit',
      signal: AbortSignal.timeout(options.timeoutMs ?? IDENTITY_TIMEOUT_MS),
      headers: {Accept: 'application/json', 'User-Agent': `afbin/${CLI_VERSION}`},
    });
    if (!response.ok) return null;
    return parseServerIdentityDocument(await response.json().catch(() => null));
  } catch { return null; }
}

async function readCache(selected: string, options: IdentityOptions): Promise<CachedIdentity | null> {
  try {
    const state = await readState(options.home, options.env ?? process.env);
    const value = state?.get<CachedIdentity>(HOME_SCOPE, 'server-identity', selected)?.value;
    if (!value || typeof value !== 'object') return null;
    const canonical = typeof value.canonical === 'string' ? normalizeOrigin(value.canonical) : null;
    if (!canonical || !Array.isArray(value.aliases)) return null;
    const aliases: string[] = [];
    for (const entry of value.aliases) {
      const alias = typeof entry === 'string' ? normalizeOrigin(entry) : null;
      if (!alias) return null;
      aliases.push(alias);
    }
    return {canonical, aliases, checkedAt: value.checkedAt};
  } catch { return null; }
}

async function writeCache(selected: string, value: CachedIdentity, options: IdentityOptions): Promise<void> {
  try {
    (await stateFor(options.home, options.env ?? process.env)).put(HOME_SCOPE, 'server-identity', selected, value);
  } catch { /* A cache that cannot be written is a cache miss next time, never a failed command. */ }
}
