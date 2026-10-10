/**
 * The accounts module's interface: only what other modules import. Server-only; the one other entry is
 * ./tokens, which a downstream deployment imports by path (services/app/__tests__/downstream-exports.test.ts).
 */
export type { RoleActor, TokenActor, VerifiedAccount, Viewer } from './actors';
export { hasAdminCredential } from './admin-auth';
export { AGENT_COOKIE, agentSessionClearCookie, agentSessionSetCookie, decodeAgentSessionEnvelope, encodeAgentSession, liveAgentSession, withToken, withoutToken } from './agent-session';
export { browserActor, docAssetImportRateLimited, documentFetchRateLimited, refusesCrossSite, resetRateLimit, resetWebIngestRateLimit, setDocAssetImportCapForTests, webIngestRateLimited, withTokenAuth } from './auth';
export { AVATAR_MAX_BYTES, AvatarError, avatarPath, avatarUrl, avatarVersion, clearAvatar, setAvatar } from './avatars';
export { matchesWorkspaceAccount, mergeGuestUsers } from './guest-owner';
export { lockMembershipUsers } from './membership-lock';
export { profileSocial, type ProfileSocial } from './profile-social';
export { confirmWelcome, profileWrites, syncProfile, welcomePending } from './profiles';
export { JOIN_RELATIONS, dismissPendingRelations, seedOwnerJoin, setRelationState } from './relation-state';
export { count, has, link, linked, replaceLinked, unlink } from './relations';
export { hostedAuthorization, hostedOperationCompleted, hostedRefusal, setHostedRequestAuthority } from './request-authority';
export { auth, overrideSession, type Session } from './session';
export { closeTestUserSessions, forgetTestUserSession, noteTestUserSession, testUserSessionCount } from './testuser-sessions';
export { createTestUser, getTestUserRow, listTestUsers, resolveTestUser } from './testusers';
export { DEFAULT_TOKEN_TTL_MS, LIVE_TOKEN_SQL, MAX_TOKEN_TTL_MS, MIN_TOKEN_TTL_MS, TOUCH_INTERVAL_MS, ensureUserToken, listTokensByUser, mintToken, resolveToken, resolveTokenById, revokeHeldToken, revokeToken, sourcedTokenName, tokenStatus, touchToken } from './tokens';
export { ACCOUNT_REACH_SQL, canAuthenticateUser, userKindOf } from './user-kinds';
export { USERNAME_RE, authorHandle, claimToken, claimTokenById, claimableTokensById, createUser, ensureUsername, getUserByEmail, getUserById, getUserByUsername, isAccountRow, ownerUsername, revokeUserToken, setUserEmail, setUsername, usernameFromEmail } from './users';
export type { UserRow } from './users';
export { actorForArtifacts, browserSessionKind, isBrowserSessionRequest, isCookieCredential, requestOrSessionActor, sessionActor, tokenActorForRequest } from './viewer';
export type { RequestActor } from './viewer';
export { PAGES_COOKIE, endPagesSession, exchangePagesTicket, issuePagesTicket, pagesSessionActor, pagesSessionOf } from './pages-sessions';
