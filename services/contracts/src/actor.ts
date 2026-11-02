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
    caller?: RunnerCaller };
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
