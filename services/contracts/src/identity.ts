/**
 * THE PROXY'S ONE READ OF AN APP-OWNED TABLE. The app owns `tokens` and every write to it; the proxy
 * resolves a presented credential through this reader and nothing else — one indexed SELECT per request
 * (auth `createBearerReader`: token, OAuth family fence and account identity), never a cache or an HTTP call.
 */
export interface TokenRecord {
  id: string;
  userId: string | null;
  /** OAuth resource restriction; absent on ordinary/manual tokens. */
  audience?: string;
  /** Space-delimited OAuth scope; absent on ordinary/manual tokens. */
  scope?: string;
  /** ISO expiry; absent when the token does not expire. */
  expiresAt?: string;
  /** `tokens.issued_by`: a run sign-in's configured service, or the person who authorised a group's sign-in. */
  issuedBy?: string;
  /**
   * A GROUP'S SIGN-IN (./identity-service `GROUP_SIGN_IN_RULE`): the group the token acts as and its level, with
   * `userId` null; absent on every other token. A token with neither `userId` nor `groupId` is unowned, never a group's.
   */
  groupId?: string;
  /** Person who authorized a group bearer, for introspection only. Never the request actor. */
  auditUserId?: string;
  groupRole?: 'member' | 'editor';
  /** The account's identity, read in the same statement as the token; absent when it has no account row. */
  email?: string;
  emailVerified?: boolean;
}
export interface TokenReader {
  /** The bearer path. Refuses a value that is not token-shaped BEFORE hashing or touching the database. */
  byToken(presented: string): Promise<TokenRecord | null>;
}
