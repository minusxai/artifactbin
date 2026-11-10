import type { DatasetRole } from './dataset-permissions';
/**
 * WHO IS CALLING. Resolved from a bearer token, a human session or a document-bound Pages
 * session, and handed to the app with the request — in-process by reference (utils attachActor),
 * across a network hop as a signed header (utils signActor). The app reads it with actorOf().
 */
export const ACTOR_HEADER = 'x-mx-actor';
/** Internal response marker: the proxy rechecks credentials before delivering delayed query rows. */
export const REVALIDATE_ACTOR_HEADER = 'x-mx-revalidate-actor';
export const CREDENTIALS = ['bearer', 'session', 'agent-cookie', 'none'] as const;
export type Credential = (typeof CREDENTIALS)[number];

export interface Actor {
  credential: Credential;
  userId?: string;
  tokenId?: string;
  email?: string;
  emailVerified?: boolean;
  /** Non-secret identity row reference; never the session bearer token. */
  sessionId?: string;
  /** Runner-host attestation, absent from browser/token authentication. */
  runner?: { pageBackendOperation?: 'query' | 'mutation'; runId: string; artifactId: string; version: string; editId: string; sourceHash: string; callId: number;
    /**
     * Who called the resolver: the subject and page role the app decided when it admitted the run, signed with
     * the rest of the pin (resolver code cannot reach it). Absent from runners that predate it and from runs
     * that are not a resolver call; `caps.query` refuses a pin without one.
     */
    caller?: RunnerCaller;
    /** What the app admitted the call on (`RunnerAdmission`), signed with the rest of the pin; absent from runs that are not a page function call. */
    admission?: RunnerAdmission };
}

/**
 * A page function call's ADMISSION, carried in its trusted run input (never shown to resolver code) and signed into a
 * remote runner's pin. Every capability the call reaches is re-decided against it: the page head must still be `head`
 * (a digest of the head's version, edit and links when the call was admitted), the caller must still be allowed to run
 * the function, and a scheduled run's `claim` must still be the schedule's current claim.
 */
export interface RunnerAdmission {
  page: string;
  head: string;
  /** The function called: its `roles` (or `@auth`) decide, at every capability, whether the caller may still run it. */
  function: string;
  /** A scheduled run's claim on its schedule (lib/function-schedules): the lease's token and fencing epoch. */
  claim?: { link: string; token: string; epoch: number };
}
const ADMISSION_NAME = /^[_A-Za-z][_0-9A-Za-z]{0,63}$/;
/** The exact shape of a RunnerAdmission, or null: what a pin or a run input may carry. */
export function runnerAdmissionOf(value: unknown): RunnerAdmission | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const a = value as Record<string, unknown>;
  if (Object.keys(a).some((k) => !['page', 'head', 'function', 'claim'].includes(k))) return null;
  if (typeof a.page !== 'string' || !a.page || typeof a.head !== 'string' || !/^[0-9a-f]{64}$/.test(a.head) || typeof a.function !== 'string' || !ADMISSION_NAME.test(a.function)) return null;
  const base = { page: a.page, head: a.head, function: a.function };
  if (a.claim === undefined) return base;
  const c = a.claim as Record<string, unknown> | null;
  if (!c || typeof c !== 'object' || Array.isArray(c) || Object.keys(c).some((k) => !['link', 'token', 'epoch'].includes(k))) return null;
  if (typeof c.link !== 'string' || !c.link || typeof c.token !== 'string' || !c.token || !Number.isSafeInteger(c.epoch) || (c.epoch as number) < 1) return null;
  return { ...base, claim: { link: c.link, token: c.token, epoch: c.epoch as number } };
}

/** The caller a resolver run was admitted for (`PageResolverPrincipal` without the tenant). */
export interface RunnerCaller { subject: string | null; role: DatasetRole }

export const ANONYMOUS: Actor = { credential: 'none' };

/** Default lifetime of a signed header. Short: it is minted per request. */
export const ACTOR_TTL_SECONDS = 120;

/** The identity owner revalidates a human session for derived pages sessions. */
export interface HumanSessionAuthority { live(sessionId:string,userId:string):Promise<boolean> }

/** Auth-owned, service-authenticated POST; body {sessionId,userId}, response {live:boolean}. */
export const HUMAN_SESSION_LIVE_PATH = '/api/internal/auth/session-live';
