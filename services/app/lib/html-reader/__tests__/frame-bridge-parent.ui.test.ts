import { describe, expect, it, vi } from 'vitest';
import { STORY_FRAME_BRIDGE_MESSAGE, STORY_URL_VALUES_MESSAGE } from '../../html-reader/contract';
import { createFrameBridgeParent, regionFrameMessage, relayedRequest, urlValuesOf } from '../../html-reader/frame-bridge/parent';

const APP = 'https://app.example', FRAME = 'https://doc.pages.example';
function setup(frameOrigin = FRAME, extra: Partial<Parameters<typeof createFrameBridgeParent>[0]> = {}) {
  const posted: Array<{ data: { key: string; payload: { kind: string } & Record<string, unknown> }; target: string }> = [];
  const contentWindow = { postMessage: (data: never, target: string) => posted.push({ data, target }) };
  const win = Object.assign(new EventTarget(), { location: { origin: APP } }) as unknown as Window;
  const frame = Object.assign(new EventTarget(), { contentWindow, clientLeft: 2, clientTop: 3, clientWidth: 300, clientHeight: 200, getBoundingClientRect: () => ({ left: 10, top: 20 }) }) as unknown as HTMLIFrameElement;
  const events = { ready: [] as string[], closed: [] as string[], values: [] as string[], scroll: [] as unknown[], pressed: 0 };
  const appFetch = vi.fn(async () => new Response('{"ok":true}', { status: 200, headers: { 'content-type': 'application/json', 'x-secret': 'no', 'retry-after': '3' } }));
  const bridge = createFrameBridgeParent({
    win, frame, frameOrigin, id: 'doc', editId: () => 'edit_1', source: () => '<p/>', appFetch,
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
  it('refuses retired preview and story doors', () => {
    for (const path of ['/a/doc/story?surface=app', '/a/doc/draft-preview'])
      expect(relayedRequest(win, 'doc', { path, method: 'POST', headers: {}, body: '{}' }, { revision: '7', readOnly: false })).toBeNull();
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
    const t = setup(FRAME, { htmlContext: () => ({ revision: '7', readOnly: true }) });
    t.say({ kind: 'ready', nonce: 'n' });
    t.say({ kind: 'fetch', call: 1, path: '/api/artifacts/doc/graphql', method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: 'secret', 'x-draft-sequence': '4' }, body: JSON.stringify({ query: '{a}', operation: 'query' }) });
    t.say({ kind: 'fetch', call: 2, path: '/a/other/story', method: 'GET', headers: {}, body: null });
    await flush(); await flush();
    const results = t.posted.filter(p => p.data.payload.kind === 'fetch-result').map(p => p.data.payload);
    expect(results).toContainEqual({ kind: 'fetch-result', call: 2, error: 'refused' });
    expect(results).toContainEqual({ kind: 'fetch-result', call: 1, status: 200, headers: { 'content-type': 'application/json', 'retry-after': '3' }, body: '{"ok":true}' });
    expect(t.appFetch).toHaveBeenCalledTimes(1);
    expect(t.appFetch).toHaveBeenCalledWith('/api/artifacts/doc/graphql', expect.objectContaining({ headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ query: '{a}', operation: 'query', revision: '7' }) }));
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
    const rect = t.bridge.getViewportRect();
    expect([rect.x, rect.y, rect.width, rect.height]).toEqual([12, 23, 300, 200]);
  });

  it('carries region messages: nothing but regions-enabled reaches a frame before regions are enabled, and a new document starts over', () => {
    const t = setup();
    t.say({ kind: 'ready', nonce: 'n' });
    const before = t.posted.length;
    t.bridge.sendRegion({ kind: 'region-paint', carets: [{ id: 'u', label: 'Ada', regionId: 'r1', anchor: 'AA==', head: 'AA==' }] });
    t.bridge.sendRegion({ kind: 'region-ack', regionId: 'r1', seq: 1 });
    expect(t.posted).toHaveLength(before);
    expect(t.bridge.regionsEnabled()).toBe(false);
    t.bridge.sendRegion({ kind: 'regions-enabled', regionIds: ['r1'] });
    expect(t.bridge.regionsEnabled()).toBe(true);
    t.bridge.sendRegion({ kind: 'region-session', regionId: 'r1', regionKind: 'rich', clientId: 7, state: new Uint8Array([1, 2]), seq: 3 });
    expect(t.posted.slice(before).map(p => p.data.payload)).toEqual([
      { kind: 'regions-enabled', regionIds: ['r1'] },
      { kind: 'region-session', regionId: 'r1', regionKind: 'rich', clientId: 7, state: new Uint8Array([1, 2]), seq: 3 },
    ]);
    t.say({ kind: 'hello' });
    expect(t.bridge.regionsEnabled()).toBe(false);
  });

  it('hands validated region messages from the frame to region subscribers only', () => {
    const t = setup();
    t.say({ kind: 'ready', nonce: 'n' });
    const seen: unknown[] = [], events: unknown[] = [];
    const stop = t.bridge.subscribeRegion(message => seen.push(message));
    t.bridge.subscribe(event => events.push(event));
    t.say({ kind: 'region-open', regionId: 'r1' });
    t.say({ kind: 'region-update', regionId: 'r1', update: new Uint8Array([9]) });
    t.say({ kind: 'region-update', regionId: 'r1', update: 'not bytes' });
    t.say({ kind: 'region-caret', regionId: 'r1', anchor: 'AA==', head: 'AQ==', marks: ['bold'], block: 'paragraph', extra: 'dropped' });
    t.say({ kind: 'region-blur' });
    t.say({ kind: 'region-link', regionId: 'r1', href: 'https://a.example/' });
    t.say({ kind: 'region-link', regionId: 'r1', href: null, extra: 'dropped' });
    t.say({ kind: 'region-link', regionId: 'r1', href: 7 });
    t.say({ kind: 'region-link', regionId: 'r1', href: `https://a.example/${'x'.repeat(2048)}` });
    t.say({ kind: 'region-link', regionId: 'not an id!', href: null });
    t.say({ kind: 'region-open', regionId: 'r1' }, 'forged-key');
    stop();
    t.say({ kind: 'region-blur' });
    expect(seen).toEqual([
      { kind: 'region-open', regionId: 'r1' },
      { kind: 'region-update', regionId: 'r1', update: new Uint8Array([9]) },
      { kind: 'region-caret', regionId: 'r1', anchor: 'AA==', head: 'AQ==', marks: ['bold'], block: 'paragraph' },
      { kind: 'region-blur' },
      { kind: 'region-link', regionId: 'r1', href: 'https://a.example/' },
      { kind: 'region-link', regionId: 'r1', href: null },
    ]);
    expect(events).toEqual([]);
  });
});

describe('the frame\'s region caret', () => {
  it('is the last region-caret the current document sent, none after region-blur or once a new document loads', () => {
    const t = setup();
    t.say({ kind: 'ready', nonce: 'n' });
    expect(t.bridge.regionCaret()).toBeNull();
    t.say({ kind: 'region-caret', regionId: 'r1', anchor: 'AA==', head: 'AQ==', marks: [], block: 'paragraph' });
    expect(t.bridge.regionCaret()).toEqual({ regionId: 'r1', anchor: 'AA==', head: 'AQ==' });
    t.say({ kind: 'region-caret', regionId: 'r1', anchor: 'AA==', head: 'AA==', marks: [], block: 'not valid!' });
    expect(t.bridge.regionCaret()).toEqual({ regionId: 'r1', anchor: 'AA==', head: 'AQ==' });
    t.say({ kind: 'region-blur' });
    expect(t.bridge.regionCaret()).toBeNull();
    t.say({ kind: 'region-caret', regionId: 'r1', anchor: 'AA==', head: 'AQ==', marks: [], block: 'paragraph' });
    t.say({ kind: 'hello' });
    expect(t.bridge.regionCaret()).toBeNull();
  });
});

describe('regionFrameMessage', () => {
  it('admits only well-formed region messages within the contract limits', () => {
    expect(regionFrameMessage({ kind: 'region-slash', regionId: 'r1', x: 3, y: 4 })).toEqual({ kind: 'region-slash', regionId: 'r1', x: 3, y: 4 });
    for (const bad of [
      null, { kind: 'region-open' }, { kind: 'region-open', regionId: '' }, { kind: 'region-open', regionId: 'r 1' }, { kind: 'region-open', regionId: 'x'.repeat(129) },
      { kind: 'region-update', regionId: 'r1', update: new Uint8Array(0) }, { kind: 'region-update', regionId: 'r1', update: new Uint8Array(262_145) },
      { kind: 'region-caret', regionId: 'r1', anchor: 'not base64!', head: 'AA==', marks: [], block: 'p' },
      { kind: 'region-caret', regionId: 'r1', anchor: 'A'.repeat(348), head: 'AA==', marks: [], block: 'p' },
      { kind: 'region-caret', regionId: 'r1', anchor: 'AA==', head: 'AA==', marks: 'bold', block: 'p' },
      { kind: 'region-slash', regionId: 'r1', x: Infinity, y: 0 }, { kind: 'fetch' },
    ]) expect(regionFrameMessage(bad)).toBeNull();
  });
});
