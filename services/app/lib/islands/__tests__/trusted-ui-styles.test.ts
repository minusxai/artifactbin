/**
 * The trusted UI sheet (trusted-ui-styles): only the app's own compiled CSS, scoped to the trusted root and reset
 * against author variables; the shell's same-origin sheets stand in until their exact bytes arrive; and the overlay
 * paint order. Its state is module-wide, so every test imports a fresh copy (vi.resetModules), which also keeps
 * this file out of the islands project's shared module graph.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const fresh = async () => { vi.resetModules(); return import('../trusted-ui-styles'); };
beforeEach(() => { document.head.replaceChildren(); });
afterEach(() => { vi.unstubAllGlobals(); document.head.replaceChildren(); document.body.replaceChildren(); });

describe('configureTrustedUiStyles', () => {
  it('scopes :root, :host, html and body to the trusted root and resets every variable the CSS reads', async () => {
    const { configureTrustedUiStyles, currentTrustedCss } = await fresh();
    const before = currentTrustedCss();
    expect(before).toContain('[data-trusted-ui-root][popover]');
    configureTrustedUiStyles(':root { --edge: red; } body { color: var(--ink); } html, .x { margin: 0 }');
    const css = currentTrustedCss();
    expect(css).toContain('@layer trusted-ui-reset { [data-trusted-ui-root] { all: initial; --edge: initial;--ink: initial; } }');
    expect(css).toContain('[data-trusted-ui-root] { --edge: red; }');
    expect(css).toContain('[data-trusted-ui-root] { color: var(--ink); }');
    expect(css).not.toMatch(/(^|[\s,}])(html|body|:root)\b(?=[\s,{])/);
    expect(css.endsWith(before)).toBe(true);
  });

  it('rewrites every installed style element in place', async () => {
    const { configureTrustedUiStyles, currentTrustedCss, installedStyles } = await fresh();
    const style = document.createElement('style');
    installedStyles.add(style);
    configureTrustedUiStyles('.a { color: blue }');
    expect(style.textContent).toBe(currentTrustedCss());
    expect(style.textContent).toContain('.a { color: blue }');
  });
});

describe('configureTrustedUiFromShell', () => {
  it('takes only same-origin stylesheets, and the exact bytes once a root first asks', async () => {
    const fetch = vi.fn(async (href: string) => new Response(href.endsWith('app.css') ? '.exact { color: red }' : '', { headers: { 'content-type': 'text/css' } }));
    vi.stubGlobal('fetch', fetch);
    document.head.innerHTML = `<link rel="stylesheet" href="${location.origin}/app.css"><link rel="stylesheet" href="https://cdn.other.test/x.css"><link rel="icon" href="/f.ico">`;
    const { configureTrustedUiFromShell, currentTrustedCss } = await fresh();
    configureTrustedUiFromShell(document);
    expect(fetch).not.toHaveBeenCalled();
    currentTrustedCss();
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch.mock.calls[0]![0]).toBe(`${location.origin}/app.css`);
    await vi.waitFor(() => expect(currentTrustedCss()).toContain('.exact { color: red }'));
    currentTrustedCss();
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('keeps the parsed stand-in when the answer is not CSS', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('export default 1', { headers: { 'content-type': 'text/javascript' } })));
    document.head.innerHTML = `<link rel="stylesheet" href="${location.origin}/app.css">`;
    const { configureTrustedUiFromShell, currentTrustedCss } = await fresh();
    configureTrustedUiFromShell(document);
    const standIn = currentTrustedCss();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(currentTrustedCss()).toBe(standIn);
    expect(standIn).not.toContain('export default');
  });
});

describe('openOverlay', () => {
  it('keeps higher-priority overlays painted above a lower one opened later', async () => {
    const { openOverlay, overlays } = await fresh();
    const order: string[] = [];
    const root = (name: string) => {
      const el = document.createElement('div');
      el.showPopover = () => { order.push(`show:${name}`); };
      el.hidePopover = () => { order.push(`hide:${name}`); };
      return el;
    };
    const navigation = root('nav'), selection = root('sel'), discussion = root('disc');
    openOverlay(navigation, 3);
    openOverlay(discussion, 2);
    order.length = 0;
    openOverlay(selection, 1);
    expect(order).toEqual(['show:sel', 'hide:disc', 'show:disc', 'hide:nav', 'show:nav']);
    expect([...overlays.values()].sort()).toEqual([1, 2, 3]);
    order.length = 0;
    openOverlay(navigation, 3);
    expect(order).toEqual(['show:nav']);
  });
});
