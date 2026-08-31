/**
 * Which transport a served document gets — the one decision the entry makes:
 * a parent window → the relay (the page has the session); top-level with a
 * queryUrl → its own fetch; neither → none.
 */
import { describe, expect, it, vi } from 'vitest';
const APP = 'https://artifactbin.dev';
import { createDocumentTransport } from '@/lib/story-runtime/document-transport';
import { STORY_QUERY_MESSAGE } from '@/lib/story-runtime/contract';

const win = (parent: unknown) => {
  const self = { parent: null as unknown, addEventListener: vi.fn() };
  self.parent = parent === 'self' ? self : parent;
  return self;
};

describe('createDocumentTransport', () => {
  it('inside a parent: the relay — a run posts mx:query to that parent, whatever the island says', () => {
    const posted: unknown[] = [];
    const parent = { postMessage: (m: unknown) => posted.push(m) };
    const fetchFn = vi.fn();
    const t = createDocumentTransport(win(parent), '/a/abc123/query', APP, fetchFn);
    expect(t).not.toBeNull();
    void t!.run({ region: 'EU' }, ['sales']).catch(() => {});
    expect(posted[0]).toMatchObject({ type: STORY_QUERY_MESSAGE, values: { region: 'EU' }, only: ['sales'] });
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('top-level with a queryUrl: the fetch transport against that url', async () => {
    const fetchFn = vi.fn(async () => new Response(JSON.stringify({ tables: {}, errors: {} }), { status: 200 }));
    const t = createDocumentTransport(win('self'), '/a/abc123/query', APP, fetchFn);
    expect(t).not.toBeNull();
    await t!.run({}, ['q']);
    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect((fetchFn.mock.calls[0] as unknown as [string])[0]).toMatch(/^\/a\/abc123\/query\?q=/);
  });

  it('top-level with no queryUrl (a canvas or capture render): no transport', () => {
    expect(createDocumentTransport(win('self'), undefined, APP, vi.fn())).toBeNull();
  });

  it('a window with no parent at all (parent === null) counts as top-level', () => {
    const fetchFn = vi.fn(async () => new Response('{"tables":{},"errors":{}}', { status: 200 }));
    expect(createDocumentTransport(win(null), '/a/x/query', APP, fetchFn)).not.toBeNull();
    expect(createDocumentTransport(win(null), undefined, APP, fetchFn)).toBeNull();
  });
});
