/**
 * Connecting a downloaded file to its page (the v1 "Connect" flow on v2):
 * the file's platform frame begins a connection, the viewer approves it in a
 * window on the server as their account, and the frame polls for a page
 * grant. Routes (platform UI, mounted in src/server.js):
 *   POST /api/pair          { fileId }      → 201 { code, deviceCode }; 404 unknown page
 *   GET  /api/pair/info?code=<code>         → 200 { fileId, path }; 410 expired or unknown. `path` is the
 *                                             page's library path when the website session can read
 *                                             the page, else null: a code reveals nothing about a private page
 *   POST /api/pair/approve  { code }        → 200 { approved: true }, as the website session
 *                                             (same origin, cookie); 403 when that account
 *                                             cannot read the page; 409 approved already, or another
 *                                             approval is still issuing (retry); 410 expired
 *   POST /api/pair/poll     { deviceCode }  → 202 { pending: true } until approved, then once
 *                                             200 { token, username, purpose: "document" }; 410 after
 * The grant is a `document` session for the page, the same kind the hosted
 * shell gets: comments, presence and backend calls as that account, never
 * source, sharing or account access. The approval page is GET /connect?code=.
 */
export interface PendingConnection {
  code: string;
  deviceCode: string;
  fileId: string;
  expires: number;
  grant: { token: string; username: string } | null;
  /** An approval owns the grant call until it settles; concurrent approval is 409 (retry). */
  approving: boolean;
}
export interface ConnectPagePort {
  /**
   * The page's id and, when the account behind `credential` can read it, its
   * library path; throws 404 for anything but a published page.
   */
  connectInfo(id: string, credential?: string): Promise<{ id: string; path: string | null }>;
  /** Issue a document grant (401 no account, 403 no read access). */
  grant(credential: string, id: string): Promise<{ token: string; username: string }>;
  /**
   * End a document grant this port issued. A grant that completes after its
   * connection expired is revoked at once, so it never outlives the connection.
   */
  revoke(token: string): Promise<void>;
}
export interface ConnectServiceOptions {
  pages: ConnectPagePort;
  now?: () => number;
  /** Random text for codes; deviceCode needs ~32 bytes of entropy, code ~6. */
  random?: (bytes: number) => string;
  /** How long a pending connection waits for approval and its poll; default five minutes. */
  ttl?: number;
  /** Pending connections plus in-flight page lookups at once; default 20. */
  capacity?: number;
}
export interface ConnectService {
  begin(fileId: unknown): Promise<{ status: 201; value: { code: string; deviceCode: string } }>;
  /** The page a code is for; the route adds its path for a viewer who can read it. */
  info(code: unknown): { fileId: string };
  /** Exclusive while issuing: rejection allows retry; expiry before completion is 410 and revokes the late grant. */
  approve(credential: string, code: unknown): Promise<{ status: 200; value: { approved: true } }>;
  poll(deviceCode: unknown): { status: 200 | 202; value: { pending: true } | { token: string; username: string; purpose: "document" } };
}
