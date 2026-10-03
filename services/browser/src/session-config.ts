import { createEnv, overHttp } from '@artifactbin/utils';
import type { SessionProcessOptions } from './session-process';

/** What a composition hands `createBrowser` for sessions: how to spawn one, and how many may live. */
export type BrowserSessionOptions = SessionProcessOptions & { capacity?: SessionCapacity };

/**
 * WHERE THE SANDBOX IS DECIDED — once, at this service's env boundary, never by a
 * session asking the host what it happens to be.
 *
 * `BROWSER__SANDBOX=none` runs the session worker as a plain child process: no
 * bubblewrap, no cgroup, no OS containment at all. It exists for ONE reason — live
 * sessions cannot start on a developer's macOS host otherwise, so every CLI and skill
 * change waited on a release and a deploy to be tried at all. It is refused when
 * `NODE_ENV=production`, and any other value is refused outright rather than silently
 * ignored: a misspelled hardening switch must never read as "hardened".
 */
export interface SessionSandboxChoice {
  mode: 'bubblewrap' | 'none';
  /** Set when the setting was understood but not allowed; the spawn fails with this sentence. */
  refusal?: string;
}

export function sessionSandboxChoice(source: NodeJS.ProcessEnv): SessionSandboxChoice {
  return readSessionEnv(source).sandbox;
}

/**
 * HOW MANY LIVE BROWSERS THIS SERVICE HOLDS. `sessions` is the whole service's cap, shared by
 * every owner (`BROWSER__SESSION_MAX`); `sessionsPerActor` is what one credential may hold of it
 * (`BROWSER__SESSION_MAX_PER_ACTOR`), so a single agent cannot take every slot. Each session's own
 * resources (1 GiB, 512 processes, one CPU) are the cgroup's and do not change with these.
 */
export interface SessionCapacity { sessions: number; sessionsPerActor: number }
export const DEFAULT_SESSION_CAPACITY: SessionCapacity = { sessions: 2, sessionsPerActor: 2 };

export function sessionCapacity(source: NodeJS.ProcessEnv): SessionCapacity {
  return readSessionEnv(source).capacity;
}

/** The session settings and the names they were read under, from ONE audited reader. */
function readSessionEnv(source: NodeJS.ProcessEnv) {
  const { env, namesRead } = createEnv(source);
  const cgroupRoot = env('BROWSER', 'SESSION_CGROUP_ROOT');
  const capacity = {
    sessions: wholeCount('BROWSER__SESSION_MAX', env('BROWSER', 'SESSION_MAX'), DEFAULT_SESSION_CAPACITY.sessions),
    sessionsPerActor: wholeCount('BROWSER__SESSION_MAX_PER_ACTOR', env('BROWSER', 'SESSION_MAX_PER_ACTOR'), DEFAULT_SESSION_CAPACITY.sessionsPerActor),
  };
  return { cgroupRoot, capacity, sandbox: sandboxFrom(env('BROWSER', 'SANDBOX'), source), pagesHost: pagesHostFrom(env('APP', 'PAGES_HOST')), names: namesRead() };
}

/**
 * The deployment's pages host, the same setting the app serves documents under (APP__PAGES_HOST): a session
 * admits `<hex id>.<pages host>` and the apex because the app page frames every document from there.
 */
function pagesHostFrom(value: string | undefined): string | undefined {
  if (value === undefined || value.trim() === '') return undefined;
  const host = value.trim().toLowerCase();
  if (!/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)*$/.test(host)) throw new Error(`APP__PAGES_HOST=${value} is not a bare hostname; browser sessions admit the document origins under it.`);
  return host;
}

/** Digits only: `Number` would read ' 3' as 3 and '1e2' as 100, and a limit must mean what it says. */
function wholeCount(name: string, value: string | undefined, fallback: number): number {
  if (value === undefined || value === '') return fallback;
  if (!/^\d+$/.test(value) || Number(value) < 1) throw new Error(`${name}=${value} is not a limit this build understands; it must be a whole number of at least 1.`);
  return Number(value);
}

/**
 * The names this boundary reads. A composition root that hands its own environment
 * to `sessionProcessPaths` adds these to its env audit, so a setting this service
 * consumed is not announced at boot as one nothing reads.
 */
export function sessionEnvNamesRead(): ReadonlySet<string> { return readSessionEnv({}).names; }

function sandboxFrom(value: string | undefined, source: NodeJS.ProcessEnv): SessionSandboxChoice {
  if (value === undefined || value === '') return { mode: 'bubblewrap' };
  if (value !== 'none') return { mode: 'bubblewrap', refusal: `BROWSER__SANDBOX=${value} is not a setting this build knows; the only value is none, and only outside production.` };
  if (source.NODE_ENV === 'production') return { mode: 'bubblewrap', refusal: 'BROWSER__SANDBOX=none removes all OS containment from browser sessions and is refused when NODE_ENV=production.' };
  return { mode: 'none' };
}

/** Every session setting a composition spreads into `createBrowser({ sessions })`, read once — the pages host included. */
export function sessionProcessPaths(source: NodeJS.ProcessEnv): Pick<BrowserSessionOptions, 'cgroupRoot' | 'browsersPath' | 'sandbox' | 'capacity' | 'pagesHost'> {
  const { cgroupRoot, sandbox, capacity, pagesHost } = readSessionEnv(source);
  return { cgroupRoot, sandbox, capacity, ...(pagesHost ? { pagesHost } : {}), ...(source.PLAYWRIGHT_BROWSERS_PATH ? { browsersPath: source.PLAYWRIGHT_BROWSERS_PATH } : {}) };
}

/** Browser-service environment boundary; these credentials never enter a worker. */
export function sessionProcessOptions(source: NodeJS.ProcessEnv): BrowserSessionOptions | undefined {
  const { env } = createEnv(source);
  const target = env('BROWSER', 'SESSION_APP_URL');
  const baseURL = env('APP', 'PUBLIC_BASE_URL');
  const secret = env('CONTRACT', 'ACTOR_SECRET');
  if (!target || !baseURL || !secret) return undefined;
  return { baseURL, request: overHttp(target, secret), ...sessionProcessPaths(source) };
}
