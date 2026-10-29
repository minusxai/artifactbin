/**
 * The accounts module's interface: the identity store — actors, users and handles, tokens, the agent and pages
 * session cookies, profiles and test accounts. Only what other modules import; tests reach a defining file
 * directly. Server-only; the one other entry is ./tokens, which a downstream deployment imports by path
 * (services/app/__tests__/downstream-exports.test.ts).
 *
 * Who a request is lives a layer up, in lib/authentication (it also claims tokens and merges guests, which move
 * artifacts); pictures are lib/avatars', likes and follows lib/social's, hourly quotas lib/allowances'.
 */

/** Actors: the identity every access decision reads. */
export { ANONYMOUS_ACTOR, NO_IDENTITY, accountOf, identityForUser, type AccessActor, type RequestIdentity, type TokenHoldingActor } from './actors';

/** Users and handles. */
export { authorHandle, createUser, ensureUsername, getUserByEmail, getUserById, getUserByUsername, hasCreatedDocument, isAccountRow, ownerUsername, replaceUserImageKey, setAutoAcceptMentions, setUsername } from './users';
export { RESERVED_HANDLES, reserveHandle } from './handles';
export { lockMembershipUsers } from './membership-lock';
export { DuplicateProfileEmail, confirmWelcome, syncProfile, welcomePending } from './profiles';

/** Tokens: minting, lookup and the per-request credential memo. */
export { DEFAULT_TOKEN_TTL_MS, MAX_TOKEN_TTL_MS, MIN_TOKEN_TTL_MS, answeredOnce, ensureUserToken, hostedCredentialDescriptor, listTokensByUser, liveTokenSql, mintToken, rememberTokenClient, resolveToken, resolveTokenById, revokeHeldToken, revokeToken, sourcedTokenName, tokenStatus, touchToken, withAccountToken } from './tokens';
export { claimableTokensById, revokeUserToken } from './users';
export { hasAdminCredential } from './admin-auth';

/** The accounts halves of a token claim and a guest merge, run by lib/authentication inside its transaction. */
export { attachClaimedToken } from './users';
export { lockMergeableGuests, matchesWorkspaceAccount, retireGuest } from './guest-owner';

/** Session cookies: the agent session (app origin) and pages sessions (the pages origin). */
export { AGENT_COOKIE, agentSessionClearCookie, agentSessionSetCookie, encodeAgentSession, liveAgentSession } from './agent-session';
export { endPagesSession, endPagesSessionsFor, exchangePagesTicket, issuePagesTicket, pagesSessionOf, type PagesSession } from './pages-sessions';

/** Test accounts and test users. */
export { TEST_ACCOUNT_RESTRICTED, isTestAccount, isTestOwned, shareTargetsRefusal, testAccountMayReach } from './test-accounts';
export { closeTestUserSessions, forgetTestUserSession, noteTestUserSession, testUserSessionCount } from './testuser-sessions';
export { createTestUser, getTestUserRow, listTestUsers, resolveTestUser } from './testusers';
