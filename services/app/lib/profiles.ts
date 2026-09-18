/**
 * THE APP'S PROFILE ROW, FED FROM THE ACTOR'S CLAIMS.
 *
 * Identity lives with the proxy (Better Auth's `auth.user`); the app keeps its
 * own row per person in `users` — id, email, username, the product's view of
 * a person — and learns of them from the actor the proxy attaches to the
 * request, the way an identity-aware proxy's downstream always does (IAP,
 * Cloudflare Access, Clerk). ON CHANGE ONLY: an in-memory LRU of
 * `(userId → claimsHash)` means a logged-in reader's query hops never write,
 * and an email change reaches the row on the very next request. The user id
 * is the proxy's (`usr_…`) — the same value every artifact, share and token
 * keys on. The row is created LAZILY on the first sight of a credential that
 * CARRIES claims — a cookie session (lib/viewer proxyActor) or a bearer token
 * the proxy could name an account for (lib/viewer syncProfileForToken), since
 * a CLI-only person is a person too and `artifact_shares` is matched through
 * this row. There is no boot-time sync: one identity, one row, ids agreeing by
 * construction.
 */
import { getDb } from './db';
import { ensureUsername, getUserById } from './users';

/**
 * ONE ADDRESS, TWO IDS — the provisioning fault below, as a type callers can single out. A door that
 * wants the request to survive it (lib/viewer's bearer sync) must not survive a broken database as
 * well, and matching on the message text would make this module's wording load-bearing at a distance.
 */
export class DuplicateProfileEmail extends Error {}

const LRU_MAX = 5000;
const seen = new Map<string, string>();
let writes = 0;

/** Test hook: how many rows were written. */
export const profileWrites = (): number => writes;

export async function syncProfile(claims: { userId: string; email?: string }): Promise<void> {
  const email = claims.email?.trim().toLowerCase() ?? '';
  if (!email) return; // a session without an email claim has nothing to record
  const hash = email;
  if (seen.get(claims.userId) === hash) return;
  const db = await getDb();
  try {
    await db.query(
      // A NEW person starts with the welcome page pending; an existing row keeps
      // whatever it had (the conflict branch never touches the flag).
      `INSERT INTO users (id, email, welcome_pending) VALUES ($1, $2, true)
       ON CONFLICT (id) DO UPDATE SET email = EXCLUDED.email WHERE users.email IS DISTINCT FROM EXCLUDED.email`,
      [claims.userId, email],
    );
  } catch (error) {
    /*
     * The address is already someone's, under a different id — which means a
     * SECOND identity for one address, which the app's lazy upsert cannot
     * absorb (it would fork one person into two rows). Left raw, it surfaces
     * as `duplicate key value violates unique constraint "idx_users_email"`
     * on every authenticated request: the same outage, saying nothing about
     * what is wrong or what to do.
     */
    const held = (await db.query<{ id: string }>('SELECT id FROM users WHERE email = $1', [email])).rows[0];
    if (held && held.id !== claims.userId) {
      throw new DuplicateProfileEmail(
        `${email} already belongs to another id (${held.id}) — one address is one person; resolve which identity owns it before this one signs in again`,
      );
    }
    throw error;
  }
  writes++;
  // Every column `ensureUsername` decides by — `kind` included: a row read
  // without it reads as not-an-account and never gets its handle.
  const row = (await getUserById(claims.userId)) ?? null;
  if (row && !row.username) await ensureUsername(row);
  seen.set(claims.userId, hash);
  if (seen.size > LRU_MAX) seen.delete(seen.keys().next().value!);
}
