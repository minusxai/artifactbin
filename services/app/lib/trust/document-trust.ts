/**
 * WHO TRUSTS WHAT A DOCUMENT ASKS OF THE NETWORK.
 *
 * Every document runs under one default policy. A document that needs more declares it in its Helmet
 * (`<meta name="csp-connect" …>`, lib/story/document/csp-extensions). Each version's own source is its
 * declaration — nothing is copied beside it, because edits commit client-prepared patches and a copy
 * would drift. This module answers, per reader, which of those hosts are appended to the document's header:
 *
 *  - THE PUBLISHER of a host: whoever's publish introduced a host consented to it by publishing it. The
 *    introducer is derived from the version history: the actor of the earliest version in the unbroken
 *    run of versions, ending at the one being served, that declares the host. Nobody else is presumed,
 *    the document's owner included: an owner whose editor added a host is asked like any reader.
 *  - A reader who allowed the rest ONCE (this browser session only: a signed session cookie, never a
 *    row) or ALWAYS FOR THIS DOCUMENT (a `document_trust` row covering the set they were asked about).
 *  - Everyone else gets their own hosts only; the rest wait on the consent bar and the script's requests
 *    to them fail. A reader who said NEVER has a deny (a row, or a session entry when signed out), which
 *    the bar shows as a one-line note instead of asking again.
 *
 * A grant covers a SET of hosts on ONE document, never "anything": a republish that asks for more asks again.
 *
 * `cspExtensionsFor` is the serving hook (the document response appends what it answers);
 * `cspRequestFor` is what the app page tells the consent bar.
 */
import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { AUTH_SECRET, PUBLIC_BASE_URL } from '@/lib/platform/config';
import { getDb } from '@/lib/platform/db';
import { parseCookie } from '@/lib/http/http';
import type { ArtifactRow } from '@/lib/artifacts/access';
import { artifactQuery } from '@/lib/artifacts/document';
import { parseJsx } from '@/lib/jsx';
import { splitHelmet } from '@/lib/story/document/helmet';
import {
  CSP_DIRECTIVES, EMPTY_CSP_EXTENSIONS, coversCspExtensions, cspExtensionsOf, emptyCspExtensions, hasCspExtensions, mergeCspExtensions,
  storedCspExtensions, subtractCspExtensions, type CspExtensions, type CspRequest,
} from '@/lib/story/document/csp-extensions';

export type { CspExtensions, CspRequest } from '@/lib/story/document/csp-extensions';

/** Who is reading: an account, a token (a guest's publishes are its token's), or nobody. */
export interface TrustViewer {
  userId: string | null;
  tokenId?: string | null;
}

export interface TrustQuery {
  /** The row being served: its source declares the set, and its version is where the history walk starts. */
  artifact: Pick<ArtifactRow, 'id' | 'version' | 'source'>;
  viewer: TrustViewer | null;
  /** The reader's request, for this browser session's once-grants and denies. Absent ⇒ none consulted. */
  request?: Request;
}

/* ------------------------------------------------------------------ declarations and publishers */

/** A version's content never changes, so its declared set is cached by artifact and version. */
const declaredCache = new Map<string, CspExtensions>();
const DECLARED_CACHE_MAX = 2000;

/**
 * The hosts a source declares. Lenient by design: an edit is committed from a client-prepared patch the
 * server does not re-validate, so an origin the parser refuses is dropped rather than trusted.
 */
export function declaredCspExtensions(source: string | null | undefined): CspExtensions {
  if (!source || !source.includes('csp-')) return emptyCspExtensions();
  const parsed = parseJsx(source);
  if (!parsed.ok) return emptyCspExtensions();
  const split = splitHelmet(parsed.nodes);
  return cspExtensionsOf(split.content, split.helmet).extensions;
}

function declaredAt(id: string, version: number, source: string | null | undefined): CspExtensions {
  const key = `${id}@${version}`;
  const hit = declaredCache.get(key);
  if (hit) return hit;
  const declared = declaredCspExtensions(source);
  if (declaredCache.size >= DECLARED_CACHE_MAX) declaredCache.delete(declaredCache.keys().next().value!);
  declaredCache.set(key, declared);
  return declared;
}

/** An archived version's declared set, read from its own source (cached). */
async function archivedDeclared(id: string, version: number): Promise<CspExtensions> {
  const hit = declaredCache.get(`${id}@${version}`);
  if (hit) return hit;
  const db = await getDb();
  const row = (await artifactQuery<{ source?: string | null }>(db, 'SELECT source, document FROM artifact_versions WHERE artifact_id = $1 AND version = $2', [id, version])).rows[0];
  return declaredAt(id, version, row?.source ?? null);
}

interface VersionActor { version: number; userId: string | null; tokenId: string | null }

/** Who produced each version up to `version`, newest first (head row and archive; no content read). */
async function actorsUpTo(artifactId: string, version: number): Promise<VersionActor[]> {
  const db = await getDb();
  const result = await db.query<{ version: number; actor_user_id: string | null; actor_token_id: string | null }>(
    `SELECT version, actor_user_id, actor_token_id FROM artifacts WHERE id = $1 AND version <= $2
     UNION ALL
     SELECT version, actor_user_id, actor_token_id FROM artifact_versions WHERE artifact_id = $1 AND version <= $2
     ORDER BY version DESC`, [artifactId, version]);
  const seen = new Set<number>();
  return result.rows.filter((row) => !seen.has(Number(row.version)) && !!seen.add(Number(row.version)))
    .map((row) => ({ version: Number(row.version), userId: row.actor_user_id, tokenId: row.actor_token_id }));
}

const isActor = (version: VersionActor, viewer: TrustViewer): boolean =>
  (!!viewer.userId && version.userId === viewer.userId) || (!!viewer.tokenId && version.tokenId === viewer.tokenId);

/**
 * The hosts of `declared` (the served version's set) this viewer introduced. A host's introducer is the
 * actor of the earliest version in the unbroken run (consecutive version numbers, each declaring the
 * host) that ends at the served version. A gap in the history makes the introducer unknown, which
 * presumes nobody. A viewer who produced no version at all is answered from the actor list alone.
 */
export async function hostsPublishedBy(artifact: TrustQuery['artifact'], viewer: TrustViewer | null, declared: CspExtensions): Promise<CspExtensions> {
  const out = emptyCspExtensions();
  if (!viewer?.userId && !viewer?.tokenId) return out;
  const history = await actorsUpTo(artifact.id, artifact.version);
  if (history[0]?.version !== artifact.version || !history.some((at) => isActor(at, viewer))) return out;
  const setOf = async (i: number): Promise<CspExtensions> => i === 0 ? declared : archivedDeclared(artifact.id, history[i]!.version);
  for (const d of CSP_DIRECTIVES) for (const origin of declared[d]) {
    let introducer: VersionActor | null = null;
    for (let i = 0; i < history.length; i++) {
      const at = history[i]!;
      // A missing version might have been where the host arrived: unknown, so nobody is presumed.
      if (i > 0 && history[i - 1]!.version !== at.version + 1) { introducer = null; break; }
      if (!(await setOf(i))[d].includes(origin)) break;
      introducer = at;
    }
    if (introducer && isActor(introducer, viewer)) out[d].push(origin);
  }
  return out;
}

/* ------------------------------------------------------------------ session (the "once" grants) */

const SECURE_COOKIE = PUBLIC_BASE_URL.startsWith('https://');
/** `__Host-` when the cookie can be Secure: no subdomain can plant or overwrite it. */
export const TRUST_SESSION_COOKIE = SECURE_COOKIE ? '__Host-afbin_trust' : 'afbin_trust';
/** Most recent grants kept; older ones fall off (the cookie must stay small). */
const MAX_SESSION_ENTRIES = 24;

type Decision = 'allow' | 'deny';
interface SessionEntry { id: string; hash: string; decision: Decision }
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
export function sessionTrustCookie(request: Request, viewer: TrustViewer | null, artifactId: string, change: { hash: string; decision: Decision } | { decision: null }): string {
  const subject = subjectOf(viewer);
  const kept = readSession(request, subject).filter((entry) => entry.id !== artifactId);
  const entries = change.decision ? [...kept, { id: artifactId, hash: change.hash, decision: change.decision }] : kept;
  return sessionSetCookie({ subject, entries: entries.slice(-MAX_SESSION_ENTRIES) });
}

/* ------------------------------------------------------------------ rows (always for this document / never) */

async function rowFor(userId: string, artifactId: string): Promise<{ decision: Decision; extensions: CspExtensions } | null> {
  const db = await getDb();
  const result = await db.query<{ decision: string; extensions: unknown }>(
    'SELECT decision, extensions FROM document_trust WHERE user_id = $1 AND artifact_id = $2', [userId, artifactId]);
  const row = result.rows[0];
  if (!row) return null;
  return {
    decision: row.decision === 'deny' ? 'deny' : 'allow',
    extensions: storedCspExtensions(typeof row.extensions === 'string' ? JSON.parse(row.extensions) : row.extensions),
  };
}

/** Always for this document: the row covers this set from now on (a union with an earlier allow; a Never is replaced). */
export async function allowDocument(userId: string, artifactId: string, extensions: CspExtensions): Promise<void> {
  const db = await getDb();
  await db.transaction(async (tx) => {
    const held = await tx.query<{ extensions: unknown }>("SELECT extensions FROM document_trust WHERE user_id = $1 AND artifact_id = $2 AND decision = 'allow' FOR UPDATE", [userId, artifactId]);
    const previous = held.rows[0] ? storedCspExtensions(held.rows[0].extensions) : EMPTY_CSP_EXTENSIONS;
    await tx.query(
      `INSERT INTO document_trust (user_id, artifact_id, decision, extensions) VALUES ($1, $2, 'allow', $3::jsonb)
       ON CONFLICT (user_id, artifact_id) DO UPDATE SET decision = 'allow', extensions = EXCLUDED.extensions, created_at = now()`,
      [userId, artifactId, JSON.stringify(mergeCspExtensions(previous, extensions))]);
  });
}

/** Never for this document: a deny that covers the set it asks this reader about now. */
export async function denyDocument(userId: string, artifactId: string, extensions: CspExtensions): Promise<void> {
  const db = await getDb();
  await db.query(
    `INSERT INTO document_trust (user_id, artifact_id, decision, extensions) VALUES ($1, $2, 'deny', $3::jsonb)
     ON CONFLICT (user_id, artifact_id) DO UPDATE SET decision = 'deny', extensions = EXCLUDED.extensions, created_at = now()`,
    [userId, artifactId, JSON.stringify(extensions)]);
}

/** Forget this person's standing answer on this document. */
export async function revokeTrust(userId: string, artifactId: string): Promise<void> {
  const db = await getDb();
  await db.query('DELETE FROM document_trust WHERE user_id = $1 AND artifact_id = $2', [userId, artifactId]);
}

/* ------------------------------------------------------------------ the answers */

interface Standing { request: CspRequest; published: CspExtensions }

async function standingOf({ artifact, viewer, request }: TrustQuery): Promise<Standing> {
  const extensions = declaredAt(artifact.id, artifact.version, artifact.source);
  if (!hasCspExtensions(extensions)) return { request: { extensions, asking: emptyCspExtensions(), status: 'none', denied: false }, published: emptyCspExtensions() };
  const published = await hostsPublishedBy(artifact, viewer, extensions);
  const asking = subtractCspExtensions(extensions, published);
  const answered = (status: CspRequest['status'], denied = false): Standing =>
    ({ request: { extensions, asking: status === 'blocked' ? asking : emptyCspExtensions(), status, denied }, published });
  if (!hasCspExtensions(asking)) return answered('publisher');
  const session = readSession(request, subjectOf(viewer)).find((entry) => entry.id === artifact.id && entry.hash === extensionsHash(extensions));
  let denied = session?.decision === 'deny';
  let allowed = session?.decision === 'allow';
  if (viewer?.userId) {
    const row = await rowFor(viewer.userId, artifact.id);
    if (row && coversCspExtensions(row.extensions, asking)) {
      if (row.decision === 'deny') denied = true;
      else allowed = true;
    }
  }
  if (denied) return answered('blocked', true);
  return answered(allowed ? 'allowed' : 'blocked');
}

/** Where this reader stands on what this document asks for. */
export async function cspRequestFor(query: TrustQuery): Promise<CspRequest> {
  return (await standingOf(query)).request;
}

/**
 * THE SERVING HOOK: the origins to append to this document's policy for this reader — every declared
 * host when they published them all or allowed the rest, otherwise only the hosts they published.
 */
export async function cspExtensionsFor(query: TrustQuery): Promise<CspExtensions> {
  const { request, published } = await standingOf(query);
  if (request.status === 'none') return EMPTY_CSP_EXTENSIONS;
  return request.status === 'publisher' || request.status === 'allowed' ? request.extensions : published;
}
