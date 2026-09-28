/**
 * THE TRUSTED PORTAL, found from an island (`IslandContext.trustedPortal`). components/TrustedUi is
 * React and owns its container: a `[data-trusted-ui]` host whose open shadow root holds
 * `[data-trusted-ui-root]` with two children, the content and then the PORTAL destination (what
 * `useTrustedPortalContainer` hands the React kit's overlays). An island cannot use React context,
 * so it finds the same element in the DOM when an overlay opens; a page with no trusted UI (a
 * compiled reader page before the app loads) answers null and the overlay renders in place.
 */
export function trustedPortalOf(doc: Document | undefined = typeof document === 'undefined' ? undefined : document): HTMLElement | null {
  if (!doc) return null;
  for (const host of doc.querySelectorAll('[data-trusted-ui]')) {
    const root = [...(host.shadowRoot?.children ?? [])].find((el) => el.hasAttribute('data-trusted-ui-root'));
    const portal = root?.children.length === 2 ? root.children[1] : null;
    if (portal instanceof HTMLElement) return portal;
  }
  return null;
}
