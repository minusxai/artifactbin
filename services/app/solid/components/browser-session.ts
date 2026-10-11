/**
 * The browser's side of sign-out for the documents' own origins (APP__PAGES_HOST).
 *
 * A document's origin holds its own host-only cookie that the app's sign-out cannot touch, and a document's
 * script may not end its reader's session. So sign-out asks the APP (same origin, credentialed) to end every
 * pages session of the reader on the server — `DELETE /api/session/token`, which also clears the old ownership
 * cookie — BEFORE the account session itself goes. A cookie a browser still holds then names no row and reads as
 * nobody; there is no call to any pages host.
 */
export async function endPagesSessions(): Promise<void> {
  try {
    await fetch('/api/session/token', { method: 'DELETE', credentials: 'same-origin' });
  } catch {
    /* the sessions expire on their own (8 h); the next framed page mints or clears them */
  }
}
