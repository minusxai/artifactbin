/**
 * The two INSTALLERS that make `?v=2` travel without being stored — the shape
 * minusx uses for `as_user` (`lib/http/fetch-patch.ts`): patch `window.fetch`
 * so every same-origin `/api/` call the client makes re-appends the flag, and
 * bridge in-app link clicks so navigation keeps it.
 *
 * Both are no-ops when the flag is absent, which is the normal case for every
 * visitor — a patch that rewrites URLs when there is nothing to carry is a
 * patch that can only cause harm.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { installPreviewFetch, installPreviewLinks } from '@/lib/features/install';

const calls: string[] = [];
let restore: (() => void) | null = null;

beforeEach(() => {
  calls.length = 0;
  window.history.replaceState({}, '', '/');
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
    calls.push(typeof input === 'string' ? input : input instanceof URL ? input.href : (input as Request).url);
    return new Response('{}', { status: 200 });
  }));
});
afterEach(() => { restore?.(); restore = null; vi.unstubAllGlobals(); document.body.innerHTML = ''; });

const at = (search: string) => window.history.replaceState({}, '', `/somewhere${search}`);

describe('installPreviewFetch', () => {
  it('re-appends ?v=2 to same-origin /api/ calls while the page carries it', async () => {
    at('?v=2');
    restore = installPreviewFetch(window);
    await window.fetch('/api/my/artifacts');
    await window.fetch('/api/my/artifacts/x/sharing');
    expect(calls).toEqual(['/api/my/artifacts?v=2', '/api/my/artifacts/x/sharing?v=2']);
  });

  it('accepts a URL and a Request, not only a string', async () => {
    at('?v=2');
    restore = installPreviewFetch(window);
    await window.fetch(new URL('/api/x', location.origin));
    await window.fetch(new Request(`${location.origin}/api/y`, { method: 'POST' }));
    expect(calls[0]).toContain('/api/x?v=2');
    expect(calls[1]).toContain('/api/y?v=2');
  });

  it('touches NOTHING when the page has no flag — the common case', async () => {
    at('');
    restore = installPreviewFetch(window);
    await window.fetch('/api/my/artifacts');
    expect(calls).toEqual(['/api/my/artifacts']);
  });

  it('leaves non-API and cross-origin requests alone, and never doubles the parameter', async () => {
    at('?v=2');
    restore = installPreviewFetch(window);
    await window.fetch('/a/abc123/raw');
    await window.fetch('https://example.com/api/x');
    await window.fetch('/api/x?v=2');
    expect(calls).toEqual(['/a/abc123/raw', 'https://example.com/api/x', '/api/x?v=2']);
  });

  it('is idempotent, and restoring puts the original fetch back', async () => {
    at('?v=2');
    const original = window.fetch;
    const off1 = installPreviewFetch(window);
    const off2 = installPreviewFetch(window);
    await window.fetch('/api/x');
    expect(calls).toEqual(['/api/x?v=2']);
    off2(); off1();
    expect(window.fetch).toBe(original);
  });
});

describe('installPreviewLinks', () => {
  const click = (a: HTMLAnchorElement, init: MouseEventInit = {}) => {
    const e = new MouseEvent('click', { bubbles: true, cancelable: true, button: 0, ...init });
    a.dispatchEvent(e);
    return e;
  };
  const anchor = (href: string, attrs: Record<string, string> = {}) => {
    const a = document.createElement('a');
    a.setAttribute('href', href);
    for (const [k, v] of Object.entries(attrs)) a.setAttribute(k, v);
    document.body.appendChild(a);
    return a;
  };

  it('rewrites a same-origin in-app link so navigation keeps the flag', () => {
    at('?v=2');
    restore = installPreviewLinks(document);
    const a = anchor('/tokens');
    click(a);
    expect(a.getAttribute('href')).toBe('/tokens?v=2');
  });

  it('leaves cross-origin links, downloads, targeted links and modified clicks alone', () => {
    at('?v=2');
    restore = installPreviewLinks(document);
    for (const [a, init] of [
      [anchor('https://example.com/x'), {}],
      [anchor('/x', { download: '' }), {}],
      [anchor('/x', { target: '_blank' }), {}],
      [anchor('/y'), { metaKey: true }],
    ] as Array<[HTMLAnchorElement, MouseEventInit]>) {
      const before = a.getAttribute('href');
      click(a, init);
      expect(a.getAttribute('href')).toBe(before);
    }
  });

  it('does nothing at all without the flag', () => {
    at('');
    restore = installPreviewLinks(document);
    const a = anchor('/tokens');
    click(a);
    expect(a.getAttribute('href')).toBe('/tokens');
  });
});
