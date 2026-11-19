/**
 * SERVICES THAT ACCEPT THIS INSTALLATION'S IDENTITY TOKENS (`IDENTITY__SERVICE_AUDIENCES`, an identity-side setting,
 * empty by default). Each entry names another service by an `id` and the `origin` its tokens are bound to (the token's
 * audience), and may carry the SHA-256 (hex) of the secret that service presents to introspect (`IDENTITY_INTROSPECT_PATH`
 * with `SERVICE_AUTH_HEADER`): introspecting with it answers only for tokens of that one audience, so the service never
 * needs the installation's own service secret.
 *
 * Two kinds of token carry such an audience, and the identity module issues both:
 *  - a PERSON's token for that service (OAuth with `resource=<origin>`, or `/api/authentication/token` with
 *    `{"audience": "<id>"}`): a stored, refreshable grant, never admitted at this installation's own API;
 *  - an EXCHANGED token (`POST SERVICE_TOKEN_PATH` `{"audience": "<id>"}`): signed, not stored, for a person who
 *    already holds a credential here, a browser session (same Origin) or an ordinary API bearer, living
 *    `SERVICE_TOKEN_TTL_SECONDS`, with no refresh token. It names that credential (`parent`), and introspection answers
 *    for it only while the parent is live, so signing out or revoking the parent ends it on the next check.
 *
 * A RUN SIGN-IN (`RUN_SIGN_IN_PATH`, only for a service whose entry says `"run_sign_ins": true`): a service running work
 * for a person (a sandbox that must behave as if the person had installed the author skill and signed in) turns that
 * person's exchanged token for ITS OWN audience into an ordinary API sign-in for them at this installation: a stored
 * access token like the skill's sign-in gets (audience `<public origin>/api`, scope `artifacts`), with NO refresh token,
 * for the lifetime asked (seconds, clamped to MIN_TOKEN_TTL_MS..MAX_TOKEN_TTL_MS; default DEFAULT_TOKEN_TTL_MS). It
 * records the service (`tokens.issued_by`, the service's id; introspection answers it) and the exchanged token's parent
 * credential, and is live only while that parent is: signing out or revoking the parent ends it on the next request.
 * The person sees and revokes it with their other tokens. POST with SERVICE_AUTH_HEADER (the service's own
 * introspection secret) and `{"token": "<vwt_…>", "expires_in"?: <seconds>}`; anything else is refused, an ordinary
 * bearer in place of the exchanged token included. Without the opt-in the path answers as an unknown route.
 *
 * Writing the skill's sign-in file from the answer (`RunSignIn`), in the sandbox's `ARTIFACTBIN_HOME` (default
 * `~/.artifactbin`, and it and `hosts/` mode 0700): `hosts/<D>/credentials.env`, mode 0600 in a 0700 directory, `<D>`
 * being the first 16 hex digits of the SHA-256 of `server`. The skill's own sign-in also links `hosts/<host>` (the host
 * name for https on 443, else `<host>@<protocol>-<port>`) to that directory; leave it absent or make it that link,
 * never a plain directory. The file holds exactly
 *
 *   ARTIFACTBIN_URL=<server>
 *   ARTIFACTBIN_TOKEN=<access_token>
 *   ARTIFACTBIN_EXPIRES_AT=<expires_at_ms>
 *
 * with no refresh lines. Every script then works as the person until the expiry, and after it refuses with the
 * ordinary "sign in again" answer, never trying to refresh or writing the file. A sign-in can end sooner than
 * `expires_at`: with its parent credential (revoked, signed out, or a parent access token reaching its own expiry, 24 h
 * for the skill's sign-in), after which a request is refused as unauthorized; a service starting a run longer than its
 * parent may live exchanges a browser session's token, or tells the person to sign in again.
 *
 * A GROUP SIGN-IN FOR A SERVICE (`GROUP_SIGN_IN_PATH`, only for a service whose entry says `"group_sign_ins": true`): an
 * agent the service runs with nobody present (scheduled or team work) acts as a GROUP. An Admin of the group (direct,
 * or of an ancestor) first approves the service at `member` or `editor` on the group's settings page (the identity
 * module's `group_sign_in_grants`, readable in the identity views); the service then presents its own secret
 * (SERVICE_AUTH_HEADER) and `{"grant_id": "<sgg_…>", "expires_in"?: <seconds: default 6 h, clamped to 1 h–24 h>}` and
 * receives an ordinary API access token whose principal is that group at that level (./identity-service
 * `GROUP_SIGN_IN_RULE`: no person; `issued_by` the service's id; `grant_id` the approval), with NO refresh token
 * (`GroupSignIn`, which names `token_id` so the service can record which run used it). Only an approval naming THIS
 * service, not revoked, of a live group; never another group or level, never `admin`. The token is live only while
 * its approval is: revoking it or deleting the group ends every token issued under it on the next check. The approval
 * belongs to the group: it does not end when the Admin who approved it stops being one (`approved_by` is history),
 * but one a test account made never issues or keeps a token. It is also the service's only while the service is
 * configured as it was approved (`groupSignInServiceConfigured`): its entry here, with the opt-in, at the origin the
 * approval recorded. Removing the entry or the opt-in stops every such token on its next use (the bearer read and the
 * app re-check it each request), and a different service later given the old id, at another origin, inherits
 * nothing; the same id configured again at the same origin is, unavoidably, the same service. Each issue is audited
 * (`minted`, subject the group, with the approval and the service), and so are each approval and revocation (the
 * group's audit). The service learns the approvals it may present at `GROUP_SIGN_IN_GRANTS_PATH`: the same secret,
 * an empty `{}`, and back `{"approvals": [ServiceGroupSignInGrant…]}`, its own that still stand, oldest first. Without
 * the opt-in both paths answer as an unknown route.
 *
 * GROUP PRINCIPALS AT A SERVICE (only for a service whose entry says `"group_principals": true`): an agent signed in as
 * a group (either way above: a person's `--as-group` sign-in, or a service's under an approval) exchanges its own API
 * bearer at `SERVICE_TOKEN_PATH` exactly as a person does, and the service token it receives acts as that GROUP at that
 * level: introspection answers `principal_kind: 'group'`, `user_id` null, the group, its level, `issued_by` (who issued
 * the group sign-in) and `parent` (the group sign-in's token). It lives as a person's does, never past its parent, and
 * only while the parent is live by every rule that governs it and the service still opts in. Without the opt-in the
 * exchange answers 403 `GROUP_PRINCIPALS_NOT_ACCEPTED` to a group, and a person's is unchanged: a service that reads
 * only `active` and `user_id` is never handed a principal with no person. A group's service token is a different kind
 * from a person's: it never becomes a run sign-in, an artifact read grant or any other token.
 */
import { normalizeOrigin } from './server-identity';

export interface ServiceAudience {
  /** Lower-case id, e.g. `warehouse`: what a login (`--audience`) and the exchange name the service by. */
  id: string;
  /** The audience its tokens carry: an origin (HTTPS, or HTTP on a local development host). */
  origin: string;
  /** Hex SHA-256 of the secret the service introspects with; null: it introspects with nothing of its own. */
  introspectionSecretSha256: string | null;
  /** Explicit opt-in to delegated canonical artifact reads. */
  artifactReads?: boolean;
  /** Explicit opt-in to run sign-ins (`RUN_SIGN_IN_PATH`): needs `introspection_secret_sha256`. */
  runSignIns?: boolean;
  /** Explicit opt-in to group sign-ins a group's Admin approved (`GROUP_SIGN_IN_PATH`): needs `introspection_secret_sha256`. */
  groupSignIns?: boolean;
  /** Explicit opt-in to service tokens acting as a group (header above): needs `introspection_secret_sha256`. */
  groupPrincipals?: boolean;
  artifactWorkloads?: {authorizationUrl:string;authorizationSecret:string};
}

/** The exchange: a short-lived token for one configured service, for the caller's own session or API bearer. */
export const SERVICE_TOKEN_PATH = '/api/authentication/service-token';
/** The exchange's refusal (403) to an agent signed in as a group, for a service that does not opt in to group principals. */
export const GROUP_PRINCIPALS_NOT_ACCEPTED = 'group_principals_not_accepted';
/** A run sign-in: an ordinary API access token for the person whose exchanged token the service presents (header above). */
export const RUN_SIGN_IN_PATH = '/api/internal/identity/run-sign-in';
/** A run sign-in's answer: what a sandbox writes into the skill's `credentials.env` (header above). */
export interface RunSignIn {
  /** The bearer: written only into the sandbox's private sign-in file, never a URL, a log or page code. */
  access_token: string;
  token_type: 'Bearer';
  /** The `tokens` row's id: what the person sees and revokes. */
  token_id: string;
  /** ISO expiry, and the same instant in milliseconds since the epoch (`ARTIFACTBIN_EXPIRES_AT`). */
  expires_at: string;
  expires_at_ms: number;
  /** This installation's public origin (`ARTIFACTBIN_URL`). */
  server: string;
}
/** A group sign-in for a service (header above): its own secret and an approval's id in, an ordinary access token out. */
export const GROUP_SIGN_IN_PATH = '/api/internal/identity/group-sign-in';
/** A service's own approvals that still stand (header above): its own secret and `{}` in, `{approvals}` out. */
export const GROUP_SIGN_IN_GRANTS_PATH = '/api/internal/identity/group-sign-in-grants';
/** The longest a service's group sign-in lives: a day, whatever it asks; unasked, DEFAULT_TOKEN_TTL_MS. */
export const SERVICE_GROUP_SIGN_IN_MAX_TTL_MS = 24 * 60 * 60 * 1000;
/** One approval a service may present (`GROUP_SIGN_IN_GRANTS_PATH`): the group, its handle and name, the level. */
export interface ServiceGroupSignInGrant { id: string; group_id: string; group_handle: string; group_name: string; role: 'member' | 'editor'; approved_at: string }
/**
 * Is a service's group sign-in or approval still that configured service's: `serviceId` is configured here, opted in
 * to group sign-ins, at `origin` (what the approval recorded; null matches nothing). Asked on every use, where the
 * configuration is known (the bearer read, the app's re-check, the mint and the service's list).
 */
export function groupSignInServiceConfigured(audiences: readonly ServiceAudience[], serviceId: string | null | undefined, origin: string | null | undefined): boolean {
  return !!serviceId && !!origin && audiences.some((service) => service.id === serviceId && service.groupSignIns === true && service.origin === origin);
}
/** A group sign-in's answer: a run sign-in's fields, and the group and level the token acts as. */
export interface GroupSignIn extends RunSignIn {
  group_id: string;
  group_role: 'member' | 'editor';
  grant_id: string;
}
/** An exchanged token's whole life (`exp - iat`): minutes, never refreshed; the caller asks again. */
export const SERVICE_TOKEN_TTL_SECONDS = 300;
/** The credential an exchanged token was issued for: an access token (`tokens` row) or a browser session (`sessions` row). */
export interface ServiceTokenParent { kind: 'token' | 'session'; id: string }

export interface IssuedServiceToken {
  /** The bearer: handed only to the one service, never to page code, a URL, a log or storage. */
  token: string;
  /** The origin it is bound to. */
  audience: string;
  expiresAt: string;
}

const ID = /^[a-z][a-z0-9-]{0,62}$/;
const HEX64 = /^[0-9a-f]{64}$/;
const WHAT = 'IDENTITY__SERVICE_AUDIENCES must be a JSON array of {"id": "<lower-case id>", "origin": "<https origin>", "introspection_secret_sha256"?: "<64 hex>", "run_sign_ins"?: <boolean, with a secret>, "group_sign_ins"?: <boolean, with a secret>, "group_principals"?: <boolean, with a secret>}';

/** The setting, validated whole: a malformed entry, a repeated id or origin, or an origin that is not one, throws naming it. */
export function parseServiceAudiences(raw: string | undefined): readonly ServiceAudience[] {
  if (raw === undefined || raw.trim() === '') return Object.freeze([]);
  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch { throw new Error(WHAT); }
  if (!Array.isArray(parsed)) throw new Error(WHAT);
  const out: ServiceAudience[] = [];
  for (const entry of parsed) {
    const e = entry as Record<string, unknown> | null;
    if (!e || typeof e !== 'object' || Array.isArray(e) || Object.keys(e).some((key) => !['id', 'origin', 'introspection_secret_sha256', 'artifact_reads', 'artifact_workloads', 'run_sign_ins', 'group_sign_ins', 'group_principals'].includes(key))) throw new Error(WHAT);
    let workload:ServiceAudience['artifactWorkloads'];
    if(e.artifact_workloads!==undefined){
      const w=e.artifact_workloads as Record<string,unknown>;
      if(!w||typeof w!=='object'||Array.isArray(w)||Object.keys(w).length!==2||typeof w.authorization_url!=='string'||typeof w.authorization_secret!=='string'||w.authorization_secret.length<16||w.authorization_secret.length>4096||/[\r\n]/.test(w.authorization_secret))throw new Error(WHAT);
      let url:URL;try{url=new URL(w.authorization_url);}catch{throw new Error(WHAT);}
      if(!['https:','http:'].includes(url.protocol)||url.username||url.password||url.hash||url.search)throw new Error(WHAT);
      workload={authorizationUrl:url.href,authorizationSecret:w.authorization_secret};
      if(typeof e.introspection_secret_sha256!=='string')throw new Error(WHAT);
    }
    const origin = typeof e.origin === 'string' ? normalizeOrigin(e.origin) : null;
    const secret = e.introspection_secret_sha256;
    if (e.artifact_reads !== undefined && typeof e.artifact_reads !== 'boolean') throw new Error(WHAT);
    if (e.run_sign_ins !== undefined && (typeof e.run_sign_ins !== 'boolean' || (e.run_sign_ins && typeof e.introspection_secret_sha256 !== 'string'))) throw new Error(WHAT);
    if (e.group_sign_ins !== undefined && (typeof e.group_sign_ins !== 'boolean' || (e.group_sign_ins && typeof e.introspection_secret_sha256 !== 'string'))) throw new Error(WHAT);
    if (e.group_principals !== undefined && (typeof e.group_principals !== 'boolean' || (e.group_principals && typeof e.introspection_secret_sha256 !== 'string'))) throw new Error(WHAT);
    if (typeof e.id !== 'string' || !ID.test(e.id) || !origin || (secret !== undefined && (typeof secret !== 'string' || !HEX64.test(secret)))) throw new Error(WHAT);
    if (out.some((other) => other.id === e.id || other.origin === origin)) throw new Error(`IDENTITY__SERVICE_AUDIENCES repeats ${JSON.stringify(e.id)} or its origin`);
    out.push({ ...(workload?{artifactWorkloads:workload}:{}), id: e.id, origin, introspectionSecretSha256: typeof secret === 'string' ? secret : null, ...(e.artifact_reads !== undefined ? {artifactReads:e.artifact_reads as boolean} : {}), ...(e.run_sign_ins === true ? {runSignIns:true} : {}), ...(e.group_sign_ins === true ? {groupSignIns:true} : {}), ...(e.group_principals === true ? {groupPrincipals:true} : {}) });
  }
  return Object.freeze(out);
}
