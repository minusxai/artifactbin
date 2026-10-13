/**
 * THE PAGES SESSION — who a document's own origin is serving (APP__PAGES_HOST, server/pages-host).
 *
 * A document framed on `<hex(id)>.<pages host>` cannot see the app's session: it is a different
 * origin, and the authentication layer's cookie is the app host's alone. So the app page hands its
 * reader across in two steps, neither of which puts the session itself anywhere:
 *
 *  1. `issuePagesTicket(actor, …)` — while serving the app page, for the reader it just admitted: a
 *     random one-time code (a `codes` row, kind `pages_ticket`, 60 s) whose payload is that reader's
 *     actor snapshot AND the one document it is for (its id and its exact origin). The page puts it in the
 *     frame's first URL, on the document's own origin.
 *  2. `exchangePagesTicket(ticket, binding)` — on that document origin, before a byte of the document is
 *     produced: the code is CLAIMED (deleted on read, so it is single-use across every process sharing the
 *     database), a ticket minted for another document or origin is refused, and a `pages_sessions` row bound
 *     to this document is written for a new random cookie value. Only that value's sha256 is stored. The
 *     reader is resolved again at the exchange, so a token revoked since the page was served never renders.
 *
 * The cookie is the document origin's alone (host-only): `pagesSessionOf(cookie, …, { artifactId })` accepts a
 * session only for the document it was minted for. `endPagesSession(cookie)` ends one; `endPagesSessionsFor`
 * is logout's half, ending every session of a reader.
 *
 * A guest (nobody signed in, no agent cookie) gets a ticket only when the app page has something to carry for them
 * (an "Allow once" grant): its session is NOBODY's (`credential: 'none'`, the doors read it as anonymous) and holds
 * only what was carried.
 */
import crypto from 'node:crypto';
import { createCodeStore } from '@artifactbin/utils';
import { ANONYMOUS, type Actor } from '@artifactbin/contracts';
import { getDb } from '../platform/db';
import { resolveTokenById, sha256 } from './tokens';
import type { AccessActor, RequestIdentity } from './actors';
import { canAuthenticateUser } from './user-kinds';

/** How long a ticket is good for: the frame loads it at once. */
const PAGES_TICKET_TTL_MS = 60_000;
/** How long a pages session lives; every framed load mints a fresh one. */
const PAGES_SESSION_TTL_MS = 8 * 60 * 60 * 1000;
const TICKET_KIND = 'pages_ticket';

/** The one document a ticket (and the session it buys) is for: its id and its exact origin. */
export interface PagesBinding { artifactId: string; origin: string }

interface ActorSnapshot { credential: 'session' | 'agent-cookie' | 'none'; userId: string | null; tokenId: string | null; email: string | null; emailVerified: boolean | null }
/** A guest's snapshot: nobody, there only to carry the app page's decisions across. */
const NOBODY: ActorSnapshot = { credential: 'none', userId: null, tokenId: null, email: null, emailVerified: null };
const CREDENTIALS: ReadonlySet<unknown> = new Set(['session', 'agent-cookie', 'none']);

const randomSecret = (bytes: number): string => crypto.randomBytes(bytes).toString('base64url');
const codes = async () => createCodeStore(await getDb());

/**
 * A pages session carries an email account session or a trusted scripted browser's account token.
 * One browser reads as a bearer: a browser SESSION's scripted browser (`BROWSER_SESSION_HEADER` on a request
 * the trusted session transport attached its actor to, lib/accounts/request-identity `isBrowserSessionRequest`). It is
 * a browser holding a token, so its pages session is exactly that: an agent cookie for that token.
 */
function snapshotOf(actor: RequestIdentity, browserSession: boolean): ActorSnapshot | null {
  const credential = actor.credential === 'session' ? actor.credential
    : actor.credential === 'bearer' && browserSession && actor.tokenId ? 'agent-cookie' : null;
  if (!credential) return null;
  if (!actor.userId && !actor.tokenId) return null;
  // The CLAIM is stored, never the grant it earned: the document origin re-resolves it per request.
  return { credential, userId: actor.userId, tokenId: actor.tokenId, email: actor.email, emailVerified: actor.emailVerified };
}

/**
 * App-origin decisions the app page hands across with its reader (`carried`): what only the app origin
 * can read — a one-time consent grant in an app-origin cookie — reaches the document's own origin
 * through the pages session (`pagesSessionOf(...).carried`, server/pages-host's request mark). JSON data
 * only; never a credential.
 */
export type PagesCarried = Readonly<Record<string, unknown>>;

/**
 * A one-time ticket for this reader and this document, or null when there is nothing to hand across (a guest the app
 * page carries nothing for). A guest with something carried gets a ticket for nobody (`credential: 'none'`).
 * `browserSession` says the app page is being served to a browser session's scripted browser (see `snapshotOf`).
 */
export async function issuePagesTicket(actor: RequestIdentity, carried: PagesCarried = {}, now = Date.now(), options: { browserSession?: boolean } & PagesBinding): Promise<string | null> {
  const nobody = !actor.userId && !actor.tokenId;
  const snapshot = snapshotOf(actor, options.browserSession === true) ?? (nobody && Object.keys(carried).length ? NOBODY : null);
  if (!snapshot || (snapshot.credential !== 'none' && !await canAuthenticateUser(snapshot.userId))) return null;
  const ticket = randomSecret(24);
  await (await codes()).issue({ kind: TICKET_KIND, secret: ticket, payload: { ...snapshot, carried: { ...carried }, artifactId: options.artifactId, origin: options.origin }, ttlMs: PAGES_TICKET_TTL_MS, now });
  return ticket;
}

/** A pages session as the document's origin reads it. */
export interface PagesSession { actor: Actor; carried: PagesCarried }

/**
 * Spend a ticket on the document origin it was minted for: the new session's cookie value and its reader, or null for
 * an unknown, spent, expired or foreign ticket (another document's, or the right id at another origin). The ticket is
 * consumed whichever it was, so a wrong guess or a replay can never be tried twice.
 */
export async function exchangePagesTicket(ticket: string, binding: PagesBinding, now = Date.now()): Promise<(PagesSession & { cookie: string }) | null> {
  if (!/^[A-Za-z0-9_-]{16,128}$/.test(ticket)) return null;
  const payload = await (await codes()).claimByHash({ kind: TICKET_KIND, code: ticket, now }) as (Partial<ActorSnapshot> & { carried?: PagesCarried; artifactId?: string; origin?: string }) | null;
  if (!payload || !CREDENTIALS.has(payload.credential)) return null;
  if (payload.artifactId !== binding.artifactId || payload.origin !== binding.origin) return null;
  // Nobody's session exists only to carry something: never an empty one.
  if (payload.credential === 'none' && !Object.keys(payload.carried ?? {}).length) return null;
  // The ticket is a snapshot up to a minute old: the reader is resolved again now, so a revoked token never renders once.
  const session = await readerOf({ credential: payload.credential as string, user_id: payload.userId ?? null, token_id: payload.tokenId ?? null, email: payload.email ?? null, email_verified: payload.emailVerified ?? null, carried: payload.carried ?? {} });
  if (!session) return null;
  const cookie = randomSecret(32);
  const db = await getDb();
  // Hygiene rides the write path, as the code store's does: no background job.
  await db.query('DELETE FROM pages_sessions WHERE expires_at < $1', [new Date(now).toISOString()]);
  await db.query(
    'INSERT INTO pages_sessions (id_hash, credential, user_id, token_id, email, email_verified, carried, artifact_id, expires_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)',
    [sha256(cookie), payload.credential, payload.userId ?? null, payload.tokenId ?? null, payload.email ?? null, payload.emailVerified ?? null, JSON.stringify(payload.carried ?? {}), binding.artifactId, new Date(now + PAGES_SESSION_TTL_MS).toISOString()],
  );
  return { cookie, ...session };
}

/** The reader a pages cookie names for this document, as the actor the doors read — or null (no row, expired, its token revoked, a guest's, another document's). */
export async function pagesSessionActor(cookie: string | null | undefined, artifactId: string, now = Date.now()): Promise<Actor | null> {
  const actor = (await pagesSessionOf(cookie, now, artifactId))?.actor;
  return actor && actor.credential !== 'none' ? actor : null;
}

/**
 * The pages session a cookie names for this document: its reader (ANONYMOUS for a guest's) and what the app page
 * carried across — or null. A session is the one document's it was minted for; presented anywhere else it names nobody.
 */
export async function pagesSessionOf(cookie: string | null | undefined, now = Date.now(), artifactId?: string): Promise<PagesSession | null> {
  if (!cookie || !/^[A-Za-z0-9_-]{16,128}$/.test(cookie)) return null;
  const db = await getDb();
  const row = (await db.query<{ credential: string; user_id: string | null; token_id: string | null; email: string | null; email_verified: boolean | null; carried: unknown; artifact_id: string | null }>(
    'SELECT credential, user_id, token_id, email, email_verified, carried, artifact_id FROM pages_sessions WHERE id_hash = $1 AND expires_at > $2',
    [sha256(cookie), new Date(now).toISOString()],
  )).rows[0];
  if (!row || !CREDENTIALS.has(row.credential)) return null;
  if (artifactId !== undefined && row.artifact_id !== artifactId) return null;
  return readerOf(row);
}

interface SessionRow { credential: string; user_id: string | null; token_id: string | null; email: string | null; email_verified: boolean | null; carried: unknown }

/** The reader a stored session names, as of now: nobody for a guest's, null when its account or token no longer stands. */
async function readerOf(row: SessionRow): Promise<PagesSession | null> {
  const carried = typeof row.carried === 'string' ? JSON.parse(row.carried) as unknown : row.carried;
  const held: PagesCarried = carried && typeof carried === 'object' && !Array.isArray(carried) ? carried as PagesCarried : {};
  if (row.credential === 'none') return { actor: ANONYMOUS, carried: held };
  if (!await canAuthenticateUser(row.user_id)) return null;
  if (row.token_id) {
    const token = await resolveTokenById(row.token_id);
    if (!token || (token.userId ?? null) !== (row.user_id ?? token.userId ?? null)) return null;
  }
  return {
    actor: {
      credential: row.credential as 'session' | 'agent-cookie',
      ...(row.user_id ? { userId: row.user_id } : {}),
      ...(row.token_id ? { tokenId: row.token_id } : {}),
      ...(row.email ? { email: row.email } : {}),
      ...(row.email_verified !== null ? { emailVerified: row.email_verified } : {}),
    },
    carried: held,
  };
}

/** The session behind this cookie is gone (a guest frame, or a new session replacing it). */
export async function endPagesSession(cookie: string | null | undefined): Promise<void> {
  if (!cookie || !/^[A-Za-z0-9_-]{16,128}$/.test(cookie)) return;
  const db = await getDb();
  await db.query('DELETE FROM pages_sessions WHERE id_hash = $1', [sha256(cookie)]);
}

/**
 * Logout's half: every pages session of this reader — whatever cookies their browsers still hold — is gone. A cookie
 * left behind names no row, so it reads as nobody.
 */
export async function endPagesSessionsFor(reader: AccessActor): Promise<void> {
  const db = await getDb();
  if (reader.userId) await db.query('DELETE FROM pages_sessions WHERE user_id = $1', [reader.userId]);
  if (reader.tokenId) await db.query('DELETE FROM pages_sessions WHERE token_id = $1', [reader.tokenId]);
}
