/**
 * TEST ACCOUNTS — the disposable accounts test-domain sign-in creates (contracts `test-domain`,
 * `TEST_DOMAIN` + `TEST_DOMAIN_OTP`), and the box they stay in.
 *
 * MARKING. `users.test_account` is set when the app first creates the row (lib/accounts/profiles) for an
 * address at exactly the test domain while the feature is on. Only the INSERT sets it: an existing row is
 * never marked, whatever its address, and a later cleanup can select exactly the marked rows. Cleanup of
 * test accounts and their artifacts is a follow-up; nothing here deletes anything.
 *
 * THE BOX. A test account is an ordinary `account` (kind) — it publishes, shares and comments like one —
 * but only among test accounts. Toward everyone else:
 *  - no custom domain (lib/serving/custom-domains);
 *  - named shares, artifact invitations and group invitations/members may name only test-domain
 *    addresses or test accounts (shareTargetsRefusal, lib/artifacts/membership, lib/groups);
 *  - on an artifact outside the test accounts' space (isTestOwned) it may read and fork, nothing
 *    else: no comment, like, share or `$_me` write (lib/artifacts/capabilities `can`), and it
 *    follows only test accounts;
 *  - nothing it does reaches a non-test person's notifications (lib/notifications/events).
 */
import { isTestDomainEmail, type Queryable, type ShareEntry } from '@artifactbin/contracts';
import { TEST_DOMAIN, getDb } from '../platform';
import type { AccessActor } from './actors';

/** The refusal code every boxed door answers with (403). */
export const TEST_ACCOUNT_RESTRICTED = 'test_account_restricted';

/** Is this address one test-domain sign-in creates accounts for? False whenever the feature is off. */
export const isTestDomainAddress = (email: string | null | undefined): boolean =>
  !!TEST_DOMAIN && !!email && isTestDomainEmail(email, TEST_DOMAIN);

/** Was this user's row created as a test account? A missing row or no id is not one. */
export async function isTestAccount(userId: string | null | undefined, query?: Queryable): Promise<boolean> {
  if (!userId) return false;
  const db = query ?? (await getDb());
  return (await db.query<{ test_account: boolean }>('SELECT test_account FROM users WHERE id = $1', [userId])).rows[0]?.test_account === true;
}

/**
 * Is this artifact inside the test accounts' space: owned by a test account, or by a group a test
 * account created (a test account can bring only test accounts into its groups)?
 */
export async function isTestOwned(row: { user_id: string | null; group_id?: string | null }, query?: Queryable): Promise<boolean> {
  if (row.user_id) return isTestAccount(row.user_id, query);
  if (!row.group_id) return false;
  const db = query ?? (await getDb());
  const creator = (await db.query<{ created_by: string }>('SELECT created_by FROM groups WHERE id = $1', [row.group_id])).rows[0]?.created_by;
  return isTestAccount(creator, query);
}

/**
 * May `actorId` direct something at `targetId` (an invitation, a membership, a notification)? Everyone
 * may, except a test account toward a user who is not one.
 */
export async function testAccountMayReach(actorId: string | null | undefined, targetId: string, query?: Queryable): Promise<boolean> {
  if (!(await isTestAccount(actorId, query))) return true;
  return isTestAccount(targetId, query);
}

/**
 * Named shares from a test account: every address must be at the test domain. Returns the refusal's
 * message, or null to carry on. Callers translate it to their own 403.
 */
export async function shareTargetsRefusal(actor: AccessActor, shares: ShareEntry[] | undefined): Promise<string | null> {
  if (!shares?.length || !(await isTestAccount(actor.userId))) return null;
  return shares.every((entry) => isTestDomainAddress(entry.email))
    ? null
    : `A test account shares only with addresses at ${TEST_DOMAIN ?? 'the test domain'}.`;
}
