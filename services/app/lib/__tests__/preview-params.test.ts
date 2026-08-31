/**
 * `?v=2` LIVES IN THE URL AND NOWHERE ELSE.
 *
 * Ported in shape from minusx `lib/navigation/url-utils.ts` + `lib/http/fetch-patch.ts`
 * (`as_user` / `mode` / `view`): the flag is a query parameter that travels by
 * being RE-APPENDED — to every same-origin `/api/` request the client makes,
 * and to every in-app link — never by being stored. No cookie, so there is no
 * state to go stale, nothing to clear, and a URL that says exactly what the
 * page is doing. Copy the address bar and you have handed someone the same
 * mode you are in; strip the parameter and you are out.
 *
 * Pure and browser-free here; the installers are tested in jsdom
 * (lib/__tests__/preview-fetch-patch.ui.test.ts).
 */
import { describe, expect, it } from 'vitest';
import { PREVIEW_PARAM, PREVIEW_VERSION, previewEnabled, previewFrom, preserveParams } from '@/lib/features';
import { request } from '@/__tests__/harness';

const previewRequest = (url: string, headers: Record<string, string> = {}) => {
  const parsed = new URL(url);
  return request(`${parsed.pathname}${parsed.search}`, { headers });
};

describe('previewEnabled — the URL is the only source', () => {
  it('reads ?v=2 off the request, and nothing else', () => {
    expect(previewEnabled(previewRequest('http://x/a/y?v=2'))).toBe(true);
    expect(previewEnabled(previewRequest('http://x/a/y?v=1'))).toBe(false);
    expect(previewEnabled(previewRequest('http://x/a/y'))).toBe(false);
    expect(previewEnabled(previewRequest('http://x/a/y?v=3'))).toBe(false);
    expect(previewEnabled(previewRequest('http://x/a/y?other=2'))).toBe(false);
  });

  it('IGNORES a cookie that claims the preview — there is no cookie carrier', () => {
    expect(previewEnabled(previewRequest('http://x/a/y', { cookie: 'mx_v=2' }))).toBe(false);
    // …and a cookie cannot turn one OFF either.
    expect(previewEnabled(previewRequest('http://x/a/y?v=2', { cookie: 'mx_v=1' }))).toBe(true);
  });

  it('previewFrom reads the same answer out of a bare query string (what a page has)', () => {
    expect(previewFrom('v=2')).toBe(true);
    expect(previewFrom('?v=2')).toBe(true);
    expect(previewFrom(new URLSearchParams('v=2'))).toBe(true);
    expect(previewFrom({ v: '2' })).toBe(true);
    expect(previewFrom({ v: ['2'] })).toBe(true);
    expect(previewFrom(undefined)).toBe(false);
    expect(previewFrom('v=1')).toBe(false);
  });
});

describe('preserveParams — how the flag travels', () => {
  it('carries ?v=2 onto a target when the current URL has it, and leaves it off otherwise', () => {
    expect(preserveParams('/tokens', 'v=2')).toBe('/tokens?v=2');
    expect(preserveParams('/tokens', '')).toBe('/tokens');
    expect(preserveParams('/tokens', 'v=1')).toBe('/tokens');
  });

  it('keeps the target\'s own query and hash, and never duplicates the parameter', () => {
    expect(preserveParams('/a/x?edit=1', 'v=2')).toBe('/a/x?edit=1&v=2');
    expect(preserveParams('/a/x?v=2', 'v=2')).toBe('/a/x?v=2');
    expect(preserveParams('/a/x#edit', 'v=2')).toBe('/a/x?v=2#edit');
  });

  it('leaves a CROSS-ORIGIN target alone — the flag is ours, not theirs', () => {
    expect(preserveParams('https://example.com/x', 'v=2')).toBe('https://example.com/x');
    expect(preserveParams('mailto:a@b.com', 'v=2')).toBe('mailto:a@b.com');
  });


  it('names its own contract', () => {
    expect(PREVIEW_PARAM).toBe('v');
    expect(PREVIEW_VERSION).toBe('2');
  });
});
