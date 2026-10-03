/**
 * GET|POST|DELETE /api/trust → `{ cspRequest }` — a reader's answer to what a document asks of the
 * network beyond the default policy (lib/trust/document-trust).
 *
 *   GET    ?artifactId=<id>                                   where this reader stands
 *   POST   { artifactId, grant: 'once' | 'author' | 'never' }  allow for this browser session, always
 *                                                            for this document's author, or never
 *   DELETE { artifactId, scope?: 'document' | 'author' }     forget this reader's choice (default: on
 *                                                            this document, session included)
 *
 * A browser door, ridden by cookies, so cookie-borne writes are same-site only (`refusesCrossSite`).
 * The document must be READABLE by whoever asks: an unreadable one and a missing one are the same 404.
 * "Once" lives in the browser session (a signed session cookie), so any reader may use it; Always and
 * a stored Never belong to an account (401 otherwise) — a signed-out Never is kept for the session.
 */
import { canReadArtifact, getArtifactById, type ArtifactRow } from '@/lib/artifacts';
import { refusesCrossSite, sessionActor, type RequestActor } from '@/lib/accounts';
import { json, readJson, unauthorized } from '@/lib/http';
import { ID_RE } from '@/lib/platform';
import { hasCspExtensions, storedCspExtensions } from '@/lib/story/document/csp-extensions';
import {
  allowAuthor, authorScope, cspRequestFor, denyDocument, documentScope, extensionsHash, revokeTrust, sessionTrustCookie,
  type TrustViewer,
} from '@/lib/trust/document-trust';

const NO_STORE = { 'Cache-Control': 'no-store' };
const GRANTS = ['once', 'author', 'never'] as const;
const SCOPES = ['document', 'author'] as const;

/** Who is asking about which readable document — or the Response that refuses them. */
async function opened(request: Request, artifactId: unknown): Promise<{ artifact: ArtifactRow; actor: RequestActor; viewer: TrustViewer } | Response> {
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
  const extensions = storedCspExtensions(artifact.meta);
  if (!hasCspExtensions(extensions)) return json({ error: 'nothing_to_trust', details: ['this document asks for nothing beyond the default policy'] }, 400);
  const userId = actor.viewer?.userId ?? null;
  const hash = extensionsHash(extensions);
  if (grant === 'once') return answer(request, artifact, viewer, sessionTrustCookie(request, viewer, artifact.id, { hash, decision: 'allow' }));
  if (grant === 'never' && !userId) return answer(request, artifact, viewer, sessionTrustCookie(request, viewer, artifact.id, { hash, decision: 'deny' }));
  if (!userId) return unauthorized(request);
  if (grant === 'author') {
    if (!artifact.user_id) return json({ error: 'no_author', details: ['this document has no author account to trust'] }, 400);
    await allowAuthor(userId, artifact.user_id, artifact.id, extensions);
  } else {
    await denyDocument(userId, artifact.id, extensions);
  }
  // The stored choice supersedes whatever this session said about the document.
  return answer(request, artifact, viewer, sessionTrustCookie(request, viewer, artifact.id, { decision: null }));
}

export async function DELETE(request: Request): Promise<Response> {
  const body = await readJson(request);
  const opening = await opened(request, body?.artifactId);
  if (opening instanceof Response) return opening;
  const { artifact, actor, viewer } = opening;
  const scope = body?.scope ?? 'document';
  if (!SCOPES.includes(scope as never)) return json({ error: 'invalid_scope', allowed: SCOPES }, 400);
  const userId = actor.viewer?.userId ?? null;
  if (scope === 'author') {
    if (!userId) return unauthorized(request);
    if (artifact.user_id) await revokeTrust(userId, [authorScope(artifact.user_id)]);
    return answer(request, artifact, viewer);
  }
  if (userId) await revokeTrust(userId, [documentScope(artifact.id)]);
  return answer(request, artifact, viewer, sessionTrustCookie(request, viewer, artifact.id, { decision: null }));
}
