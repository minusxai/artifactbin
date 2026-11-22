/**
 * What the credential routes here (./oauth, ./consent, ./token-exchange) share, as plain functions of their options
 * and the request: where this deployment answers and which resources a grant may be for (this API, scope `artifacts`,
 * or a configured service, scope empty); reading an auth body to AUTH_BODY_LIMIT; and issuing access (`mintFor`,
 * `issueGrant`), where a group's sign-in the rule no longer holds throws `GroupSignInRefused`, never an outage.
 */
import { BodyTooLargeError, readBody } from '@artifactbin/utils/body';
import { API_RESOURCE_PATH } from '@artifactbin/contracts/cli-auth';
import { IdentityError } from '@artifactbin/contracts/identity-module';
import { INTERNAL_MINT_PATH } from '@artifactbin/contracts/routes';
import type { GroupPrincipalRole } from '@artifactbin/contracts/actor';
import type { ServiceAudience } from '@artifactbin/contracts/service-audiences';
import type { Upstream } from '@artifactbin/contracts/part';
import { ACCESS_TOKEN_TTL_SECONDS, ARTIFACT_SCOPE, isTerminalRedirect, type OAuthStore } from '../identity/oauth';
import type { LiveGroupSignIn } from '../identity/bearer';
import type { SessionStore } from '../parts';

export const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type, Authorization' };
export const NO_STORE = { 'Cache-Control': 'no-store', Pragma: 'no-cache' };

export interface OAuthRoutesOptions {
  sessions: SessionStore;
  admitIdentity?:(identity:{userId:string;email?:string;emailVerified?:boolean})=>Promise<boolean>;
  oauth: OAuthStore;
  upstream: Upstream;
  trustedHops: number;
  publicBaseUrl?: string;
  aliasOrigins?: readonly string[];
  /** IDENTITY__SERVICE_AUDIENCES: the other resources a grant may be for. */
  serviceAudiences?: readonly ServiceAudience[];
  /** The exchanged tokens' signing key (service-tokens `serviceTokenKey` of AUTH__SECRET); null: the exchange answers 503. */
  serviceTokenKey?: Buffer | null;
  /** A group's exchanged tokens' signing key (service-tokens `groupServiceTokenKey` of AUTH__SECRET); null: a group's exchange answers 503. */
  groupServiceTokenKey?: Buffer | null;
  /** Group sign-ins (../identity-store/accounts `mintGroupSignIn` and the level check); absent: they answer 503. */
  groupSignIns?: GroupSignIns;
}

/** What the routes need for a group's sign-in: the guarded mint (throws `IdentityError`), and the consent page's facts. */
export interface GroupSignIns {
  mint(input: {issuedBy: string; groupId: string; role: GroupPrincipalRole; audience: string; scope: string}): Promise<{id: string; token: string}>;
  /** The live group's name when `userId` holds at least `role` on it (`groupLevelHeldSql`), else null. */
  heldName(userId: string, groupId: string, role: GroupPrincipalRole): Promise<string | null>;
  /** The group sign-in `tokenId`, live now by the bearer read's rule (../identity/bearer `readLiveGroupSignIn`), else null. */
  live(tokenId: string): Promise<LiveGroupSignIn | null>;
}
/** A grant's group principal, when it is a group's sign-in. */
export interface GrantGroup { id: string; role: GroupPrincipalRole }
/** The rule stopped holding (or never did): the grant ends; never retried as an outage. */
export class GroupSignInRefused extends Error {}

/** The configured public origin wins, avoiding bad forwarded-proto metadata. */
export function baseUrlOf(request: Request, trustedHops: number, publicBaseUrl?: string): string {
  if (publicBaseUrl) {
    try { return new URL(publicBaseUrl).origin; } catch { /* configuration validation reports this elsewhere */ }
  }
  const url = new URL(request.url);
  const forwardedHost = trustedHops > 0 ? request.headers.get('x-forwarded-host') : null;
  const forwardedProto = trustedHops > 0 ? request.headers.get('x-forwarded-proto') : null;
  const proto = (forwardedProto || url.protocol.replace(':', '')).split(',')[0]?.trim() ?? '';
  const host = (forwardedHost || request.headers.get('host') || url.host).split(',')[0]?.trim() ?? '';
  return `${proto}://${host}`;
}

/**
 * The origins one deployment answers at: the canonical `baseUrlOf` first, then APP__ALIAS_ORIGINS. A rename keeps
 * the former name as an alias, so a grant, bearer audience or form Origin bound to any of them is this deployment's.
 * Issuing and discovery still name only the canonical origin.
 */
export function acceptedOriginsOf(request: Request, trustedHops: number, publicBaseUrl: string | undefined, aliasOrigins: readonly string[] = []): string[] {
  const base = baseUrlOf(request, trustedHops, publicBaseUrl);
  return [base, ...aliasOrigins.filter((origin) => origin !== base)];
}

/** Only a personal, consented API grant with a native callback is a terminal agent grant. */
export const isTerminalConsent = (o: OAuthRoutesOptions, resource: string, redirectUri: string) =>
  !serviceAt(o, resource) && isTerminalRedirect(redirectUri);

const originsOf = (o: OAuthRoutesOptions, request: Request) => acceptedOriginsOf(request, o.trustedHops, o.publicBaseUrl, o.aliasOrigins);
/** The request's Origin is one this deployment answers at: the rule for every cookie-borne write here. */
export const isSameOrigin = (o: OAuthRoutesOptions, request: Request) => originsOf(o, request).includes(request.headers.get('origin') ?? '');
/** This API's canonical resource, which every new grant for it binds. */
export const resourceOf = (o: OAuthRoutesOptions, request: Request) => `${baseUrlOf(request, o.trustedHops, o.publicBaseUrl)}${API_RESOURCE_PATH}`;
/** This API under every name it answers at, which a grant may present. */
export const resourcesOf = (o: OAuthRoutesOptions, request: Request) => originsOf(o, request).map((origin) => `${origin}${API_RESOURCE_PATH}`);
/** The configured service whose origin `requested` is, if any. */
export const serviceAt = (o: OAuthRoutesOptions, requested: string) => (o.serviceAudiences ?? []).find((service) => service.origin === requested);
export const acceptsResource = (o: OAuthRoutesOptions, request: Request, requested: string) => resourcesOf(o, request).includes(requested) || !!serviceAt(o, requested);
/** The scope a grant for `resource` stores: `artifacts` for this API (the default), nothing for a service; null when the request names another. */
export const scopeFor = (o: OAuthRoutesOptions, requested: string, scope: string): string | null =>
  serviceAt(o, requested) ? (scope === '' ? '' : null) : ((scope || ARTIFACT_SCOPE) === ARTIFACT_SCOPE ? ARTIFACT_SCOPE : null);

/** Every auth body is a handful of short fields: sign-in, OTP, client metadata, token and consent forms. */
export const AUTH_BODY_LIMIT = 16 * 1024;
export const payloadTooLarge = () => new Response(JSON.stringify({ error: 'payload_too_large' }), { status: 413, headers: { 'Content-Type': 'application/json', ...NO_STORE, ...CORS } });

/** The body as text, or the 413 answer past AUTH_BODY_LIMIT; any other failure to read it is thrown. */
export async function readAuthText(request: Request): Promise<string | Response> {
  try { return await readBody(request, { limit: AUTH_BODY_LIMIT, as: 'text' }); }
  catch (error) { if (error instanceof BodyTooLargeError) return payloadTooLarge(); throw error; }
}

/** The body as JSON (`blank` for an empty one, when given), or the 413 answer; undefined when it cannot be read or parsed. */
export async function readAuthJson(request: Request, blank?: object): Promise<unknown> {
  try {
    const text = await readAuthText(request);
    if (typeof text !== 'string') return text;
    return blank && !text.trim() ? blank : JSON.parse(text) as unknown;
  } catch { return undefined; }
}

type Minted = { id: string; token: string; expiresIn: number; has_created_document: boolean };

/** The access token a grant stands for: a group's sign-in through the guarded mint, else the person's own through the app. */
export async function mintFor(o: OAuthRoutesOptions, request: Request, grant: { userId: string | null; resource: string; scope: string; terminal?: boolean; group?: (GrantGroup & { issuedBy: string }) | null }): Promise<Minted> {
  if (grant.group) {
    // A group's sign-in: the identity store's guarded mint, for the person who authorised it, re-checked every time.
    if (!o.groupSignIns) throw new Error('group sign-ins unavailable');
    try {
      const minted = await o.groupSignIns.mint({ issuedBy: grant.group.issuedBy, groupId: grant.group.id, role: grant.group.role, audience: grant.resource, scope: grant.scope });
      return { id: minted.id, token: minted.token, expiresIn: ACCESS_TOKEN_TTL_SECONDS, has_created_document: false };
    } catch (error) { throw error instanceof IdentityError && error.status < 500 ? new GroupSignInRefused(error.code) : error; }
  }
  if (!grant.userId) throw new Error('Email account required');
  const identity = await o.sessions.identity?.(grant.userId);
  if (!identity?.email || !identity.emailVerified || identity.userId !== grant.userId) throw new Error('Verified email account required');
  if(o.admitIdentity&&!await o.admitIdentity(identity))throw new Error('Deployment admission required');
  const expiresIn = ACCESS_TOKEN_TTL_SECONDS;
  const payload = { expiresInHours: expiresIn / 3600, audience: grant.resource, scope: grant.scope, ...(grant.terminal ? { source: 'agent' } : {}) };
  // The INTERNAL mint: the app's only credential-issuing route, refused at
  // the edge (parts `internalBoundary`) and reached only here, on the upstream
  // seam, after a human approved this connection in the browser.
  const mint = new Request(new URL(INTERNAL_MINT_PATH, request.url), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const res = await o.upstream(mint, { credential: 'session', ...identity });
  if (!res.ok) throw new Error(`oauth exchange: the app refused the mint (${res.status})`);
  const body = await res.json().catch(() => null) as { id?: string; token?: string; has_created_document?: boolean } | null;
  if (!body?.id || !body.token || typeof body.has_created_document !== 'boolean') throw new Error('oauth exchange: the app minted no token');
  return { id: body.id, token: body.token, expiresIn, has_created_document: body.has_created_document };
}

/** A new grant: its access token (`mintFor`, a group's sign-in issued by `userId`) and a new refresh family for `clientId`. */
export async function issueGrant(o: OAuthRoutesOptions, request: Request, grant: { clientId: string; userId: string; resource: string; scope: string; sessionId?: string | null; terminal?: boolean; group: GrantGroup | null }): Promise<{ minted: Minted; refreshToken: string }> {
  const { clientId, userId, resource, scope, sessionId, terminal, group } = grant;
  const minted = await mintFor(o, request, { userId, resource, scope, terminal, group: group && { ...group, issuedBy: userId } });
  const refreshToken = await o.oauth.issueRefresh({ clientId, userId, resource, scope, accessTokenId: minted.id, sessionId: sessionId ?? null, terminal });
  return { minted, refreshToken };
}
