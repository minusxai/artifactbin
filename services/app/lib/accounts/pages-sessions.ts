/**
 * THE PAGES SESSION — who a document's own origin is serving (APP__PAGES_HOST, server/pages-host).
 *
 * A document framed on `<hex(id)>.<pages host>` cannot see the app's session: it is a different
 * origin, and the authentication layer's cookie is the app host's alone. So the app page hands its
 * reader across in two steps, neither of which puts the session itself anywhere:
 *
 *  1. `issuePagesTicket(actor)` — while serving the app page, for the reader it just admitted: a
 *     random one-time code (a `codes` row, kind `pages_ticket`, 60 s) whose payload is that reader's
 *     actor snapshot. The page puts it in the frame's first URL.
 *  2. `exchangePagesTicket(ticket)` — on the pages apex: the code is CLAIMED (deleted on read, so it
 *     is single-use across every process sharing the database) and a `pages_sessions` row is written
 *     for a new random cookie value. Only that value's sha256 is stored.
 *
 * `pagesSessionActor(cookie)` reads the reader back for a document door; a token behind the session is
 * re-resolved, so a revoked token ends it at once. `endPagesSession(cookie)` is logout's half.
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
import type { RequestActor } from './viewer';

/** The cookie the documents' doors read the reader from (`Domain=.<pages host>`, HttpOnly). */
export const PAGES_COOKIE = 'afbin_pages';
/** How long a ticket is good for: the frame loads it at once. */
export const PAGES_TICKET_TTL_MS = 60_000;
/** How long a pages session lives; every framed load mints a fresh one. */
export const PAGES_SESSION_TTL_MS = 8 * 60 * 60 * 1000;
const TICKET_KIND = 'pages_ticket';

interface ActorSnapshot { credential: 'session' | 'agent-cookie' | 'none'; userId: string | null; tokenId: string | null; email: string | null; emailVerified: boolean | null }
/** A guest's snapshot: nobody, there only to carry the app page's decisions across. */
const NOBODY: ActorSnapshot = { credential: 'none', userId: null, tokenId: null, email: null, emailVerified: null };
const CREDENTIALS: ReadonlySet<unknown> = new Set(['session', 'agent-cookie', 'none']);

const randomSecret = (bytes: number): string => crypto.randomBytes(bytes).toString('base64url');
const codes = async () => createCodeStore(await getDb());

/**
 * The browser credentials a pages session may carry: an account session or an agent cookie — never a bearer.
 * One browser reads as a bearer: a browser SESSION's scripted browser (`BROWSER_SESSION_HEADER` on a request
 * the trusted session transport attached its actor to, lib/accounts/viewer `isBrowserSessionRequest`). It is
 * a browser holding a token, so its pages session is exactly that: an agent cookie for that token.
 */
function snapshotOf(actor: RequestActor, browserSession: boolean): ActorSnapshot | null {
  const credential = actor.credential === 'session' || actor.credential === 'agent-cookie' ? actor.credential
    : actor.credential === 'bearer' && browserSession && actor.tokenId ? 'agent-cookie' : null;
  if (!credential) return null;
  if (!actor.viewer?.userId && !actor.tokenId) return null;
  return {
    credential,
    userId: actor.viewer?.userId ?? null,
    tokenId: actor.tokenId ?? null,
    email: actor.viewer?.email ?? null,
    emailVerified: actor.viewer && 'emailVerified' in actor.viewer && typeof actor.viewer.emailVerified === 'boolean' ? actor.viewer.emailVerified : null,
  };
}

/**
 * App-origin decisions the app page hands across with its reader (`carried`): what only the app origin
 * can read — a one-time consent grant in an app-origin cookie — reaches the document's own origin
 * through the pages session (`pagesSessionOf(...).carried`, server/pages-host's request mark). JSON data
 * only; never a credential.
 */
export type PagesCarried = Readonly<Record<string, unknown>>;

/**
 * A one-time ticket for this reader, or null when there is nothing to hand across (a guest the app page carries
 * nothing for). A guest with something carried gets a ticket for nobody (`credential: 'none'`). `browserSession`
 * says the app page is being served to a browser session's scripted browser (see `snapshotOf`).
 */
export async function issuePagesTicket(actor: RequestActor, carried: PagesCarried = {}, now = Date.now(), options: { browserSession?: boolean } = {}): Promise<string | null> {
  const nobody = !actor.viewer?.userId && !actor.tokenId;
  const snapshot = snapshotOf(actor, options.browserSession === true) ?? (nobody && Object.keys(carried).length ? NOBODY : null);
  if (!snapshot) return null;
  const ticket = randomSecret(24);
  await (await codes()).issue({ kind: TICKET_KIND, secret: ticket, payload: { ...snapshot, carried: { ...carried } }, ttlMs: PAGES_TICKET_TTL_MS, now });
  return ticket;
}

/** Spend a ticket: a new pages session's cookie value, or null for an unknown, spent or expired ticket. */
export async function exchangePagesTicket(ticket: string, now = Date.now()): Promise<{ cookie: string; maxAgeSeconds: number } | null> {
  if (!/^[A-Za-z0-9_-]{16,128}$/.test(ticket)) return null;
  const payload = await (await codes()).claimByHash({ kind: TICKET_KIND, code: ticket, now }) as (Partial<ActorSnapshot> & { carried?: PagesCarried }) | null;
  if (!payload || !CREDENTIALS.has(payload.credential)) return null;
  // Nobody's session exists only to carry something: never an empty one.
  if (payload.credential === 'none' && !Object.keys(payload.carried ?? {}).length) return null;
  const cookie = randomSecret(32);
  const db = await getDb();
  // Hygiene rides the write path, as the code store's does: no background job.
  await db.query('DELETE FROM pages_sessions WHERE expires_at < $1', [new Date(now).toISOString()]);
  await db.query(
    'INSERT INTO pages_sessions (id_hash, credential, user_id, token_id, email, email_verified, carried, expires_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)',
    [sha256(cookie), payload.credential, payload.userId ?? null, payload.tokenId ?? null, payload.email ?? null, payload.emailVerified ?? null, JSON.stringify(payload.carried ?? {}), new Date(now + PAGES_SESSION_TTL_MS).toISOString()],
  );
  return { cookie, maxAgeSeconds: Math.floor(PAGES_SESSION_TTL_MS / 1000) };
}

/** The reader a pages cookie names, as the actor the doors read — or null (no row, expired, its token revoked, a guest's). */
export async function pagesSessionActor(cookie: string | null | undefined, now = Date.now()): Promise<Actor | null> {
  const actor = (await pagesSessionOf(cookie, now))?.actor;
  return actor && actor.credential !== 'none' ? actor : null;
}

/** The pages session a cookie names: its reader (ANONYMOUS for a guest's) and what the app page carried across — or null. */
export async function pagesSessionOf(cookie: string | null | undefined, now = Date.now()): Promise<{ actor: Actor; carried: PagesCarried } | null> {
  if (!cookie || !/^[A-Za-z0-9_-]{16,128}$/.test(cookie)) return null;
  const db = await getDb();
  const row = (await db.query<{ credential: string; user_id: string | null; token_id: string | null; email: string | null; email_verified: boolean | null; carried: unknown }>(
    'SELECT credential, user_id, token_id, email, email_verified, carried FROM pages_sessions WHERE id_hash = $1 AND expires_at > $2',
    [sha256(cookie), new Date(now).toISOString()],
  )).rows[0];
  if (!row || !CREDENTIALS.has(row.credential)) return null;
  const carried = typeof row.carried === 'string' ? JSON.parse(row.carried) as unknown : row.carried;
  const held: PagesCarried = carried && typeof carried === 'object' && !Array.isArray(carried) ? carried as PagesCarried : {};
  if (row.credential === 'none') return { actor: ANONYMOUS, carried: held };
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

/** Logout's half: the session behind this cookie is gone. */
export async function endPagesSession(cookie: string | null | undefined): Promise<void> {
  if (!cookie || !/^[A-Za-z0-9_-]{16,128}$/.test(cookie)) return;
  const db = await getDb();
  await db.query('DELETE FROM pages_sessions WHERE id_hash = $1', [sha256(cookie)]);
}
