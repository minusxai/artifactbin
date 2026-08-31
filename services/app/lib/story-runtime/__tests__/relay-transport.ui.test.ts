/**
 * The frame's query transport: a postMessage relay matched by id, results
 * accepted from the target window only, unanswered requests time out.
 */
import { describe, expect, it, vi } from 'vitest';
import { createRelayTransport } from '@/lib/story-runtime/relay-transport';
import { STORY_QUERY_MESSAGE, STORY_QUERY_RESULT_MESSAGE } from '@/lib/story-runtime/contract';

/** The origin the document was served from — the only one it will deal with. */
const APP = 'https://artifactbin.dev';

const fakeParent = () => {
  const posted: { message: unknown; target: string }[] = [];
  const target = { postMessage: (m: unknown, t: string) => posted.push({ message: m, target: t }) } as unknown as Window;
  return { target, posted, messages: () => posted.map((p) => p.message) };
};
const deliver = (source: Window, data: unknown, origin = APP) =>
  window.dispatchEvent(new MessageEvent('message', { data, origin, source: source as unknown as MessageEventSource }));

describe('createRelayTransport', () => {
  it('posts a request and resolves with the matching result', async () => {
    const { target, posted, messages } = fakeParent();
    const t = createRelayTransport(target, APP, window);
    const p = t.run({ region: 'EU' }, ['sales']);
    expect(messages()[0]).toEqual({ type: STORY_QUERY_MESSAGE, id: 1, values: { region: 'EU' }, only: ['sales'] });
    deliver(target, { type: STORY_QUERY_RESULT_MESSAGE, id: 1, tables: { sales: { rows: [{ a: 1 }], columns: [] } }, errors: {} });
    expect(await p).toEqual({ tables: { sales: { rows: [{ a: 1 }], columns: [] } }, errors: {} });
  });

  it('ignores results from any other window and results for another id', async () => {
    const { target } = fakeParent();
    const other = { postMessage: () => {} } as unknown as Window;
    const t = createRelayTransport(target, APP, window, 100);
    const p = t.run({}, ['q']);
    deliver(other, { type: STORY_QUERY_RESULT_MESSAGE, id: 1, tables: { q: { rows: [{ stranger: 1 }], columns: [] } }, errors: {} });
    deliver(target, { type: STORY_QUERY_RESULT_MESSAGE, id: 99, tables: { q: { rows: [{ wrong: 1 }], columns: [] } }, errors: {} });
    await expect(p).rejects.toThrow(/did not answer/);
  });

  it('page() sends a window request and resolves with that table', async () => {
    const { target, posted, messages } = fakeParent();
    const t = createRelayTransport(target, APP, window);
    const p = t.page({ region: 'EU' }, 'sales', { offset: 50, limit: 25, sort: { col: 'a', dir: 'asc' } });
    expect(messages()[0]).toEqual({ type: STORY_QUERY_MESSAGE, id: 1, values: { region: 'EU' }, only: ['sales'], page: { name: 'sales', offset: 50, limit: 25, sort: { col: 'a', dir: 'asc' } } });
    deliver(target, { type: STORY_QUERY_RESULT_MESSAGE, id: 1, tables: { sales: { rows: [{ a: 51 }], columns: [], totalRows: 900, truncated: true } }, errors: {} });
    expect(await p).toEqual({ rows: [{ a: 51 }], columns: [], totalRows: 900, truncated: true });
  });

  it('page() rejects with the query error when the window failed', async () => {
    const { target } = fakeParent();
    const t = createRelayTransport(target, APP, window);
    const p = t.page({}, 'sales', { offset: 0, limit: 1 });
    deliver(target, { type: STORY_QUERY_RESULT_MESSAGE, id: 1, tables: {}, errors: { sales: 'boom' } });
    await expect(p).rejects.toThrow('boom');
  });

  it('rejects with the relayed error', async () => {
    const { target } = fakeParent();
    const t = createRelayTransport(target, APP, window);
    const p = t.run({}, ['q']);
    deliver(target, { type: STORY_QUERY_RESULT_MESSAGE, id: 1, error: 'not found' });
    await expect(p).rejects.toThrow('not found');
  });

  it('times out an unanswered request', async () => {
    vi.useFakeTimers();
    const { target } = fakeParent();
    const t = createRelayTransport(target, APP, window, 50);
    const p = t.run({}, ['q']);
    vi.advanceTimersByTime(60);
    await expect(p).rejects.toThrow(/did not answer/);
    vi.useRealTimers();
  });
});

describe('who may answer a document\'s query', () => {
  it('ADDRESSES the request to the app origin, never broadcasts it', () => {
    // A query request carries the document's own parameters. `'*'` hands them
    // to whoever framed it.
    const { target, posted } = fakeParent();
    const t = createRelayTransport(target, APP, window);
    void t.run({ region: 'EU' }, ['sales']);
    expect(posted[0].target).toBe(APP);
  });

  it('REFUSES a result that did not come from the app origin', async () => {
    /*
     * The answer becomes the numbers a reader sees. A framer who could forge
     * one would not break the document — it would make it lie, which is worse
     * than a chart that fails to draw.
     */
    const { target } = fakeParent();
    const t = createRelayTransport(target, APP, window, 120);
    const run = t.run({}, ['sales']);
    deliver(target, { type: STORY_QUERY_RESULT_MESSAGE, id: 1, tables: { sales: [{ revenue: 999_999 }] }, errors: {} }, 'https://evil.example');
    await expect(run).rejects.toThrow(/did not answer/);
  });

  it('takes the result when the app origin sends it', async () => {
    const { target } = fakeParent();
    const t = createRelayTransport(target, APP, window, 500);
    const run = t.run({}, ['sales']);
    deliver(target, { type: STORY_QUERY_RESULT_MESSAGE, id: 1, tables: { sales: [{ revenue: 1 }] }, errors: {} });
    await expect(run).resolves.toMatchObject({ tables: { sales: [{ revenue: 1 }] } });
  });
});
