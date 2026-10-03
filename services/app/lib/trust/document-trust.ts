/**
 * WHO TRUSTS WHAT A DOCUMENT ASKS OF THE NETWORK.
 *
 * Every document runs under one default policy. A document that needs more declares it in its Helmet
 * (`<meta name="csp-connect" …>`, lib/story/document/csp-extensions), and the set is stored with its
 * content. This module answers, per reader, whether that set is appended to the document's header:
 *
 *  - the OWNER's own documents are trusted;
 *  - a reader who allowed it ONCE (this browser session only: a signed session cookie, never a row),
 *    ALWAYS FOR THIS AUTHOR (a `document_trust` row scoped `author:<user id>`), or
 *  - nobody else: the frame runs under the default policy and the script's foreign requests fail. A
 *    reader who said NEVER has a deny (a `document:<id>` row, or a session entry when signed out), which
 *    the consent bar shows as a one-line note instead of asking again.
 *
 * A grant covers a SET of origins, never "anything": a republish that asks for more asks again.
 *
 * `cspExtensionsFor` is the serving hook (the document response appends what it answers);
 * `cspRequestFor` is what the app page tells the consent bar.
 */
import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { AUTH_SECRET, PUBLIC_BASE_URL } from '@/lib/platform/config';
import { getDb } from '@/lib/platform/db';
import { parseCookie } from '@/lib/http/http';
import { ownsArtifact, type ArtifactRow } from '@/lib/artifacts/access';
import {
  CSP_DIRECTIVES, EMPTY_CSP_EXTENSIONS, coversCspExtensions, hasCspExtensions, mergeCspExtensions, storedCspExtensions,
  type CspExtensions, type CspRequest,
} from '@/lib/story/document/csp-extensions';

export type { CspExtensions, CspRequest } from '@/lib/story/document/csp-extensions';

/** Who is reading. A token id makes a guest owner its own document's owner (lib/artifacts ownsArtifact). */
export interface TrustViewer {
  userId: string | null;
  tokenId?: string | null;
}

export interface TrustQuery {
  artifact: Pick<ArtifactRow, 'id' | 'user_id' | 'token_id' | 'meta'>;
  viewer: TrustViewer | null;
  /** The reader's request, for this browser session's once-grants and denies. Absent ⇒ none consulted. */
  request?: Request;
}

/** The grant scopes a person can hold as rows. */
export const documentScope = (artifactId: string): string => `document:${artifactId}`;
export const authorScope = (userId: string): string => `author:${userId}`;

/* ------------------------------------------------------------------ session (the "once" grants) */

const SECURE_COOKIE = PUBLIC_BASE_URL.startsWith('https://');
/** `__Host-` when the cookie can be Secure: no subdomain can plant or overwrite it. */
export const TRUST_SESSION_COOKIE = SECURE_COOKIE ? '__Host-afbin_trust' : 'afbin_trust';
/** Most recent grants kept; older ones fall off (the cookie must stay small). */
const MAX_SESSION_ENTRIES = 24;

type SessionDecision = 'allow' | 'deny';
interface SessionEntry { id: string; hash: string; decision: SessionDecision }
interface SessionTrust { subject: string; entries: SessionEntry[] }

/** The set's identity: a once-grant covers exactly the set the reader saw. */
export function extensionsHash(extensions: CspExtensions): string {
  const canonical = CSP_DIRECTIVES.map((d) => [d, [...extensions[d]].sort()]);
  return createHash('sha256').update(JSON.stringify(canonical)).digest('hex').slice(0, 32);
}

/** Whose session entries these are: grants made signed out do not follow a sign-in, nor the reverse. */
const subjectOf = (viewer: TrustViewer | null): string => viewer?.userId ? `u:${viewer.userId}` : viewer?.tokenId ? `t:${viewer.tokenId}` : 'anon';

const sign = (payload: string): string => createHmac('sha256', AUTH_SECRET).update(`document-trust.${payload}`).digest('base64url');

function encodeSession(session: SessionTrust): string {
  const payload = Buffer.from(JSON.stringify({ s: session.subject, g: session.entries.map((e) => [e.id, e.hash, e.decision === 'deny' ? 'd' : 'a']) })).toString('base64url');
  return `${payload}.${sign(payload)}`;
}

/** Every failure (absent, tampered, foreign subject, wrong shape) is an empty session: fail closed. */
function readSession(request: Request | undefined, subject: string): SessionEntry[] {
  const value = request ? parseCookie(request.headers.get('cookie'), TRUST_SESSION_COOKIE) : undefined;
  if (!value) return [];
  const [payload, mac] = value.split('.');
  if (!payload || !mac) return [];
  const expected = Buffer.from(sign(payload));
  const given = Buffer.from(mac);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return [];
  try {
    const parsed = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as { s?: unknown; g?: unknown };
    if (parsed.s !== subject || !Array.isArray(parsed.g)) return [];
    return parsed.g.flatMap((entry): SessionEntry[] => Array.isArray(entry) && typeof entry[0] === 'string' && typeof entry[1] === 'string' && (entry[2] === 'a' || entry[2] === 'd')
      ? [{ id: entry[0], hash: entry[1], decision: entry[2] === 'd' ? 'deny' : 'allow' }] : []);
  } catch { return []; }
}

/** A session cookie: no Max-Age, so it ends with the browser session — "once" means exactly that. */
function sessionSetCookie(session: SessionTrust): string {
  const value = session.entries.length ? encodeSession(session) : '';
  return [`${TRUST_SESSION_COOKIE}=${value}`, 'Path=/', 'SameSite=Lax', 'HttpOnly', SECURE_COOKIE ? 'Secure' : '', session.entries.length ? '' : 'Max-Age=0']
    .filter(Boolean).join('; ');
}

/** The Set-Cookie value that records (or, with `decision: null`, forgets) this session's choice on one document. */
export function sessionTrustCookie(request: Request, viewer: TrustViewer | null, artifactId: string, change: { hash: string; decision: SessionDecision } | { decision: null }): string {
  const subject = subjectOf(viewer);
  const kept = readSession(request, subject).filter((entry) => entry.id !== artifactId);
  const entries = change.decision ? [...kept, { id: artifactId, hash: change.hash, decision: change.decision }] : kept;
  return sessionSetCookie({ subject, entries: entries.slice(-MAX_SESSION_ENTRIES) });
}

/* ------------------------------------------------------------------ rows (always / never) */

interface TrustRow { scope: string; decision: SessionDecision; extensions: CspExtensions }

async function rowsFor(userId: string, scopes: string[]): Promise<TrustRow[]> {
  const db = await getDb();
  const result = await db.query<{ scope: string; decision: string; extensions: unknown }>(
    'SELECT scope, decision, extensions FROM document_trust WHERE user_id = $1 AND scope = ANY($2::text[])', [userId, scopes]);
  return result.rows.map((row) => ({
    scope: row.scope,
    decision: row.decision === 'deny' ? 'deny' : 'allow',
    extensions: storedCspExtensions({ cspExtensions: typeof row.extensions === 'string' ? JSON.parse(row.extensions) : row.extensions }),
  }));
}

/** Always for this author: the author's row gains this set (a union — earlier grants stay), and any Never on this document goes. */
export async function allowAuthor(userId: string, authorId: string, artifactId: string, extensions: CspExtensions): Promise<void> {
  const db = await getDb();
  await db.transaction(async (tx) => {
    const held = await tx.query<{ extensions: unknown }>('SELECT extensions FROM document_trust WHERE user_id = $1 AND scope = $2 AND decision = \'allow\' FOR UPDATE', [userId, authorScope(authorId)]);
    const previous = held.rows[0] ? storedCspExtensions({ cspExtensions: held.rows[0].extensions }) : EMPTY_CSP_EXTENSIONS;
    const merged = mergeCspExtensions(previous, extensions);
    await tx.query(
      `INSERT INTO document_trust (user_id, scope, decision, extensions) VALUES ($1, $2, 'allow', $3::jsonb)
       ON CONFLICT (user_id, scope) DO UPDATE SET decision = 'allow', extensions = EXCLUDED.extensions, created_at = now()`,
      [userId, authorScope(authorId), JSON.stringify(merged)]);
    await tx.query('DELETE FROM document_trust WHERE user_id = $1 AND scope = $2', [userId, documentScope(artifactId)]);
  });
}

/** Never for this document: a deny that covers the set it asks for now. */
export async function denyDocument(userId: string, artifactId: string, extensions: CspExtensions): Promise<void> {
  const db = await getDb();
  await db.query(
    `INSERT INTO document_trust (user_id, scope, decision, extensions) VALUES ($1, $2, 'deny', $3::jsonb)
     ON CONFLICT (user_id, scope) DO UPDATE SET decision = 'deny', extensions = EXCLUDED.extensions, created_at = now()`,
    [userId, documentScope(artifactId), JSON.stringify(extensions)]);
}

/** Forget this person's choices on these scopes. */
export async function revokeTrust(userId: string, scopes: string[]): Promise<void> {
  const db = await getDb();
  await db.query('DELETE FROM document_trust WHERE user_id = $1 AND scope = ANY($2::text[])', [userId, scopes]);
}

/* ------------------------------------------------------------------ the answers */

/** Where this reader stands on what this document asks for. */
export async function cspRequestFor({ artifact, viewer, request }: TrustQuery): Promise<CspRequest> {
  const extensions = storedCspExtensions(artifact.meta);
  if (!hasCspExtensions(extensions)) return { extensions, status: 'none', denied: false };
  if (viewer && ownsArtifact(artifact, { userId: viewer.userId ?? null, tokenId: viewer.tokenId ?? null })) return { extensions, status: 'owner', denied: false };
  const hash = extensionsHash(extensions);
  const session = readSession(request, subjectOf(viewer)).find((entry) => entry.id === artifact.id && entry.hash === hash);
  let denied = session?.decision === 'deny';
  let allowed = session?.decision === 'allow';
  if (viewer?.userId) {
    const scopes = [documentScope(artifact.id), ...(artifact.user_id ? [authorScope(artifact.user_id)] : [])];
    for (const row of await rowsFor(viewer.userId, scopes)) {
      if (!coversCspExtensions(row.extensions, extensions)) continue;
      if (row.decision === 'deny') denied = true;
      else allowed = true;
    }
  }
  // A Never on this document outranks a broader Always: the narrower, later word is the reader's.
  if (denied) return { extensions, status: 'blocked', denied: true };
  return { extensions, status: allowed ? 'allowed' : 'blocked', denied: false };
}

/**
 * THE SERVING HOOK: the origins to append to this document's policy for this reader — the stored set
 * when they own the document or allowed it, nothing otherwise.
 */
export async function cspExtensionsFor(query: TrustQuery): Promise<CspExtensions> {
  const answer = await cspRequestFor(query);
  return answer.status === 'owner' || answer.status === 'allowed' ? answer.extensions : EMPTY_CSP_EXTENSIONS;
}
