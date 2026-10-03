/**
 * GET|POST|DELETE /api/trust → `{ cspRequest }` — a reader's answer to what a document asks of the
 * network beyond the default policy (lib/trust/document-trust).
 *
 *   GET    ?artifactId=<id>                                     where this reader stands
 *   POST   { artifactId, grant: 'once' | 'document' | 'never' } allow for this browser session, always
 *                                                              for this document, or never
 *   DELETE { artifactId }                                       forget this reader's answer on this
 *                                                              document, the session's included
 *
 * The document must be READABLE by whoever asks: an unreadable one and a missing one are the same 404.
 * "Once" lives in the browser session (a signed session cookie), so any reader may use it; "Always for
 * this document" and a stored Never belong to an account (401 otherwise) — a signed-out Never is kept
 * for the session. Every answer covers the hosts the reader is ASKED about: the ones they did not
 * publish themselves.
 *
 * A browser door, and its writes are SAME-ORIGIN only, whatever the credential: a write that mints a
 * grant must come from the app's own page, never from another site (a signed-out reader would otherwise
 * be pre-consented by a cross-site form post that arrives cookie-less) and never from a same-site
 * document origin (a framed document's script must not be able to consent on its reader's behalf).
 * Writes are JSON only, so a cross-origin caller cannot send one without a preflight.
 * The document must be READABLE by whoever asks: an unreadable one and a missing one are the same 404.
 * "Once" lives in the browser session (a signed session cookie), so any reader may use it; Always and
 * a stored Never belong to an account (401 otherwise) — a signed-out Never is kept for the session.
 */
import { canReadArtifact, getArtifactById, type ArtifactRow } from '@/lib/artifacts';
import { refusesCrossSite, sessionActor, type RequestActor } from '@/lib/accounts';
import { isCrossSiteRequest, json, readJson, unauthorized } from '@/lib/http';
import { ID_RE } from '@/lib/platform';
import { subtractCspExtensions } from '@/lib/story/document/csp-extensions';
import {
  allowDocument, cspRequestFor, denyDocument, extensionsHash, hostsPublishedBy, revokeTrust, sessionTrustCookie, type TrustViewer,
} from '@/lib/trust/document-trust';

const NO_STORE = { 'Cache-Control': 'no-store' };
const GRANTS = ['once', 'document', 'never'] as const;

/** Who is asking about which readable document — or the Response that refuses them. */
/** A write from anywhere but the app's own page: another site, or a same-site sibling origin. */
function foreignWrite(request: Request): boolean {
  if (request.method === 'GET' || request.method === 'HEAD') return false;
  const site = request.headers.get('sec-fetch-site');
  return site ? site !== 'same-origin' : isCrossSiteRequest(request);
}

async function opened(request: Request, artifactId: unknown): Promise<{ artifact: ArtifactRow; actor: RequestActor; viewer: TrustViewer } | Response> {
  if (foreignWrite(request)) return json({ error: 'forbidden' }, 403);
  if (request.method !== 'GET' && !(request.headers.get('content-type') ?? '').toLowerCase().startsWith('application/json')) return json({ error: 'unsupported_media_type' }, 415);
  const actor = await sessionActor(request);
  if (refusesCrossSite(request, actor)) return json({ error: 'forbidden' }, 403);
  if (typeof artifactId !== 'string' || !ID_RE.test(artifactId)) return json({ error: 'invalid_artifact_id' }, 400);
  const artifact = await getArtifactById(artifactId);
  if (!artifact || artifact.format !== 'markup' || !(actor.tokenId === artifact.token_id || (await canReadArtifact(artifact, actor.viewer)))) return json({ error: 'not_found' }, 404);
  return { artifact, actor, viewer: { userId: actor.viewer?.userId ?? null, tokenId: actor.tokenId } };
}

async function answer(request: Request, artifact: ArtifactRow, viewer: TrustViewer, setCookie?: string): Promise<Response> {
  // The reply describes the state the cookie just set, so read it as the next request will.
  const next = setCookie ? withCookie(request, setCookie) : request;
  const cspRequest = await cspRequestFor({ artifact, viewer, request: next });
  return json({ cspRequest }, 200, { ...NO_STORE, ...(setCookie ? { 'Set-Cookie': setCookie } : {}) });
}

/** The request as it will look once the browser stores `setCookie` (for the reply's own answer). */
function withCookie(request: Request, setCookie: string): Request {
  const pair = setCookie.split(';')[0]!;
  const name = pair.slice(0, pair.indexOf('='));
  const others = (request.headers.get('cookie') ?? '').split(';').map((c) => c.trim()).filter((c) => c && !c.startsWith(`${name}=`));
  const headers = new Headers(request.headers);
  headers.set('cookie', [...others, pair].join('; '));
  return new Request(request.url, { headers });
}

export async function GET(request: Request): Promise<Response> {
  const opening = await opened(request, new URL(request.url).searchParams.get('artifactId'));
  if (opening instanceof Response) return opening;
  return answer(request, opening.artifact, opening.viewer);
}

export async function POST(request: Request): Promise<Response> {
  const body = await readJson(request);
  const opening = await opened(request, body?.artifactId);
  if (opening instanceof Response) return opening;
  const { artifact, actor, viewer } = opening;
  const grant = body?.grant;
  if (!GRANTS.includes(grant as never)) return json({ error: 'invalid_grant', allowed: GRANTS }, 400);
  const standing = await cspRequestFor({ artifact, viewer, request });
  if (standing.status === 'none') return json({ error: 'nothing_to_trust', details: ['this document asks for nothing beyond the default policy'] }, 400);
  if (standing.status === 'publisher') return answer(request, artifact, viewer);
  // What the reader was asked about: the declared hosts minus their own (re-derived, never sent by the client).
  const asked = subtractCspExtensions(standing.extensions, await hostsPublishedBy(artifact, viewer, standing.extensions));
  const userId = actor.viewer?.userId ?? null;
  const hash = extensionsHash(standing.extensions);
  if (grant === 'once') return answer(request, artifact, viewer, sessionTrustCookie(request, viewer, artifact.id, { hash, decision: 'allow' }));
  if (grant === 'never' && !userId) return answer(request, artifact, viewer, sessionTrustCookie(request, viewer, artifact.id, { hash, decision: 'deny' }));
  if (!userId) return unauthorized(request);
  if (grant === 'document') await allowDocument(userId, artifact.id, asked);
  else await denyDocument(userId, artifact.id, asked);
  // The stored answer supersedes whatever this session said about the document.
  return answer(request, artifact, viewer, sessionTrustCookie(request, viewer, artifact.id, { decision: null }));
}

export async function DELETE(request: Request): Promise<Response> {
  const body = await readJson(request);
  const opening = await opened(request, body?.artifactId);
  if (opening instanceof Response) return opening;
  const { artifact, actor, viewer } = opening;
  const userId = actor.viewer?.userId ?? null;
  if (userId) await revokeTrust(userId, artifact.id);
  return answer(request, artifact, viewer, sessionTrustCookie(request, viewer, artifact.id, { decision: null }));
}
