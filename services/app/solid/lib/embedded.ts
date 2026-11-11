/**
 * THE EMBEDDED VIEW of a document's address: `/a/<id>?embed=1` drawn inside another origin's frame. The page is the
 * same reader (its document, comments, selections and page behaviour), without the app's own bar, and it never
 * leaves the frame for onboarding: a first-time account's welcome (choosing a handle) waits until the person opens
 * the app itself (components/OnboardingGate).
 *
 * Only a trusted embedder (EMBED__TRUSTED_ORIGINS) can draw it: the server answers that address with
 * `frame-ancestors` naming those origins alone (server/app.ts `framedPolicy`), and here the view applies only while
 * this window really is framed. Opened on its own, the address is the ordinary page.
 */
export function isEmbeddedView(win: { location: { search: string }; self: unknown; top: unknown } = window): boolean {
  if (new URLSearchParams(win.location.search).get('embed') !== '1') return false;
  try { return win.self !== win.top; } catch { return true; }
}
