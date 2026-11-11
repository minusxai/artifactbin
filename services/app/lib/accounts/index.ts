/**
 * The accounts module's interface: the identity store — actors, users and handles, tokens, legacy cookie clearing and pages
 * session cookies, profiles and test accounts. Only what other modules import; tests reach a defining file
 * directly. Server-only; the one other entry is ./tokens, which a downstream deployment imports by path
 * (services/app/__tests__/downstream-exports.test.ts).
 *
 * Who a request is lives a layer up, in lib/authentication; pictures are lib/avatars', likes and follows lib/social's, hourly quotas lib/allowances'.
 */

/** Actors: the identity every access decision reads. */
export { ARTIFACTBIN_AGENT_HEADER, describeClient, forwardedFor, identifyClient, logClientIdentity, type Harness } from './client-identity';
export { ANONYMOUS_ACTOR, NO_IDENTITY, accountOf, identityForUser, type AccessActor, type RequestIdentity, type TokenHoldingActor } from './actors';

/** Users and handles. */
export { authorHandle, createUser, ensureUsername, getUserByEmail, getUserById, getUserByUsername, hasCreatedDocument, isAccountRow, ownerUsername, replaceUserImageKey, setUsername } from './users';
export { HANDLE_RE, isValidHandle, RESERVED_HANDLES } from './handles';
export { DuplicateProfileEmail, confirmWelcome, syncProfile, welcomePending } from './profiles';

/** Whether an account may act on this deployment. */
export { canUseDeploymentIdentity, deploymentMemberSql } from './deployment-identity';

/** Tokens: minting, lookup and the per-request credential memo. */
export { DEFAULT_TOKEN_TTL_MS, MAX_TOKEN_TTL_MS, MIN_TOKEN_TTL_MS, answeredOnce, ensureUserToken, hostedCredentialDescriptor, listTokensByUser, liveTokenSql, mintToken, rememberTokenClient, resolveToken, resolveTokenById, revokeToken, sourcedTokenName, tokenStatus, touchToken, withAccountToken } from './tokens';
export { revokeUserToken } from './users';
export { hasAdminCredential } from './admin-auth';

/** Historical workspace account aliases. */
export { matchesWorkspaceAccount } from './guest-owner';

/** Legacy cookie clearing and current document-bound Pages sessions. */
export { AGENT_COOKIE, agentSessionClearCookie } from './agent-session';
export { endPagesSession, endPagesSessionsFor, exchangePagesTicket, issuePagesTicket, pagesSessionOf, type PagesSession } from './pages-sessions';

/** Test accounts and test users. */
export { TEST_ACCOUNT_RESTRICTED, isTestAccount, isTestOwned, shareTargetsRefusal, testAccountMayReach } from './test-accounts';
export { closeTestUserSessions, forgetTestUserSession, noteTestUserSession, testUserSessionCount } from './testuser-sessions';
export { createTestUser, getTestUserRow, listTestUsers, resolveTestUser } from './testusers';
