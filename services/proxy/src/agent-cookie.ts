/**
 * The agent-cookie codec moved to @artifactbin/utils (services/utils/src/agent-session.ts)
 * — behaviour byte-for-byte; this re-export stays until the package dissolves.
 */
export {
  AGENT_COOKIE, AGENT_COOKIE_MAX_AGE, encodeAgentSession, decodeAgentSession, withToken,
  cookieName, setCookieHeader, clearCookieHeader, readCookie,
} from '@artifactbin/utils';
