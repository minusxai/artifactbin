/**
 * WHICH LIVE BROWSER SESSIONS ARE BROWSING AS A TEST USER.
 *
 * An erase must end the sessions that browse as the person being erased —
 * otherwise a page keeps a live token in a worker that nothing can reach any
 * more. The session service holds its sessions IN MEMORY, per process
 * (`services/browser/src/sessions.ts`), so this register has exactly the same
 * lifetime as the thing it names: a restart loses both together, and there is
 * no row to go stale. That is why it is a map and not a table — the retired
 * `browser_test_users` table was a durable record of an ephemeral fact.
 *
 * It is bookkeeping, never authorization: who may name a test user is
 * `lib/testusers resolveTestUser`, and what that user may do is
 * `lib/capabilities`.
 */
import type { Actor } from '@artifactbin/contracts';
import { services } from './services';

/** testuser userId → session ids, each with the OWNER's actor, which is what may close it. */
const live = new Map<string, Map<string, Actor>>();

/** Remember that this session's pages browse as this test user. */
export function noteTestUserSession(testUserId: string, sessionId: string, owner: Actor): void {
  const sessions = live.get(testUserId) ?? new Map<string, Actor>();
  sessions.set(sessionId, owner);
  live.set(testUserId, sessions);
}

/** Forget one session — it closed, or it was never created. */
export function forgetTestUserSession(testUserId: string, sessionId: string): void {
  const sessions = live.get(testUserId);
  if (!sessions) return;
  sessions.delete(sessionId);
  if (!sessions.size) live.delete(testUserId);
}

/** How many sessions this test user is browsing in right now — the `sessions` count on the wire. */
export const testUserSessionCount = (testUserId: string): number => live.get(testUserId)?.size ?? 0;

/**
 * Close every session browsing as this test user, through the session service
 * that owns them. Best effort by design: a service that is down must not make a
 * delete fail, because the alternative is a `users` row nobody can remove.
 */
export async function closeTestUserSessions(testUserId: string): Promise<void> {
  const sessions = live.get(testUserId);
  if (!sessions) return;
  live.delete(testUserId);
  const service = services().browser.sessions;
  for (const [sessionId, owner] of sessions) {
    try {
      await service?.request({ op: 'close', session_id: sessionId, actor: owner });
    } catch {
      // The identity is going away regardless; a worker that outlives it holds
      // a token this same erase revokes.
    }
  }
}
