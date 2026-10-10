/**
 * A backend refusal that carries what the caller shows or decides on: the
 * sentence (`message`), the status, and whether the request needs a signed-in
 * account (@artifactbin/contracts sign-in-required). A request that never reached the
 * server rejects with the platform's own error instead.
 */
export class BackendRequestError extends Error {
  readonly status: number;
  readonly signInRequired: boolean;
  /** The server's refusal code, where the caller acts on which refusal it was (`invalid_attachment`, `stale`). */
  readonly code?: string;
  /** On a `stale` refusal: the document's head now, which a write that is not about a version may retry against. */
  readonly headEditId?: string;
  constructor(message: string, status: number, signInRequired = false, code?: string, headEditId?: string) {
    super(message);
    this.name = 'BackendRequestError';
    this.status = status;
    this.signInRequired = signInRequired;
    if (code) this.code = code;
    if (headEditId) this.headEditId = headEditId;
  }
}
