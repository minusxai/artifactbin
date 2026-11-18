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
  /** Never set: a person's actor is never a group's (`GroupActor`). */
  principal?: never;
  userId?: string;
  tokenId?: string;
  email?: string;
  emailVerified?: boolean;
  /** Non-secret identity row reference; never the session bearer token. */
  sessionId?: string;
}

/** Native host bindings are in-process only; the explicit auth-owned service marker permits principal-only signed transport. */
export interface WorkloadActor {
 readonly credential:'workload';
 readonly principal?:never;
 /** Auth-owned purpose RPC transport marker; no permission scope. */
 readonly serviceWorkload?:true;
 readonly workload:WorkloadBinding;
 readonly userId?:never;
 readonly tokenId?:never;
 readonly email?:never;
 readonly emailVerified?:never;
 readonly sessionId?:never;
}
/**
 * AN AGENT SIGNED IN AS A GROUP (contracts identity-service `GROUP_SIGN_IN_RULE`): a live bearer whose principal is the
 * group `principalGroupId` itself at the level `principalGroupRole`, with NO person behind it: no `userId`, no address,
 * no session. `issuedBy` is the person who authorised it (never the principal); `tokenId` the bearer's row. Only ever a
 * bearer: no browser session acts as a group. The literal `principal` keeps it from being read as a `HumanActor` (a
 * person's actor) or as no one.
 */
export interface GroupActor {
 readonly credential:'bearer';
 readonly principal:'group';
 readonly principalGroupId:string;
 readonly principalGroupRole:GroupPrincipalRole;
 readonly tokenId:string;
 readonly issuedBy:string;
 readonly workload?:never;
 readonly userId?:never;
 readonly email?:never;
 readonly emailVerified?:never;
 readonly sessionId?:never;
}
/** The levels a group principal acts at: never `admin` (administration stays with people). */
export type GroupPrincipalRole = 'member' | 'editor';
export const isGroupPrincipalRole = (value: unknown): value is GroupPrincipalRole => value === 'member' || value === 'editor';
export const isGroupActor = (actor: Actor | null | undefined): actor is GroupActor => actor?.principal === 'group';
/** The one refusal (403) a route that does not admit a group's sign-in answers it with. */
export const GROUP_PRINCIPAL_REFUSED = 'group_principal_refused';
export type Actor = HumanActor | WorkloadActor | GroupActor;
export const ANONYMOUS: Actor = { credential: 'none' };

/** Default lifetime of a signed header. Short: it is minted per request. */
export const ACTOR_TTL_SECONDS = 120;

/** The identity owner revalidates a human session for derived pages sessions. */
export interface HumanSessionAuthority { live(sessionId:string,userId:string):Promise<boolean> }

/** Auth-owned, service-authenticated POST; body {sessionId,userId}, response {live:boolean}. */
export const HUMAN_SESSION_LIVE_PATH = '/api/internal/auth/session-live';
