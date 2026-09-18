import { z } from 'zod';
import { TESTUSER_ERRORS, TESTUSER_LIMITS } from '@artifactbin/contracts';
import { createTestUser, eraseTestUser, getTestUserRow, listTestUsers, sweepTestUsers } from '@/lib/testusers';
import type { Operation } from './registry';

/**
 * THE TEST-USER FAMILY: mint a throwaway second person, see the ones you hold,
 * erase one with everything it owns.
 *
 * Three operations rather than a session flag, because the identity outlives
 * any one session now: a test user is a `users` row with a parent and a death
 * date, it owns the artifacts it makes, and `afbin fork <id> --as <testuser>`
 * is how a real page gets into its sandbox. Every one of them sweeps the
 * expired first, so an account that forgets to delete still ends up with none.
 */
const account = { status: 403, code: TESTUSER_ERRORS.requiresAccount, fix: 'Sign in: a test user is a second person alongside YOUR account, and a guest has no account to put one beside.' };
const notYours = { status: 403, code: TESTUSER_ERRORS.notYours, fix: 'The id is not one of your live test users. List them (testuser_list) and name one of those.' };

export const TESTUSER_OPERATIONS: Operation[] = [
  {
    name: 'testuser_create',
    title: 'Mint a test user',
    http: { method: 'POST', path: '/api/testusers' },
    description: `Mint a throwaway SECOND PERSON to verify a multi-person page with — the other member of a tab, the other voter, the second RSVP. It is a real user toward the artifacts test users own and exactly a guest toward everything else: it can read what a link grants and it can never like, comment on, fork or write a row into YOUR data. Bring a page into its sandbox by forking that page as it (fork_artifact with as: {testuser: <id>}), then act as the test user with the bearer token this answers — handed back once and never readable again. An account holds ${TESTUSER_LIMITS.perAccount} at a time and each one dies after ${TESTUSER_LIMITS.ttlMs / 3600000} hours; deleting it ERASES everything it owns, which is what makes it safe to make one.`,
    input: {},
    annotations: {},
    example: { input: {}, note: 'take id for --as (fork) and viewer (a session); a test user acts only through a browser session, never with a credential of its own' },
    errors: [
      account,
      { status: 409, code: TESTUSER_ERRORS.limit, fix: `You hold ${TESTUSER_LIMITS.perAccount} test users. Delete one (testuser_delete) — it erases what that person made — and mint again.` },
    ],
    async run(ctx) {
      await sweepTestUsers();
      const minted = await createTestUser(ctx.actor);
      if (!minted.ok) return { status: minted.status, body: { error: minted.error, message: minted.message } };
      // The token is the session service's to use, never the caller's: a test
      // user acts through a browser session, and a secret in this reply would
      // be printed into an agent's context.
      const { ok, userId, tokenId, token, ...wire } = minted;
      void ok; void userId; void tokenId; void token;
      return { status: 201, body: { ...wire } };
    },
  },
  {
    name: 'testuser_list',
    title: 'List your test users',
    http: { method: 'GET', path: '/api/testusers' },
    description: 'The live test users this account holds, each with its label, its death date and what it is holding right now: how many artifacts it owns (all of which an erase removes) and how many browser sessions are browsing as it. Expired ones are erased on the way past, so this is always what really exists.',
    input: {},
    annotations: { readOnly: true },
    example: { input: {} },
    errors: [account],
    async run(ctx) {
      await sweepTestUsers();
      if (!ctx.actor.userId) return { status: 403, body: { error: account.code, message: account.fix } };
      return { status: 200, body: { testusers: await listTestUsers(ctx.actor.userId) } };
    },
  },
  {
    name: 'testuser_delete',
    title: 'Erase a test user',
    http: { method: 'DELETE', path: '/api/testusers/{id}' },
    description: 'ERASE a test user and everything it owns — its artifacts and their datasets, rows, comments, likes and follows, its tokens and its live browser sessions. Hard: nothing is trashed, nothing is recoverable, and the artifact quota those copies used returns to you. Nothing of yours is touched, because a test user can never have written to it. Answers { deleted: true, erased: { artifacts, sessions } } — what that person was holding. Deleting one that is already gone answers 404.',
    input: { id: z.string().describe('the test user id (testuser_create answered it, testuser_list lists them)') },
    annotations: { destructive: true, idempotent: true },
    example: { input: { id: 'usr_9f3k2a' } },
    errors: [
      account,
      notYours,
      { status: 404, code: 'not_found', fix: 'This test user no longer exists — an earlier delete or the expiry sweep already erased it. There is nothing left to remove.' },
    ],
    async run(ctx, input) {
      await sweepTestUsers();
      const id = String(input.id);
      if (!ctx.actor.userId) return { status: 403, body: { error: account.code, message: account.fix } };
      // Three outcomes, told apart on purpose: somebody else's test user is a
      // mistake about identity; one of YOURS is erased; and one that is not
      // there at all — an earlier delete, or the sweep that just ran — is
      // simply done, which is what makes a repeated delete a 404 and not a
      // refusal the caller has to interpret.
      const row = await getTestUserRow(id);
      if (!row) return { status: 404, body: { error: 'not_found', message: 'This test user has already been erased.' } };
      if (row.parent_user_id !== ctx.actor.userId) return { status: 403, body: { error: TESTUSER_ERRORS.notYours, message: notYours.fix } };
      const gone = await eraseTestUser(id);
      // An OBJECT body, and it says what went: the count is the only record
      // that the copies ever existed, and a caller that is about to tell a
      // person "three artifacts deleted" has to be told first.
      return { status: 200, body: { deleted: true, id, label: row.label, erased: { artifacts: gone.artifacts, sessions: gone.sessions } } };
    },
  },
];
