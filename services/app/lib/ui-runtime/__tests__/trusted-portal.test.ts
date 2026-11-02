// @vitest-environment jsdom
/**
 * `IslandContext.trustedPortal()` (lib/islands/trusted-portal): the portal destination of the page's
 * first-party trusted UI (solid/components/TrustedUi — a `[data-trusted-ui]` host, an open shadow root,
 * `[data-trusted-ui-root]` holding content then portal), found when asked; null when the page has none.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { trustedPortalOf } from '../../ui-runtime/trusted-portal';
import { createTrustedOverlayHost } from '@/lib/ui-runtime/trusted-overlay-host';

/** The structure TrustedUi's `attach` builds (a layered overlay's host names its layer). */
function trustedUi(layer?: string): HTMLElement {
  const host = document.createElement('div');
  host.setAttribute('data-trusted-ui', '');
  if (layer) host.setAttribute('data-trusted-layer', layer);
  const shadow = host.attachShadow({ mode: 'open' });
  const root = document.createElement('div');
  root.setAttribute('data-trusted-ui-root', '');
  const content = document.createElement('div');
  const portal = document.createElement('div');
  root.append(content, portal);
  shadow.append(document.createElement('style'), root);
  document.body.append(host);
  return portal;
}

afterEach(() => { document.body.innerHTML = ''; });

describe('trustedPortal', () => {
  it('is null on a page without trusted UI (a compiled reader page before the app loads)', () => {
    expect(trustedPortalOf(document)).toBeNull();
    expect(trustedPortalOf(undefined)).toBeNull();
  });

  it('answers the trusted UI portal container once the app has mounted one, looked up when asked', () => {
    expect(trustedPortalOf(document)).toBeNull();
    const portal = trustedUi();
    expect(trustedPortalOf(document)).toBe(portal);
  });

  it('answers the navigation layer by name, not the first trusted root in the page (the consent bar\'s, above the frame)', () => {
    trustedUi();
    trustedUi('discussion');
    const navigation = trustedUi('navigation');
    expect(trustedPortalOf(document)).toBe(navigation);
  });

  it('answers the navigation layer drawn by createTrustedOverlayHost', () => {
    const bar = createTrustedOverlayHost();
    const navigation = createTrustedOverlayHost({ overlay: true, layer: 'navigation' });
    expect(navigation.host.getAttribute('data-trusted-layer')).toBe('navigation');
    expect(trustedPortalOf(document)).toBe(navigation.portal);
    bar.dispose();
    navigation.dispose();
  });

  it('never answers an author element that merely carries the attribute', () => {
    const fake = document.createElement('div');
    fake.setAttribute('data-trusted-ui', '');
    fake.innerHTML = '<div data-trusted-ui-root=""><div></div><div id="author"></div></div>';
    document.body.append(fake);
    expect(trustedPortalOf(document)).toBeNull();
  });

});
