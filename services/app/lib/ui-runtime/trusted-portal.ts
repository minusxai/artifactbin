/**
 * THE TRUSTED PORTAL, found from an island (`IslandContext.trustedPortal`). solid/components/TrustedUi is
 * a Solid component and owns its container: a `[data-trusted-ui]` host whose open shadow root holds
 * `[data-trusted-ui-root]` with two children, the content and then the PORTAL destination (what
 * `useTrustedPortalContainer` hands the app's overlays). An island cannot use the app's Solid context,
 * so it finds the same element in the DOM when an overlay opens; a page with no trusted UI (a
 * compiled reader page before the app loads) answers null and the overlay renders in place.
 *
 * The page's NAVIGATION layer (`data-trusted-layer="navigation"`, lib/islands/trusted-overlay-host) is the one
 * asked for, by name: other trusted roots can sit earlier in the page (the document's consent bar, in the slot above
 * its frame), and an overlay mounted in one of them would paint under the top-layer rail. A page without a
 * navigation layer gets its first trusted root.
 */
/** The host attribute naming a layered trusted root's layer (set by lib/islands/trusted-overlay-host). */
export const TRUSTED_LAYER_ATTR = 'data-trusted-layer';

export function trustedPortalOf(doc: Document | undefined = typeof document === 'undefined' ? undefined : document): HTMLElement | null {
  if (!doc) return null;
  return portalIn(doc.querySelectorAll(`[data-trusted-ui][${TRUSTED_LAYER_ATTR}="navigation"]`)) ?? portalIn(doc.querySelectorAll('[data-trusted-ui]'));
}

/** The first host's portal among `hosts` that has the TrustedUi shape (an author element merely carrying the attributes has none). */
function portalIn(hosts: NodeListOf<Element>): HTMLElement | null {
  for (const host of hosts) {
    const root = [...(host.shadowRoot?.children ?? [])].find((el) => el.hasAttribute('data-trusted-ui-root'));
    const portal = root?.children.length === 2 ? root.children[1] : null;
    if (portal instanceof HTMLElement) return portal;
  }
  return null;
}
