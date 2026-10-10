/** The accounts module's interface: only what other modules import. */
export { hasAdminCredential } from './admin-auth';
export { AGENT_COOKIE, agentSessionClearCookie, agentSessionSetCookie, decodeAgentSessionEnvelope, encodeAgentSession, liveAgentSession, withToken, withoutToken } from './agent-session';
export { browserActor, documentFetchRateLimited, refusesCrossSite, resetRateLimit, resetWebIngestRateLimit, setDocAssetImportCapForTests, webIngestRateLimited, withTokenAuth } from './auth';
export { AVATAR_MAX_BYTES, AvatarError, avatarPath, avatarUrl, avatarVersion, clearAvatar, setAvatar } from './avatars';
export { mergeGuestUsers } from './guest-owner';
export { profileSocial } from './profile-social';
export { confirmWelcome, profileWrites, syncProfile, welcomePending } from './profiles';
export { seedOwnerJoin, setRelationState } from './relation-state';
export { count, has, link, linked, unlink } from './relations';
export { noteTestUserSession, testUserSessionCount } from './testuser-sessions';
export { createTestUser, listTestUsers } from './testusers';
export { DEFAULT_TOKEN_TTL_MS, LIVE_TOKEN_SQL, MAX_TOKEN_TTL_MS, MIN_TOKEN_TTL_MS, TOUCH_INTERVAL_MS, ensureUserToken, listTokensByUser, mintToken, resolveToken, resolveTokenById, revokeHeldToken, revokeToken, sourcedTokenName, tokenStatus, touchToken } from './tokens';
export { userKindOf } from './user-kinds';
export { USERNAME_RE, authorHandle, claimToken, claimTokenById, claimableTokensById, createUser, ensureUsername, getUserByEmail, getUserById, getUserByUsername, ownerUsername, revokeUserToken, setUserEmail, setUsername, usernameFromEmail } from './users';
export type { UserRow } from './users';
export { actorForArtifacts, browserSessionKind, isBrowserSessionRequest, requestOrSessionActor, sessionActor, tokenActorForRequest } from './viewer';
export type { RequestActor } from './viewer';
export { exchangePagesTicket, issuePagesTicket, pagesSessionActor } from './pages-sessions';
