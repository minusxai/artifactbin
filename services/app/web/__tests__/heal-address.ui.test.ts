/**
 * THE ADDRESS BAR, HEALED IN PLACE. A shared `/a/<id>` (or a stale slug) is
 * served directly with the document's canonical path in the inlined page data
 * (server/app); the first module the entry evaluates puts that path in the
 * address bar — keeping the query and the fragment — before the router, the
 * initial-story capture or any data lookup reads it. Only an explicit
 * same-origin path the server named is ever written.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

const BOOTSTRAP = 'mx-page-data';
const ORIGIN = window.location.origin;
function serve(path: string, payload: Record<string, unknown> | null) {
  window.history.replaceState(null, '', path);
  document.getElementById(BOOTSTRAP)?.remove();
  if (!payload) return;
  const script = document.createElement('script');
  script.type = 'application/json';
  script.id = BOOTSTRAP;
  script.textContent = JSON.stringify(payload);
  // Where the server writes it: the body's last element, after the story (server/app withBootstrap).
  document.body.appendChild(script);
}
const evaluate = async () => { vi.resetModules(); await import('@/solid/lib/heal-address'); };
afterEach(() => { document.getElementById(BOOTSTRAP)?.remove(); window.history.replaceState(null, '', '/'); });

describe('heal-address', () => {
  it('replaces the served address with the canonical one, keeping query and fragment, without a new history entry', async () => {
    serve('/a/abc123?view=table#section-2', { path: '/@ada/abc123-report', address: '/@ada/abc123-report', artifact: {} });
    const entries = window.history.length;
    await evaluate();
    expect(window.location.pathname).toBe('/@ada/abc123-report');
    expect(window.location.search).toBe('?view=table');
    expect(window.location.hash).toBe('#section-2');
    expect(window.history.length).toBe(entries);
  });
  it('keeps /edit when the server names it', async () => {
    serve('/a/abc123/edit', { path: '/@ada/abc123-report/edit', address: '/@ada/abc123-report/edit' });
    await evaluate();
    expect(window.location.pathname).toBe('/@ada/abc123-report/edit');
  });
  it('leaves the address alone when the server named none', async () => {
    serve('/@ada/abc123-report?x=1', { path: '/@ada/abc123-report', artifact: {} });
    await evaluate();
    expect(window.location.pathname + window.location.search).toBe('/@ada/abc123-report?x=1');
    serve('/login', null);
    await evaluate();
    expect(window.location.pathname).toBe('/login');
  });
  it('never writes anything but a same-origin path', async () => {
    for (const address of ['//evil.example/x', 'https://evil.example/x', 'javascript:alert(1)', '/\\evil.example']) {
      serve('/a/abc123', { path: '/a/abc123', address });
      await evaluate();
      expect(window.location.pathname, address).toBe('/a/abc123');
      expect(window.location.origin, address).toBe(ORIGIN);
    }
  });
});
