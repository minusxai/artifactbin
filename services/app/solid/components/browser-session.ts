/**
 * The browser's side of the token exchange: hand the token to the server
 * once, and from then on the httpOnly cookie authorizes every request
 * automatically. Nothing here reads a credential back, because nothing can —
 * that is the point, and it is why call sites build no `Authorization`
 * header: a same-origin fetch already sends the cookie.
 *
 * One entry point: `forgetTokens`, the anonymous owner's sign-out. A token
 * ENTERS the browser through `POST /api/session/token` — the CLI's browser
 * approval and the /start flow both call that route directly, so no page
 * script has to hold the secret even for a moment.
 */

/**
 * End this browser's pages session (APP__PAGES_HOST): the cookie the documents' own origins read their
 * reader from lives on the pages domain, which the app's sign-out cannot touch, so the pages apex is
 * asked directly (server/pages-host DELETE). A page with no pages host names none, and this does nothing.
 */
export async function forgetPagesSession(doc: Document = document): Promise<void> {
  const url = doc.querySelector('meta[name="mx-pages-session"]')?.getAttribute('content');
  if (!url) return;
  try {
    await fetch(url, { method: 'DELETE', credentials: 'include', mode: 'cors' });
  } catch {
    /* the cookie expires on its own; the next framed page re-mints or clears it */
  }
}
