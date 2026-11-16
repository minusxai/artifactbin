/**
 * WHO IS CALLING. Resolved from a bearer token, a human session or a document-bound Pages
 * session, and handed to the app with the request — in-process by reference (utils attachActor),
 * across a network hop as a signed header (utils signActor). The app reads it with actorOf().
 */
import type {WorkloadBinding} from './workload';
export const ACTOR_HEADER = 'x-mx-actor';
/** Internal response marker: the proxy rechecks credentials before delivering delayed query rows. */
export const REVALIDATE_ACTOR_HEADER = 'x-mx-revalidate-actor';
export const CREDENTIALS = ['bearer', 'session', 'agent-cookie', 'none'] as const;
export type Credential = (typeof CREDENTIALS)[number];

export interface HumanActor {
  credential: Credential;
  workload?: never;
  userId?: string;
  tokenId?: string;
  email?: string;
  emailVerified?: boolean;
  /** Non-secret identity row reference; never the session bearer token. */
  sessionId?: string;
}

/** A binding offered only through the trusted in-process host adapter. */
export interface WorkloadActor {
 readonly credential:'workload';
 readonly workload:WorkloadBinding;
 readonly userId?:never;
 readonly tokenId?:never;
 readonly email?:never;
 readonly emailVerified?:never;
 readonly sessionId?:never;
}
export type Actor = HumanActor | WorkloadActor;
export const ANONYMOUS: Actor = { credential: 'none' };

/** Default lifetime of a signed header. Short: it is minted per request. */
export const ACTOR_TTL_SECONDS = 120;

/** The identity owner revalidates a human session for derived pages sessions. */
export interface HumanSessionAuthority { live(sessionId:string,userId:string):Promise<boolean> }

/** Auth-owned, service-authenticated POST; body {sessionId,userId}, response {live:boolean}. */
export const HUMAN_SESSION_LIVE_PATH = '/api/internal/auth/session-live';
