/**
 * Candidate Solid routes: which addresses the app page answers with the Solid entry (web/solid-app.html).
 *
 * EVERY artifact address is Solid's, at either shape — `/a/<id>[/edit]` or its healed pretty form
 * `/@user/<id>[-slug][/edit]` — whatever the artifact is: a compiled document is adopted by
 * solid/pages/Document (the compiled page names the Solid idle entry itself), and everything the server
 * answers without a compiled page — a folder, a data tier (image, pdf, file, viz, dataset), the starter
 * placeholder's instructions, a dataset's editor — is routed by solid/pages/ArtifactAddress. A miss is the
 * Solid 404 page.
 */
const STATIC_PAGES = ['/', '/assets', '/datasets/new', '/files/new', '/trash', '/chat', '/login', '/start', '/welcome', '/notifications', '/account', '/docs-human'];

export function isSolidPage(pathname: string, status = 200): boolean {
  return status === 404 || STATIC_PAGES.includes(pathname)
    // A profile and every pretty alias below it (solid/pages/Profile ProfileAliasRoute).
    || /^\/@[^/]+(?:\/.*)?$/.test(pathname)
    || /^\/a\/[^/]+(?:\/edit)?\/?$/.test(pathname);
}
