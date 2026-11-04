/**
 * The parent's region client (lib/artifact-backend/region-http) against a fake region server that speaks the contract
 * (services/contracts/src/region-sessions.ts): one Y.Doc per region, a seq per stored update, out_of_order when an
 * update depends on structs it does not hold, and an SSE stream driven by the test.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';
import type { RegionOpenReply, RegionStreamFrame } from '@artifactbin/contracts';
import { createRegionClient, decodeBase64, encodeBase64, REGION_BATCH_MS, type RegionClientEvents } from '../region-http';

interface FakeStream { url: string; onMessage?: (data: string) => void; onReconnect?: () => void; closed: boolean }

/** The region server, as the contract describes it. */
function fakeServer() {
  let doc = new Y.Doc();
  const calls: Array<{ path: string; init: RequestInit; body: unknown }> = [];
  const stored: Uint8Array[] = [];
  let seq = 0;
  let version = 1;
  const server = {
    get doc() { return doc; },
    calls, stored,
    /** The server loses everything after `state` (the test's stand-in for a store that is behind the client). */
    rollback(state: Uint8Array) { doc = new Y.Doc(); Y.applyUpdate(doc, state); },
    seq: () => seq,
    /** Hold replies until released, to observe in-flight requests. */
    hold: false,
    held: [] as Array<() => void>,
    /** The next update request fails like this, once. */
    failNext: null as null | 'network' | 'server' | { status: number; body: unknown },
    refuseOpen: false,
    edit(write: (text: Y.Text) => void): Uint8Array {
      const remote = new Y.Doc();
      Y.applyUpdate(remote, Y.encodeStateAsUpdate(doc));
      const before = Y.encodeStateVector(remote);
      write(remote.getText('region'));
      const update = Y.encodeStateAsUpdate(remote, before);
      Y.applyUpdate(doc, update);
      stored.push(update);
      seq++;
      return update;
    },
    text: () => doc.getText('region').toString(),
    async fetch(path: string, init: RequestInit = {}): Promise<Response> {
      const body = typeof init.body === 'string' ? JSON.parse(init.body) as unknown : null;
      calls.push({ path, init, body });
      if (server.hold) await new Promise<void>((resolve) => server.held.push(resolve));
      const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } });
      if (path.endsWith('/open')) {
        if (server.refuseOpen) return json({ error: 'Not found' }, 404);
        const reply: RegionOpenReply = { regionId: 'r1', kind: 'rich', clientId: 42, seq, state: encodeBase64(Y.encodeStateAsUpdate(doc)), savedVersion: version };
        return json(reply);
      }
      if (path.endsWith('/flush')) return json({ version: ++version });
      if (path.endsWith('/updates')) {
        const failure = server.failNext;
        server.failNext = null;
        if (failure === 'network') throw new TypeError('Failed to fetch');
        if (failure === 'server') return json({ error: 'busy' }, 503);
        if (failure) return json(failure.body, failure.status);
        const update = decodeBase64((body as { update: string }).update);
        const before = Y.encodeStateVector(doc);
        const trial = new Y.Doc();
        Y.applyUpdate(trial, Y.encodeStateAsUpdate(doc));
        Y.applyUpdate(trial, update);
        const pending = trial.store as unknown as { pendingStructs: unknown; pendingDs: unknown };
        if (pending.pendingStructs || pending.pendingDs) return json({ error: 'out_of_order', stateVector: encodeBase64(before) }, 409);
        Y.applyUpdate(doc, update);
        if (Buffer.from(Y.encodeStateVector(doc)).equals(Buffer.from(before))) return json({ seq, duplicate: true });
        stored.push(update);
        return json({ seq: ++seq });
      }
      return json({ error: 'unknown' }, 404);
    },
  };
  return server;
}

function setup() {
  const server = fakeServer();
  const streams: FakeStream[] = [];
  const seen = { remote: [] as Array<{ regionId: string; updates: Uint8Array[]; seq: number }>, acks: [] as Array<[string, number]>, closed: [] as Array<[string, string]>, saved: [] as number[] };
  const events: RegionClientEvents = {
    remote: (regionId, updates, seq) => seen.remote.push({ regionId, updates, seq }),
    ack: (regionId, seq) => seen.acks.push([regionId, seq]),
    closed: (regionId, reason) => seen.closed.push([regionId, reason]),
    saved: (version) => seen.saved.push(version),
  };
  const client = createRegionClient('doc1', events, {
    fetch: (path, init) => server.fetch(path, init),
    openStream: (options) => {
      const stream: FakeStream = { url: typeof options.url === 'function' ? options.url() : options.url, onMessage: options.onMessage, onReconnect: options.onReconnect, closed: false };
      streams.push(stream);
      return { close: () => { stream.closed = true; } };
    },
    random: () => 0,
  });
  const live = () => streams.filter((stream) => !stream.closed);
  const frame = (value: RegionStreamFrame) => { for (const stream of live()) stream.onMessage?.(JSON.stringify(value)); };
  /** A local editor that starts from the session's state and produces updates as the frame would. */
  const editor = (state: Uint8Array) => {
    const doc = new Y.Doc();
    doc.clientID = 42;
    Y.applyUpdate(doc, state);
    return {
      doc,
      type(at: number, text: string): Uint8Array { const before = Y.encodeStateVector(doc); doc.getText('region').insert(at, text); return Y.encodeStateAsUpdate(doc, before); },
      apply(update: Uint8Array) { Y.applyUpdate(doc, update); },
      text: () => doc.getText('region').toString(),
    };
  };
  const updatePosts = () => server.calls.filter((call) => call.path.endsWith('/updates'));
  return { server, client, streams, live, frame, seen, editor, updatePosts };
}

const settle = async () => { for (let i = 0; i < 10; i++) await Promise.resolve(); await vi.advanceTimersByTimeAsync(0); };

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); });

describe('createRegionClient', () => {
  it('opens a region over the page\'s own session and streams after its seq', async () => {
    const t = setup();
    t.server.edit((text) => text.insert(0, 'Hello'));
    const session = await t.client.open('r1');
    expect(session).toMatchObject({ regionId: 'r1', kind: 'rich', clientId: 42, seq: 1, savedVersion: 1 });
    expect(t.editor(session!.state).text()).toBe('Hello');
    expect(t.server.calls[0]).toMatchObject({ path: '/api/artifacts/doc1/regions/r1/open', init: { method: 'POST', credentials: 'same-origin' } });
    expect(t.live().map((stream) => stream.url)).toEqual(['/api/artifacts/doc1/regions/stream?after=r1:1']);
  });

  it('a refused open is null and opens no stream', async () => {
    const t = setup();
    t.server.refuseOpen = true;
    expect(await t.client.open('r1')).toBeNull();
    expect(t.streams).toEqual([]);
  });

  it(`coalesces updates pushed within ${REGION_BATCH_MS} ms into one merged request`, async () => {
    const t = setup();
    const session = await t.client.open('r1');
    const local = t.editor(session!.state);
    t.client.push('r1', local.type(0, 'a'));
    await vi.advanceTimersByTimeAsync(20);
    t.client.push('r1', local.type(1, 'b'));
    t.client.push('r1', local.type(2, 'c'));
    expect(t.updatePosts()).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(REGION_BATCH_MS);
    await settle();
    expect(t.updatePosts()).toHaveLength(1);
    expect(t.updatePosts()[0]!.body).toMatchObject({ clientId: 42 });
    expect(t.server.text()).toBe('abc');
    expect(t.seen.acks).toEqual([['r1', 1]]);
  });

  it('keeps one request in flight per region; what arrives meanwhile goes as one request after the reply', async () => {
    const t = setup();
    const session = await t.client.open('r1');
    const local = t.editor(session!.state);
    t.server.hold = true;
    t.client.push('r1', local.type(0, 'a'));
    await vi.advanceTimersByTimeAsync(REGION_BATCH_MS);
    expect(t.updatePosts()).toHaveLength(1);
    t.client.push('r1', local.type(1, 'b'));
    await vi.advanceTimersByTimeAsync(REGION_BATCH_MS * 4);
    t.client.push('r1', local.type(2, 'c'));
    await vi.advanceTimersByTimeAsync(REGION_BATCH_MS * 4);
    expect(t.updatePosts()).toHaveLength(1);
    t.server.hold = false;
    t.server.held.shift()!();
    await settle();
    expect(t.updatePosts()).toHaveLength(2);
    await settle();
    expect(t.server.text()).toBe('abc');
    expect(t.seen.acks).toEqual([['r1', 1], ['r1', 2]]);
  });

  it('retries a failed request with backoff, and resends it at once when the stream reconnects', async () => {
    const t = setup();
    const session = await t.client.open('r1');
    const local = t.editor(session!.state);
    t.server.failNext = 'network';
    t.client.push('r1', local.type(0, 'x'));
    await vi.advanceTimersByTimeAsync(REGION_BATCH_MS);
    await settle();
    expect(t.updatePosts()).toHaveLength(1);
    // The first retry waits half of a 1 s backoff (random 0): nothing is sent before it.
    await vi.advanceTimersByTimeAsync(400);
    expect(t.updatePosts()).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(200);
    await settle();
    expect(t.updatePosts()).toHaveLength(2);
    expect(t.server.text()).toBe('x');
    // A second failure, then a reconnect: the unacked update is resent without waiting out the backoff.
    t.server.failNext = 'server';
    t.client.push('r1', local.type(1, 'y'));
    await vi.advanceTimersByTimeAsync(REGION_BATCH_MS);
    await settle();
    expect(t.updatePosts()).toHaveLength(3);
    t.live()[0]!.onReconnect?.();
    await settle();
    expect(t.updatePosts()).toHaveLength(4);
    expect(t.server.text()).toBe('xy');
    expect(t.seen.acks.map(([, seq]) => seq)).toEqual([1, 2]);
  });

  it('answers out_of_order by sending everything the server\'s state vector lacks, not the same request again', async () => {
    const t = setup();
    const session = await t.client.open('r1');
    const local = t.editor(session!.state);
    const empty = Y.encodeStateAsUpdate(t.server.doc);
    t.client.push('r1', local.type(0, 'one '));
    await vi.advanceTimersByTimeAsync(REGION_BATCH_MS);
    await settle();
    expect(t.seen.acks).toEqual([['r1', 1]]);
    // The server no longer holds the acked edit; the next one depends on it and is refused as out of order.
    t.server.rollback(empty);
    t.client.push('r1', local.type(4, 'two'));
    await vi.advanceTimersByTimeAsync(REGION_BATCH_MS);
    await settle();
    await settle();
    const statuses = t.updatePosts().length;
    expect(statuses).toBe(3);
    expect(t.server.text()).toBe('one two');
    expect(t.seen.closed).toEqual([]);
  });

  it('relays the stream\'s updates in order, drops repeats and reopens after a gap', async () => {
    const t = setup();
    const session = await t.client.open('r1');
    const local = t.editor(session!.state);
    const a = t.server.edit((text) => text.insert(0, 'A'));
    const b = t.server.edit((text) => text.insert(1, 'B'));
    t.frame({ type: 'updates', regionId: 'r1', from: 1, to: 2, updates: [encodeBase64(a), encodeBase64(b)] });
    t.frame({ type: 'updates', regionId: 'r1', from: 2, to: 2, updates: [encodeBase64(b)] });
    t.frame({ type: 'updates', regionId: 'other', from: 1, to: 1, updates: [encodeBase64(a)] });
    expect(t.seen.remote.map((entry) => [entry.regionId, entry.seq, entry.updates.length])).toEqual([['r1', 2, 2]]);
    for (const update of t.seen.remote[0]!.updates) local.apply(update);
    expect(local.text()).toBe('AB');
    // A frame that skips seq 3 is a gap: the stream is reopened after seq 2.
    t.server.edit((text) => text.insert(2, 'C'));
    const d = t.server.edit((text) => text.insert(3, 'D'));
    t.frame({ type: 'updates', regionId: 'r1', from: 4, to: 4, updates: [encodeBase64(d)] });
    expect(t.seen.remote).toHaveLength(1);
    expect(t.live().map((stream) => stream.url)).toEqual(['/api/artifacts/doc1/regions/stream?after=r1:2']);
    expect(t.streams).toHaveLength(2);
  });

  it('a reset delivers the full state and resends what the new state lacks', async () => {
    const t = setup();
    const session = await t.client.open('r1');
    const local = t.editor(session!.state);
    const empty = Y.encodeStateAsUpdate(t.server.doc);
    t.client.push('r1', local.type(0, 'mine'));
    await vi.advanceTimersByTimeAsync(REGION_BATCH_MS);
    await settle();
    expect(t.seen.acks).toEqual([['r1', 1]]);
    // The server's state moved on without this client's acked edit (its log was compacted past the cursor).
    t.server.rollback(empty);
    t.server.edit((text) => text.insert(0, 'theirs '));
    const state = Y.encodeStateAsUpdate(t.server.doc);
    const resetSeq = t.server.seq();
    t.frame({ type: 'reset', regionId: 'r1', seq: resetSeq, state: encodeBase64(state) });
    expect(t.seen.remote.at(-1)).toMatchObject({ regionId: 'r1', seq: resetSeq });
    local.apply(t.seen.remote.at(-1)!.updates[0]!);
    await vi.advanceTimersByTimeAsync(REGION_BATCH_MS);
    await settle();
    expect(t.updatePosts()).toHaveLength(2);
    expect(t.server.text()).toBe(local.text());
    expect(t.server.text()).toContain('mine');
    expect(t.server.text()).toContain('theirs');
    // A reset that holds everything sends nothing.
    t.frame({ type: 'reset', regionId: 'r1', seq: t.server.seq(), state: encodeBase64(Y.encodeStateAsUpdate(t.server.doc)) });
    await vi.advanceTimersByTimeAsync(REGION_BATCH_MS * 4);
    expect(t.updatePosts()).toHaveLength(2);
  });

  it('closes a region the server refuses or closes, and tells the frame why', async () => {
    const t = setup();
    const session = await t.client.open('r1');
    const local = t.editor(session!.state);
    t.server.failNext = { status: 422, body: { error: 'unsupported_content' } };
    t.client.push('r1', local.type(0, 'x'));
    await vi.advanceTimersByTimeAsync(REGION_BATCH_MS);
    await settle();
    expect(t.seen.closed).toEqual([['r1', 'unsupported_content']]);
    t.client.push('r1', local.type(1, 'y'));
    await vi.advanceTimersByTimeAsync(REGION_BATCH_MS * 10);
    expect(t.updatePosts()).toHaveLength(1);
    const again = await t.client.open('r1');
    t.frame({ type: 'closed', regionId: 'r1', reason: 'access' });
    expect(again).not.toBeNull();
    expect(t.seen.closed.at(-1)).toEqual(['r1', 'access']);
  });

  it('flush sends pending edits first, waits for their acks, then saves and returns the version', async () => {
    const t = setup();
    const session = await t.client.open('r1');
    const local = t.editor(session!.state);
    t.client.push('r1', local.type(0, 'typed'));
    t.server.hold = true;
    const version = t.client.flush();
    await settle();
    // The edit is in flight and unacknowledged: no save is asked for yet.
    expect(t.server.calls.map((call) => call.path.split('/').at(-1))).toEqual(['open', 'updates']);
    t.server.hold = false;
    t.server.held.shift()!();
    await settle();
    await settle();
    expect(await version).toBe(2);
    const paths = t.server.calls.map((call) => call.path.split('/').at(-1));
    expect(paths).toEqual(['open', 'updates', 'flush']);
    expect(t.server.text()).toBe('typed');
  });

  it('a saved frame reports the version; leaving sends pending edits with keepalive and closes the stream', async () => {
    const t = setup();
    const session = await t.client.open('r1');
    t.frame({ type: 'saved', version: 7, regions: { r1: 0 } });
    expect(t.seen.saved).toEqual([7]);
    const local = t.editor(session!.state);
    t.client.push('r1', local.type(0, 'bye'));
    t.client.leave();
    await settle();
    expect(t.updatePosts()).toHaveLength(1);
    expect(t.updatePosts()[0]!.init.keepalive).toBe(true);
    expect(t.live()).toEqual([]);
    t.client.resume();
    expect(t.live()).toHaveLength(1);
    t.client.dispose();
    expect(t.live()).toEqual([]);
  });
});
