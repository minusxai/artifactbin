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
 * keys on. The row is created LAZILY on the first session sight (there is no
 * boot-time sync): one identity, one row, ids agreeing by construction.
 */
import { getDb } from './db';
import { ensureUsername } from './users';

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
      `INSERT INTO users (id, email) VALUES ($1, $2)
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
      throw new Error(
        `${email} already belongs to another id (${held.id}) — one address is one person; resolve which identity owns it before this one signs in again`,
      );
    }
    throw error;
  }
  writes++;
  const row = (await db.query<{ id: string; email: string; name: string | null; username: string | null; created_at: string }>('SELECT id, email, name, username, created_at FROM users WHERE id = $1', [claims.userId])).rows[0];
  if (row && !row.username) await ensureUsername(row as Parameters<typeof ensureUsername>[0]);
  seen.set(claims.userId, hash);
  if (seen.size > LRU_MAX) seen.delete(seen.keys().next().value!);
}
