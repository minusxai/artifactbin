/**
 * TEST USERS: throwaway people an account mints to be "the other person" while
 * verifying an app, and the sandbox they live in.
 *
 * A user has one KIND. `account` is a signed-in person. `guest` is an anonymous
 * browser that saved something and will claim it by logging in. `testuser` is a
 * person minted BY an account (`parent`): a full user toward artifacts that
 * test users own and toward other test users, and exactly a guest toward
 * everything else — it can read what a link grants and nothing more. Deleting a
 * test user ERASES everything it owns; nothing it did ever reaches an account's
 * data, which is what makes it safe to delete.
 */
export type UserKind = 'account' | 'guest' | 'testuser';

/** What an actor may do to a target; the ONE vocabulary every route consults (lib/capabilities). */
export type Capability =
  | 'read'         // open a page/dataset the link or a share grants
  | 'create'       // publish a new artifact of one's own
  | 'edit'         // change an artifact one owns or is an editor of
  | 'fork'         // copy an artifact into one's own account
  | 'write_as_me'  // run a <Mutation> that binds $_me into a dataset
  | 'like' | 'follow' | 'comment' | 'share';

export const TESTUSER_LIMITS = {
  /** Live test users one account may hold at once. */
  perAccount: 3,
  /** A test user's life from minting; the sweep erases it after this plus the margin. */
  ttlMs: 24 * 60 * 60 * 1000,
  sweepMarginMs: 5 * 60 * 1000,
} as const;

/** Stable refusal codes; every message names the fix (docs/errors). */
export const TESTUSER_ERRORS = {
  limit: 'testuser_limit',
  expired: 'testuser_expired',
  notYours: 'not_your_testuser',
  requiresAccount: 'testuser_requires_account',
} as const;

export interface TestUser {
  id: string;
  /** How pages name it: "Test user" plus a short discriminator. */
  label: string;
  created_at: string;
  expires_at: string;
  /** Live counts, so an agent can say what it made before deleting. */
  artifacts: number;
  sessions: number;
}

/** `--as` on the CLI and `viewer` on the wire: the pages of a session, or the owner of a fork. */
export type ViewerChoice = 'guest' | { testuser: string };
