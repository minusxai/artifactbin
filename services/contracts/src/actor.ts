/**
 * WHO IS CALLING. Resolved once by the proxy from a bearer token, a session or the agent
 * cookie, and handed to the app with the request — in-process by reference (utils attachActor),
 * across a network hop as a signed header (utils signActor). The app reads it with actorOf().
 */
export const ACTOR_HEADER = 'x-mx-actor';
export const CREDENTIALS = ['bearer', 'session', 'agent-cookie', 'none'] as const;
export type Credential = (typeof CREDENTIALS)[number];

export interface Actor {
  credential: Credential;
  userId?: string;
  tokenId?: string;
  email?: string;
  emailVerified?: boolean;
  /**
   * Every token id the browser's agent cookie holds (the LAST is the primary),
   * present whenever that cookie is — under a session too, which is how a
   * sign-up can CLAIM what the browser minted before logging in. Ids only,
   * never secrets; the app reads them for claim and claimable.
   */
  heldTokenIds?: string[];
}

export const ANONYMOUS: Actor = { credential: 'none' };

/** Default lifetime of a signed header. Short: it is minted per request. */
export const ACTOR_TTL_SECONDS = 120;
