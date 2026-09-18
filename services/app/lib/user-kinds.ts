/**
 * WHAT A USER IS, read from the one column that says it.
 *
 * `users.kind` replaced the `is_guest` flag because a flag only has two values
 * and there are three kinds of person: an `account` (a signed-in person with an
 * email), a `guest` (an anonymous browser that saved something and may claim it
 * by logging in) and a `testuser` (a throwaway second person an account minted
 * to verify a multi-person app — see `lib/testusers`).
 *
 * This module is deliberately TINY and depends on nothing but the database, so
 * `lib/artifacts`, `lib/capabilities`, `lib/testusers` and the boot path can all
 * read the kind without an import cycle. It answers WHAT a user is; it never
 * decides what that user may DO — that is `lib/capabilities` and nowhere else.
 */
import type { Queryable, UserKind } from '@artifactbin/contracts';
import { getDb } from './db';

/**
 * The kind of one user, or null when there is no row at all.
 *
 * Null is NOT "an account": every caller here treats a missing row the way the
 * flag did — as an identity the product does not produce — and keeps whatever
 * polarity it already had rather than inventing a verdict for it.
 */
export async function userKindOf(userId: string | null | undefined, query?: Queryable): Promise<UserKind | null> {
  if (!userId) return null;
  const db = query ?? (await getDb());
  const row = await db.query<{ kind: UserKind }>('SELECT kind FROM users WHERE id = $1', [userId]);
  return row.rows[0]?.kind ?? null;
}

/** Is this user one of the kinds that reaches a stranger's document only through the LINK? */
export async function isLinkOnlyActor(userId: string | null | undefined, query?: Queryable): Promise<boolean> {
  const kind = await userKindOf(userId, query);
  return kind === 'guest' || kind === 'testuser';
}

/**
 * THE SANDBOX, in SQL: is this artifact owned by a test user?
 *
 * The one fact the reach predicates need about a ROW, spelled once so the
 * statement and `lib/capabilities` cannot disagree about what "inside the
 * sandbox" means. `artifacts` is the outer statement's table.
 */
export const SANDBOX_ROW_SQL =
  "EXISTS (SELECT 1 FROM users owner_user WHERE owner_user.id = artifacts.user_id AND owner_user.kind = 'testuser')";

/**
 * Whether an actor reaches a row through SHARES and the LINK at their full
 * role, rather than at the anonymous ceiling.
 *
 * An ACCOUNT does. A guest never does. A TEST USER does inside the sandbox —
 * toward artifacts another test user owns — and nowhere else, which is the
 * whole of "a full user in there, a guest out here".
 *
 * The polarity is the flag's: a `userId` with NO row keeps the reach it always
 * had, because a user id without a row is not a state the product produces and
 * refusing it here would be a silent behaviour change on a state nobody has.
 */
export const ACCOUNT_REACH_SQL = (param: string): string =>
  `(NOT EXISTS (SELECT 1 FROM users actor_user WHERE actor_user.id = ${param} AND actor_user.kind <> 'account')
    OR EXISTS (SELECT 1 FROM users actor_user WHERE actor_user.id = ${param} AND actor_user.kind = 'testuser' AND ${SANDBOX_ROW_SQL}))`;
