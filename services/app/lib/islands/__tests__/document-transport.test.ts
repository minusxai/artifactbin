/**
 * Which transport a served document gets — the one decision the entry makes. No parent page relays a
 * document's queries any more: a framed sandboxed copy fetches anonymously, and a document that needs its
 * reader is framed on its OWN origin, where it calls its doors directly with its pages cookie.
 */
import { describe, expect, it, vi } from 'vitest';
import { createDocumentTransport } from '@/lib/islands/document-transport';
import { createFetchTransport } from '@/lib/page-store/fetch-transport';

const win = (parent: unknown) => {
  const self = { parent: null as unknown };
  self.parent = parent === 'self' ? self : parent;
  return self;
};
const answer = () => new Response(JSON.stringify({ tables: {}, errors: {} }), { status: 200 });

describe('createDocumentTransport', () => {
  it('inside a parent: the fetch transport, anonymously — nothing is posted to the parent', async () => {
    const parent = { postMessage: vi.fn() };
    const fetchFn = vi.fn(async () => answer());
    const t = createDocumentTransport(win(parent), '/a/abc123/query', fetchFn, undefined, { session: true });
    await t!.run({ region: 'EU' }, ['sales']);
    expect(parent.postMessage).not.toHaveBeenCalled();
    const [url, init] = fetchFn.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toMatch(/^\/a\/abc123\/query\?q=/);
    expect(init.credentials).toBe('omit');
  });

  it('top-level with a queryUrl: the fetch transport against that url, with the session when signed in', async () => {
    const fetchFn = vi.fn(async () => answer());
    const t = createDocumentTransport(win('self'), '/a/abc123/query', fetchFn, undefined, { session: true });
    await t!.run({}, ['q']);
    const [url, init] = fetchFn.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('/a/abc123/query');
    expect(init).toMatchObject({ method: 'POST', credentials: 'same-origin' });
  });

  it('no queryUrl (a canvas or capture render): no transport, framed or not', () => {
    expect(createDocumentTransport(win('self'), undefined, vi.fn(), undefined)).toBeNull();
    expect(createDocumentTransport(win({ postMessage: vi.fn() }), undefined, vi.fn(), undefined)).toBeNull();
  });

  it('a window with no parent at all (parent === null) counts as top-level', () => {
    expect(createDocumentTransport(win(null), '/a/x/query', vi.fn(async () => answer()), undefined)).not.toBeNull();
  });

  it('never imports an asset itself: the element is the transport', () => {
    expect(createDocumentTransport(win({ postMessage: vi.fn() }), '/a/abc123/query', vi.fn(), undefined)!.importAsset).toBeUndefined();
  });
});

describe('the direct transport of a document on its own origin', () => {
  it('calls its absolute doors with credentials included, so its pages cookie rides along', async () => {
    const fetchFn = vi.fn(async () => answer());
    const self = 'https://416233784b39.pages.example.com';
    const t = createFetchTransport(`${self}/a/Ab3xK9/query`, fetchFn, `${self}/a/Ab3xK9/mutate`, { session: true, credentials: 'include' });
    await t.run({}, ['q']);
    fetchFn.mockImplementationOnce(async () => new Response(JSON.stringify({ ok: true, dataset: 'd' }), { status: 200 }));
    await t.mutate!({ mutation: 'inc', values: {} } as never);
    const calls = fetchFn.mock.calls as unknown as Array<[string, RequestInit]>;
    expect(calls.map(([url]) => url)).toEqual([`${self}/a/Ab3xK9/query`, `${self}/a/Ab3xK9/mutate`]);
    for (const [, init] of calls) expect(init).toMatchObject({ method: 'POST', credentials: 'include' });
  });
});
