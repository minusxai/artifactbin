/**
 * `IslandContext.trustedPortal()` (lib/islands/trusted-portal): the portal destination of the page's
 * first-party trusted UI (components/TrustedUi — a `[data-trusted-ui]` host, an open shadow root,
 * `[data-trusted-ui-root]` holding content then portal), found when asked; null when the page has none.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { trustedPortalOf } from '../trusted-portal';
import { createIslandRuntime } from '../rt';
import { createDataflowStore } from '@/lib/story-runtime/store';

/** The structure TrustedUi's `attach` builds. */
function trustedUi(): HTMLElement {
  const host = document.createElement('div');
  host.setAttribute('data-trusted-ui', '');
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
    const rt = createIslandRuntime({}, (df) => createDataflowStore(df));
    expect(rt.context.trustedPortal()).toBeNull();
    expect(trustedPortalOf(undefined)).toBeNull();
  });

  it('answers the trusted UI portal container once the app has mounted one, looked up when asked', () => {
    const rt = createIslandRuntime({}, (df) => createDataflowStore(df));
    expect(rt.context.trustedPortal()).toBeNull();
    const portal = trustedUi();
    expect(rt.context.trustedPortal()).toBe(portal);
  });

  it('never answers an author element that merely carries the attribute', () => {
    const fake = document.createElement('div');
    fake.setAttribute('data-trusted-ui', '');
    fake.innerHTML = '<div data-trusted-ui-root=""><div></div><div id="author"></div></div>';
    document.body.append(fake);
    expect(trustedPortalOf(document)).toBeNull();
  });

  it('can be supplied by the page (the SPA after adoption)', () => {
    const mine = document.createElement('div');
    const rt = createIslandRuntime({}, (df) => createDataflowStore(df), { trustedPortal: () => mine });
    expect(rt.context.trustedPortal()).toBe(mine);
  });
});
