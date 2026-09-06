/**
 * THE WRITE RELAY — how a PRIVATE document writes.
 *
 * A served document inside a parent page is opaque-origin: it cannot present
 * the session, so its own POST would be refused. The frame posts the mutation
 * NAME and its values to the page, the page (which holds the session) calls
 * `POST /a/<id>/mutate` and posts the answer back. This is the ONLY path by
 * which a private document's buttons do anything at all, so it is tested at
 * both ends: the frame's transport here, and the page's half in
 * components/__tests__/mutate-relay.ui.test.tsx.
 *
 * The envelope is scoped exactly as the query relay's is — addressed to the
 * app's origin, accepted only from the parent window AT that origin — because
 * a forged answer here would not break the document, it would make it lie
 * about whether a write landed.
 */
import { describe, expect, it, vi } from 'vitest';
import { STORY_MUTATE_MESSAGE, STORY_MUTATE_RESULT_MESSAGE, STORY_QUERY_RESULT_MESSAGE } from '@/lib/story-runtime/contract';
import { createRelayTransport } from '@/lib/story-runtime/relay-transport';

const ORIGIN = 'https://app.test';

/** A window pair: what the frame posts, and a way to answer as the parent. */
function wire() {
  const posted: Array<{ message: Record<string, unknown>; origin: string }> = [];
  const listeners: Array<(e: MessageEvent) => void> = [];
  const target = { postMessage: (message: unknown, origin: string) => posted.push({ message: message as Record<string, unknown>, origin }) } as unknown as Window;
  const source = {
    addEventListener: (_t: string, fn: (e: MessageEvent) => void) => listeners.push(fn),
  } as unknown as Window;
  const answer = (data: unknown, over: { source?: unknown; origin?: string } = {}) => {
    const event = { data, source: over.source ?? target, origin: over.origin ?? ORIGIN } as MessageEvent;
    for (const fn of [...listeners]) fn(event);
  };
  return { posted, target, source, answer };
}

const setup = () => {
  const w = wire();
  return { ...w, transport: createRelayTransport(w.target, ORIGIN, w.source, 50) };
};

describe('relay transport — mutate', () => {
  it('carries local rows and returns the local SQL result without losing it', async () => {
    const {transport, posted, answer} = setup();
    const local = {target: 'drafts', affected: 1, table: {columns: [{name: 'id', type: 'number'}], rows: [{id: 2}]}};
    const done = transport.mutate!({}, 'add', undefined, {drafts: []});
    answer({type: STORY_MUTATE_RESULT_MESSAGE, id: posted[0].message.id, ok: true, dataset: '', local});
    expect(await done).toEqual({dataset: '', local});
    expect(posted[0].message).toMatchObject({localTables: {drafts: []}});
    const query = transport.run({}, ['q'], {drafts: [{id: 2}]});
    answer({type: STORY_QUERY_RESULT_MESSAGE, id: posted.at(-1)!.message.id, tables: {}, errors: {}});
    await query;
    expect(posted.at(-1)!.message).toMatchObject({localTables: {drafts: [{id: 2}]}});
  });
  it('posts the name and values to the parent, at the app origin, and resolves with the dataset written', async () => {
    const { transport, posted, answer } = setup();
    const done = transport.mutate!({ choice: 'tacos' }, 'vote');
    expect(posted).toHaveLength(1);
    expect(posted[0].origin).toBe(ORIGIN);
    expect(posted[0].message).toMatchObject({ type: STORY_MUTATE_MESSAGE, mutation: 'vote', values: { choice: 'tacos' } });
    answer({ type: STORY_MUTATE_RESULT_MESSAGE, id: posted[0].message.id, ok: true, dataset: 'k3Pq9z', version: 2, affected: 1 });
    await expect(done).resolves.toEqual({ dataset: 'k3Pq9z' });
  });

  it('rejects with the page\'s message when the write was refused', async () => {
    const { transport, posted, answer } = setup();
    const done = transport.mutate!({}, 'vote');
    answer({ type: STORY_MUTATE_RESULT_MESSAGE, id: posted[0].message.id, ok: false, error: 'this dataset is not open for writes' });
    await expect(done).rejects.toThrow(/not open for writes/);
  });

  it('IGNORES an answer from another window, or from another origin — a forged one would make the document lie', async () => {
    const { transport, posted, answer } = setup();
    const done = transport.mutate!({}, 'vote');
    const id = posted[0].message.id;
    answer({ type: STORY_MUTATE_RESULT_MESSAGE, id, ok: true, dataset: 'evil' }, { source: {} });
    answer({ type: STORY_MUTATE_RESULT_MESSAGE, id, ok: true, dataset: 'evil' }, { origin: 'https://evil.test' });
    await expect(done).rejects.toThrow(/did not answer/);
  });

  it('does not confuse a QUERY answer with a write answer (separate waiter maps, same ids)', async () => {
    const { transport, posted, answer } = setup();
    const write = transport.mutate!({}, 'vote');
    const id = posted[0].message.id;
    answer({ type: STORY_QUERY_RESULT_MESSAGE, id, tables: {}, errors: {} });
    await expect(write).rejects.toThrow(/did not answer/);
  });

  it('times out rather than hanging when the page never answers', async () => {
    vi.useFakeTimers();
    const { transport } = setup();
    const done = transport.mutate!({}, 'vote');
    const assertion = expect(done).rejects.toThrow(/did not answer the write/);
    await vi.advanceTimersByTimeAsync(60);
    await assertion;
    vi.useRealTimers();
  });

  it('matches concurrent writes to their own answers, by id', async () => {
    const { transport, posted, answer } = setup();
    const a = transport.mutate!({}, 'vote');
    const b = transport.mutate!({}, 'clear');
    answer({ type: STORY_MUTATE_RESULT_MESSAGE, id: posted[1].message.id, ok: true, dataset: 'second' });
    answer({ type: STORY_MUTATE_RESULT_MESSAGE, id: posted[0].message.id, ok: true, dataset: 'first' });
    expect(await b).toEqual({ dataset: 'second' });
    expect(await a).toEqual({ dataset: 'first' });
  });
});
