/**
 * The accounts module's interface: the identity store — actors, users and handles, tokens, legacy cookie clearing and pages
 * session cookies, profiles and test accounts. Server-only; tests also use ./testing. A downstream
 * deployment imports ./tokens by path (services/app/__tests__/downstream-exports.test.ts).
 *
 * Who a request is lives a layer up, in lib/authentication; pictures are lib/avatars', likes and follows lib/social's, hourly quotas lib/allowances'.
 */

/** Actors: the identity every access decision reads. */
export { ARTIFACTBIN_AGENT_HEADER, forwardedFor, identifyClient, type Harness } from './client-identity';
export { ANONYMOUS_ACTOR, NO_IDENTITY, accountOf, identityForUser, principalKey, type GroupPrincipal, type AccessActor, type RequestIdentity, type PublicationActor, type TokenHoldingActor } from './actors';

/** Users and handles. */
export { authorHandle, ensureUsername, getUserByEmail, getUserById, getUserByUsername, hasCreatedDocument, isAccountRow, ownerUsername, replaceUserImageKey } from './users';
/** Compatibility for downstream test suites. Local fixtures use ./testing. */
export { createUser } from './users';
export { DuplicateProfileEmail, confirmWelcome, syncProfile, welcomePending } from './profiles';

/** Whether an account may act on this deployment. */
export { canUseDeploymentIdentity } from './deployment-identity';

/** Tokens: minting, lookup and the per-request credential memo. */
export { MAX_TOKEN_TTL_MS, MIN_TOKEN_TTL_MS, answeredOnce, ensureUserToken, hostedCredentialDescriptor, listTokensByUser, liveGroupSignIn, mintToken, rememberTokenClient, resolveToken, resolveTokenById, revokeToken, sourcedTokenName, tokenStatus, touchToken, withAccountToken } from './tokens';
export { revokeUserToken } from './users';
export { hasAdminCredential } from './admin-auth';

/** Historical workspace account aliases. */
export { matchesWorkspaceAccount } from './guest-owner';

/** Legacy cookie clearing and current document-bound Pages sessions. */
export { AGENT_COOKIE, agentSessionClearCookie } from './agent-session';
export { endPagesSession, endPagesSessionsFor, exchangePagesTicket, issuePagesTicket, pagesSessionOf, sweepExpiredPagesTickets, type PagesSession } from './pages-sessions';

/** Test accounts and test users. */
export { TEST_ACCOUNT_RESTRICTED, isTestAccount, isTestOwned, shareTargetsRefusal, testAccountMayReach } from './test-accounts';
export { closeTestUserSessions, forgetTestUserSession, noteTestUserSession, testUserSessionCount } from './testuser-sessions';
export { createTestUser, getTestUserRow, listTestUsers, resolveTestUser } from './testusers';
