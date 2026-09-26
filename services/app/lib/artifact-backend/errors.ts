/**
 * A backend refusal that carries what the caller shows or decides on: the
 * sentence (`message`), the status, and whether the request needs a signed-in
 * account (lib/story/sign-in-required). A request that never reached the
 * server rejects with the platform's own error instead.
 */
export class BackendRequestError extends Error {
  readonly status: number;
  readonly signInRequired: boolean;
  constructor(message: string, status: number, signInRequired = false) {
    super(message);
    this.name = 'BackendRequestError';
    this.status = status;
    this.signInRequired = signInRequired;
  }
}
