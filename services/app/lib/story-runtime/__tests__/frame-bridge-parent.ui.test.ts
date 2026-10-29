import { describe, expect, it, vi } from 'vitest';
import { STORY_FRAME_BRIDGE_MESSAGE, STORY_URL_VALUES_MESSAGE } from '../contract';
import { createFrameBridgeParent, relayedRequest, urlValuesOf } from '../frame-bridge/parent';

const APP = 'https://app.example', FRAME = 'https://doc.pages.example';
function setup(frameOrigin = FRAME, extra: Partial<Parameters<typeof createFrameBridgeParent>[0]> = {}) {
  const posted: Array<{ data: { key: string; payload: { kind: string } & Record<string, unknown> }; target: string }> = [];
  const contentWindow = { postMessage: (data: never, target: string) => posted.push({ data, target }) };
  const win = Object.assign(new EventTarget(), { location: { origin: APP } }) as unknown as Window;
  const frame = Object.assign(new EventTarget(), { contentWindow, clientLeft: 2, clientTop: 3, clientWidth: 300, clientHeight: 200, getBoundingClientRect: () => ({ left: 10, top: 20 }) }) as unknown as HTMLIFrameElement;
  const events = { ready: [] as string[], closed: [] as string[], values: [] as string[], scroll: [] as unknown[], pressed: 0 };
  const appFetch = vi.fn(async () => new Response('{"ok":true}', { status: 200, headers: { 'content-type': 'application/json', 'x-secret': 'no', 'retry-after': '3' } }));
  const bridge = createFrameBridgeParent({
    win, frame, frameOrigin, id: 'doc', nodes: [], editId: () => 'edit_1', source: () => '<p/>', appFetch,
    onReady: nonce => events.ready.push(nonce), onClosed: reason => events.closed.push(reason), onUrlValues: search => events.values.push(search),
    onScroll: value => events.scroll.push(value), onPressed: () => { events.pressed++; }, ...extra,
  });
  const key = () => posted.at(-1)!.data.key;
  const from = (data: unknown, overrides: { origin?: string; source?: unknown } = {}) =>
    win.dispatchEvent(Object.assign(new Event('message'), { data, origin: overrides.origin ?? frameOrigin, source: 'source' in overrides ? overrides.source : contentWindow }));
  const say = (payload: Record<string, unknown>, withKey = key()) => from({ type: STORY_FRAME_BRIDGE_MESSAGE, key: withKey, payload });
  return { bridge, posted, win, frame, events, appFetch, key, from, say, kinds: () => posted.map(p => p.data.payload.kind) };
}
const flush = () => new Promise(resolve => setTimeout(resolve, 0));

describe('urlValuesOf', () => {
  it('takes a bounded query string without hash or whitespace from a url-values message', () => {
    expect(urlValuesOf({ type: STORY_URL_VALUES_MESSAGE, search: '?$region=north' })).toBe('?$region=north');
    expect(urlValuesOf({ type: STORY_URL_VALUES_MESSAGE, search: '' })).toBe('');
    for (const data of [null, 'x', { type: 'mx:other', search: '?a=1' }, { type: STORY_URL_VALUES_MESSAGE, search: '?a=1#h' }, { type: STORY_URL_VALUES_MESSAGE, search: '?a= 1' }, { type: STORY_URL_VALUES_MESSAGE, search: 7 }, { type: STORY_URL_VALUES_MESSAGE, search: '?' + 'a'.repeat(8192) }])
      expect(urlValuesOf(data)).toBeNull();
  });
});

describe('relayedRequest', () => {
  const win = { location: { origin: APP } } as Window;
  it('admits only this document’s draft preview and story fragment, keeping only the allowed headers', () => {
    expect(relayedRequest(win, 'doc', { path: '/a/doc/story?surface=app', method: 'GET', headers: { 'Content-Type': 'text/plain', Cookie: 'x', 'x-draft-sequence': '4' }, body: null }))
      .toEqual({ path: '/a/doc/story?surface=app', init: { method: 'GET', headers: { 'Content-Type': 'text/plain', 'x-draft-sequence': '4' } } });
    expect(relayedRequest(win, 'doc', { path: '/a/doc/draft-preview', method: 'POST', headers: {}, body: '{"a":1}' })?.init.body).toBe('{"a":1}');
  });

  it('refuses other documents, other paths, other origins, other methods and a POST to the fragment', () => {
    for (const request of [
      { path: '/a/other/story', method: 'GET' }, { path: '/api/artifacts/doc', method: 'GET' }, { path: 'https://evil.example/a/doc/story', method: 'GET' },
      { path: '/a/doc/story', method: 'PUT' }, { path: '/a/doc/story', method: 'POST' }, { path: 42, method: 'GET' }, { path: 'http://[bad', method: 'GET' },
    ]) expect(relayedRequest(win, 'doc', { headers: {}, body: null, ...request })).toBeNull();
  });

  it('admits the page GraphQL door only with a revision, pins it, and refuses mutations to a read-only reader', () => {
    const graphql = { path: '/api/artifacts/doc/graphql', method: 'POST', headers: {}, body: JSON.stringify({ query: '{a}', operation: 'query', revision: 'forged' }) };
    expect(relayedRequest(win, 'doc', graphql)).toBeNull();
    expect(JSON.parse(String(relayedRequest(win, 'doc', graphql, { revision: '7', readOnly: true })!.init.body))).toEqual({ query: '{a}', operation: 'query', revision: '7' });
    const mutation = { ...graphql, body: JSON.stringify({ query: 'mutation{a}', operation: 'mutation' }) };
    expect(relayedRequest(win, 'doc', mutation, { revision: '7', readOnly: true })).toBeNull();
    expect(relayedRequest(win, 'doc', mutation, { revision: '7', readOnly: false })).not.toBeNull();
    for (const body of ['not json', '[]', '{"operation":"query"}', JSON.stringify({ query: '{a}', operation: 'subscription' }), 'x'.repeat(1_000_001)])
      expect(relayedRequest(win, 'doc', { ...graphql, body }, { revision: '7', readOnly: false })).toBeNull();
    expect(relayedRequest(win, 'doc', { ...graphql, path: '/api/artifacts/doc/graphql?x=1' }, { revision: '7', readOnly: false })).toBeNull();
  });
});

describe('createFrameBridgeParent', () => {
  it('attaches at once to the frame origin and holds commands until the frame controller is ready', () => {
    const t = setup();
    expect(t.posted[0]).toMatchObject({ target: FRAME, data: { type: STORY_FRAME_BRIDGE_MESSAGE, payload: { kind: 'attach', id: 'doc', editId: 'edit_1', source: '<p/>' } } });
    t.bridge.send({ type: 'first' });
    t.bridge.invalidate(['ds']);
    expect(t.kinds()).toEqual(['attach']);
    t.say({ kind: 'ready', nonce: 'n1', urlValues: '?$a=1' });
    expect(t.kinds()).toEqual(['attach', 'send', 'send']);
    expect(t.events.ready).toEqual(['n1']);
    expect(t.events.values).toEqual(['?$a=1']);
    expect(t.bridge.nonce).toBe('n1');
  });

  it('ignores messages from another window, another origin or under another key', () => {
    const t = setup();
    t.from({ type: STORY_FRAME_BRIDGE_MESSAGE, key: t.key(), payload: { kind: 'ready', nonce: 'x' } }, { origin: 'https://evil.example' });
    t.from({ type: STORY_FRAME_BRIDGE_MESSAGE, key: t.key(), payload: { kind: 'ready', nonce: 'x' } }, { source: {} });
    t.say({ kind: 'ready', nonce: 'x' }, 'wrong-key');
    t.say({ kind: 'ready', nonce: '' });
    expect(t.events.ready).toEqual([]);
  });

  it('forwards controller events to subscribers, scroll and press to the page, until unsubscribed', () => {
    const t = setup();
    t.say({ kind: 'ready', nonce: 'n' });
    const seen: unknown[] = [];
    const stop = t.bridge.subscribe(event => seen.push(event));
    t.say({ kind: 'event', event: { type: 'selection' } });
    stop();
    t.say({ kind: 'event', event: { type: 'later' } });
    t.say({ kind: 'scroll', scrollX: 'bad', scrollY: 40 });
    t.say({ kind: 'pressed' });
    expect(seen).toEqual([{ type: 'selection' }]);
    expect(t.events.scroll).toEqual([{ x: 0, y: 40 }]);
    expect(t.events.pressed).toBe(1);
  });

  it('relays an admitted fetch with only the kept response headers, and refuses others', async () => {
    const t = setup();
    t.say({ kind: 'ready', nonce: 'n' });
    t.say({ kind: 'fetch', call: 1, path: '/a/doc/story', method: 'GET', headers: {}, body: null });
    t.say({ kind: 'fetch', call: 2, path: '/a/other/story', method: 'GET', headers: {}, body: null });
    await flush(); await flush();
    const results = t.posted.filter(p => p.data.payload.kind === 'fetch-result').map(p => p.data.payload);
    expect(results).toContainEqual({ kind: 'fetch-result', call: 2, error: 'refused' });
    expect(results).toContainEqual({ kind: 'fetch-result', call: 1, status: 200, headers: { 'content-type': 'application/json', 'retry-after': '3' }, body: '{"ok":true}' });
    expect(t.appFetch).toHaveBeenCalledTimes(1);
  });

  it('resolves restored() on the frame’s answer and rejects pending ones when disposed', async () => {
    const t = setup();
    t.say({ kind: 'ready', nonce: 'n' });
    const done = t.bridge.restored();
    const call = t.posted.at(-1)!.data.payload.call;
    t.say({ kind: 'restored', call, ok: true });
    await expect(done).resolves.toBeUndefined();
    const failed = t.bridge.restored();
    t.say({ kind: 'restored', call: t.posted.at(-1)!.data.payload.call, ok: false, error: 'state refused' });
    await expect(failed).rejects.toThrow('state refused');
    const pending = t.bridge.restored();
    t.bridge.dispose();
    await expect(pending).rejects.toThrow('the framed document closed (disposed)');
    await expect(t.bridge.restored()).rejects.toThrow('closed');
    expect(t.events.closed).toEqual(['disposed']);
    expect(t.kinds().at(-1)).toBe('detach');
  });

  it('re-attaches under a fresh key when a new document says hello, dropping the old backlog', () => {
    const t = setup();
    t.say({ kind: 'ready', nonce: 'n1' });
    const first = t.key();
    t.say({ kind: 'hello' });
    expect(t.key()).not.toBe(first);
    expect(t.kinds().at(-1)).toBe('attach');
    expect(t.events.ready).toEqual(['n1', '']);
    t.bridge.send('queued');
    expect(t.kinds().at(-1)).toBe('attach');
  });

  it('posts a sandboxed copy to *, and closes for good when that copy navigates', () => {
    const t = setup('null');
    expect(t.posted[0]!.target).toBe('*');
    t.frame.dispatchEvent(new Event('load'));
    expect(t.events.closed).toEqual([]);
    t.frame.dispatchEvent(new Event('load'));
    expect(t.events.closed).toEqual(['the framed document navigated']);
    const before = t.posted.length;
    t.bridge.send('after close');
    expect(t.posted).toHaveLength(before);
  });

  it('rounds and resends the top inset, sets nodes once, and measures the frame content box', () => {
    const t = setup();
    t.bridge.setTopInset(12.6);
    expect(t.kinds()).toEqual(['attach']);
    t.say({ kind: 'ready', nonce: 'n' });
    expect(t.posted.at(-1)!.data.payload).toEqual({ kind: 'inset', top: 13 });
    t.bridge.setTopInset(13);
    t.bridge.setTopInset(-5);
    expect(t.posted.at(-1)!.data.payload).toEqual({ kind: 'inset', top: 0 });
    t.bridge.setNodes([]);
    t.bridge.setNodes([{ type: 'text', value: 'a' } as never]);
    t.bridge.setNodes([{ type: 'text', value: 'b' } as never]);
    expect(t.kinds().filter(kind => kind === 'nodes')).toHaveLength(1);
    const rect = t.bridge.getViewportRect();
    expect([rect.x, rect.y, rect.width, rect.height]).toEqual([12, 23, 300, 200]);
  });
});
