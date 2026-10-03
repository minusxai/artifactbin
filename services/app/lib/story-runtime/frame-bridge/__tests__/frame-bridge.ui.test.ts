/**
 * THE FRAME BRIDGE (lib/story-runtime/frame-bridge): the page's stand-in controller (./parent), the frame's door
 * (./door, opened before the author's script) and the frame half (./frame) over a real pair of jsdom windows — the
 * page and an iframe. jsdom's own postMessage carries neither `source` nor `origin`, so each window's postMessage
 * is replaced by one that delivers a TRUSTED MessageEvent with the source and origin a browser would give it; the
 * frame's controller is a recording stand-in (the real one is proved by scripts/gates/gate-frame-editor.mjs).
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

interface FakeController {
  input: Record<string, unknown> & { appFetch: (path: string, init: RequestInit) => Promise<Response>; editId: () => string; initialSource: () => string | null; fragmentSurface?: string };
  nonce: string; sent: unknown[]; updates: unknown[]; listeners: Set<(event: unknown) => void>; disposed: boolean;
  restoredResult: () => Promise<void>;
  emit(event: unknown): void;
}
const made = vi.hoisted(() => ({ controllers: [] as FakeController[] }));
vi.mock('@/lib/story-runtime/island-controller', () => ({
  createIslandController: (input: FakeController['input']) => {
    const controller = {
      input, nonce: 'n'.repeat(32), sent: [] as unknown[], updates: [] as unknown[], listeners: new Set<(event: unknown) => void>(), disposed: false,
      restoredResult: () => Promise.resolve(),
      selectionReady() {},
      send(command: unknown) { controller.sent.push(command); },
      update(command: unknown) { controller.updates.push(command); },
      restored() { return controller.restoredResult(); },
      subscribe(listener: (event: unknown) => void) { controller.listeners.add(listener); return () => { controller.listeners.delete(listener); }; },
      invalidate() {}, getViewportRect: () => new DOMRect(),
      dispose() { controller.disposed = true; },
      emit(event: unknown) { for (const listener of controller.listeners) listener(event); },
    };
    made.controllers.push(controller as unknown as FakeController);
    return controller;
  },
}));

import { openFrameDoor, FRAME_BRIDGE_MESSAGE, frameAppOrigin, APP_ORIGIN_ATTR } from '../door';
import { startFrameBridge } from '../frame';
import { createFrameBridgeParent, relayedRequest, urlValuesOf } from '../parent';
import { STORY_ADOPT_HOOK, STORY_EDIT_MODE_MESSAGE, STORY_COMMENT_KEY_MESSAGE, STORY_EDIT_FLUSH_MESSAGE, STORY_HISTORY_MESSAGE, STORY_SELECT_MESSAGE, STORY_URL_VALUES_MESSAGE } from '@/lib/story-runtime/contract';

const APP = 'https://app.test';
const PAGES = 'https://6869.pages.test';
const KEY_RE = /^[0-9a-f-]{36}$/;
const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0));
const settle = async (until: () => boolean) => { for (const end = Date.now() + 3000; Date.now() < end && !until();) await tick(); };

/**
 * Dispatch `event` as the browser would a real postMessage or key: TRUSTED. jsdom's `dispatchEvent` clears the
 * flag (as the DOM says a script's dispatch must), so this goes through the target's own dispatch underneath it.
 */
const implOf = (object: object): { isTrusted: boolean; _dispatch(event: unknown): void } | undefined => {
  const symbol = Object.getOwnPropertySymbols(object).find((s) => String(s) === 'Symbol(impl)');
  return symbol ? (object as Record<symbol, never>)[symbol] : undefined;
};
function dispatchTrusted<E extends Event>(target: EventTarget, event: E): E {
  const eventImpl = implOf(event)!;
  const targetImpl = implOf(target);
  // The page's half reads no trust flag (it checks source, origin and key); a target without an impl is dispatched plainly.
  if (!targetImpl) { target.dispatchEvent(event); return event; }
  eventImpl.isTrusted = true;
  targetImpl._dispatch(eventImpl);
  return event;
}

const cleanups: Array<() => void> = [];
afterEach(() => { for (const cleanup of cleanups.splice(0).reverse()) cleanup(); made.controllers.length = 0; document.body.innerHTML = ''; });

/** The page (this window) framing a document (an iframe), with browser-shaped postMessage both ways. */
function framedPair() {
  const frame = document.createElement('iframe');
  document.body.append(frame);
  const frameWin = frame.contentWindow! as Window & typeof globalThis;
  frameWin.document.body.innerHTML = '<div data-mx-inline-story><p id="lede">The lede.</p></div>';
  const toPage: unknown[] = [];
  const toFrame: Array<{ data: unknown; target: string }> = [];
  // jsdom's frame sees its parent through a proxy that is not this test's `window` object: that proxy is who the
  // door hears from and posts to; the page's listeners are on `window`.
  const pageProxy = frameWin.parent as Window;
  const pagePost = pageProxy.postMessage;
  // What the frame posts to its parent arrives at the page from the frame's window and origin.
  pageProxy.postMessage = ((data: unknown, target: string) => {
    toPage.push(data);
    if (target !== '*' && target !== APP) return;
    const copy = structuredClone(data);
    setTimeout(() => dispatchTrusted(window, (new MessageEvent('message', { data: copy, origin: PAGES, source: frameWin }))), 0);
  }) as typeof window.postMessage;
  frameWin.postMessage = ((data: unknown, target: string) => {
    toFrame.push({ data, target });
    if (target !== '*' && target !== PAGES) return;
    const copy = structuredClone(data);
    setTimeout(() => dispatchTrusted(frameWin, (new frameWin.MessageEvent('message', { data: copy, origin: APP, source: pageProxy }))), 0);
  }) as typeof window.postMessage;
  cleanups.push(() => { pageProxy.postMessage = pagePost; });
  return { frame, frameWin, toPage, toFrame, pageProxy };
}

/** The door opened as lib/islands/page opens it, loading the real frame half. */
function openDoor(frameWin: Window) {
  const loads = vi.fn(async () => ({ startFrameBridge }));
  cleanups.push(openFrameDoor(frameWin, APP, loads));
  return loads;
}

function parentFor(frame: HTMLIFrameElement, over: Partial<Parameters<typeof createFrameBridgeParent>[0]> = {}) {
  const appFetch = vi.fn(async (path: string, init: RequestInit) => new Response(`${init.method} ${path} ${init.body ?? ''}`, { status: 200, headers: { 'Content-Type': 'text/plain', 'Retry-After': '2', 'Set-Cookie': 'x=1' } }));
  const onReady = vi.fn();
  const bridge = createFrameBridgeParent({
    win: window, frame, frameOrigin: PAGES, id: 'doc1', nodes: [], editId: () => 'e1', source: () => '<p>The lede.</p>',
    appFetch, onReady, ...over,
  });
  cleanups.push(() => bridge.dispose());
  return { bridge, appFetch, onReady };
}

describe('the frame bridge', () => {
  it('attaches on the door\'s hello, starts the frame\'s controller with the page\'s inputs, and relays commands and events both ways', async () => {
    const { frame, frameWin } = framedPair();
    const { bridge, onReady } = parentFor(frame);
    const events: unknown[] = [];
    bridge.subscribe((event) => events.push(event));
    // Sent before the frame is even open: kept, then delivered in order.
    bridge.send({ type: STORY_SELECT_MESSAGE, path: null });
    const loads = openDoor(frameWin);
    await settle(() => onReady.mock.calls.length > 0);
    expect(loads).toHaveBeenCalledTimes(1);
    expect(onReady).toHaveBeenCalledWith('n'.repeat(32));
    expect(bridge.nonce).toBe('n'.repeat(32));
    const controller = made.controllers[0]!;
    expect(controller.input.id).toBe('doc1');
    expect(controller.input.editId()).toBe('e1');
    expect(controller.input.initialSource()).toBe('<p>The lede.</p>');
    expect(controller.input.fragmentSurface).toBe('raw');
    await settle(() => controller.sent.length > 0);
    expect(controller.sent[0]).toEqual({ type: STORY_SELECT_MESSAGE, path: null });

    bridge.setContext('e2', '<p>newer</p>');
    bridge.update({ type: 'mx:document', nodes: [], source: '<p>newer</p>', editId: 'e2', theme: null, colorMode: 'light' });
    await settle(() => controller.updates.length > 0);
    expect(controller.input.editId()).toBe('e2');
    expect(controller.input.initialSource()).toBe('<p>newer</p>');

    controller.emit({ type: 'mx:edit-ready', nonce: controller.nonce });
    // A script mount's "Edit script" badge (lib/story-runtime/edit/session) crosses like every controller event.
    controller.emit({ type: 'mx:open-script', nonce: controller.nonce, component: 'Sparkline' });
    await settle(() => events.length > 1);
    expect(events).toEqual([{ type: 'mx:edit-ready', nonce: controller.nonce }, { type: 'mx:open-script', nonce: controller.nonce, component: 'Sparkline' }]);

    let done = false;
    void bridge.restored().then(() => { done = true; });
    await settle(() => done);
    expect(done).toBe(true);
    controller.restoredResult = () => Promise.reject(new Error('the island build changed under the page'));
    await expect(bridge.restored()).rejects.toThrow('the island build changed under the page');
  });

  it('keeps every envelope from the author\'s listeners, and the page drops replies without its key', async () => {
    const { frame, frameWin, toFrame, pageProxy } = framedPair();
    const { bridge, onReady } = parentFor(frame);
    openDoor(frameWin);
    // The author's script runs after the door: whatever it listens with, it never sees the bridge.
    const seen: unknown[] = [];
    frameWin.addEventListener('message', (event) => seen.push(event.data), true);
    frameWin.addEventListener('message', (event) => seen.push(event.data));
    await settle(() => onReady.mock.calls.length > 0);
    bridge.send({ type: STORY_EDIT_MODE_MESSAGE, on: true });
    frameWin.postMessage({ type: 'mx:query-result', id: 1 }, '*');
    await settle(() => seen.length > 0);
    await tick();
    // Both of the author's listeners hear an ordinary message; neither ever hears an envelope.
    expect(seen).toEqual([{ type: 'mx:query-result', id: 1 }, { type: 'mx:query-result', id: 1 }]);
    const key = (toFrame.find((post) => (post.data as { payload?: { kind?: string } }).payload?.kind === 'attach')!.data as { key: string }).key;
    expect(key).toMatch(KEY_RE);
    expect(toFrame.filter((post) => (post.data as { type?: string }).type === FRAME_BRIDGE_MESSAGE).every((post) => post.target === PAGES)).toBe(true);

    // A forgery from inside the frame: the author's own envelope, keyless or guessed.
    const events: unknown[] = [];
    bridge.subscribe((event) => events.push(event));
    const forged = { type: 'mx:flow-edit', nonce: 'n'.repeat(32), path: '0', expected: 'a', replacement: 'FORGED' };
    pageProxy.postMessage({ type: FRAME_BRIDGE_MESSAGE, payload: { kind: 'event', event: forged } }, APP);
    pageProxy.postMessage({ type: FRAME_BRIDGE_MESSAGE, key: 'f'.repeat(36), payload: { kind: 'event', event: forged } }, APP);
    pageProxy.postMessage({ type: FRAME_BRIDGE_MESSAGE, key: 'f'.repeat(36), payload: { kind: 'ready', nonce: 'mine' } }, APP);
    await tick(); await tick();
    expect(events).toEqual([]);
    expect(bridge.nonce).toBe('n'.repeat(32));
  });

  it('the door refuses an envelope that is untrusted, from another window or from another origin', async () => {
    const { frameWin, pageProxy } = framedPair();
    const loads = openDoor(frameWin);
    const attach = { type: FRAME_BRIDGE_MESSAGE, key: 'k'.repeat(36), payload: { kind: 'attach', id: 'doc1', nodes: [], editId: 'e1', source: null } };
    frameWin.dispatchEvent(new frameWin.MessageEvent('message', { data: attach, origin: APP, source: pageProxy }));
    dispatchTrusted(frameWin, (new frameWin.MessageEvent('message', { data: attach, origin: APP, source: frameWin })));
    dispatchTrusted(frameWin, (new frameWin.MessageEvent('message', { data: attach, origin: PAGES, source: pageProxy })));
    dispatchTrusted(frameWin, (new frameWin.MessageEvent('message', { data: { ...attach, key: 'short' }, origin: APP, source: pageProxy })));
    await tick();
    expect(loads).not.toHaveBeenCalled();
    dispatchTrusted(frameWin, (new frameWin.MessageEvent('message', { data: attach, origin: APP, source: pageProxy })));
    await settle(() => made.controllers.length > 0);
    expect(loads).toHaveBeenCalledTimes(1);
  });

  it('relays the controller\'s three app requests through the page, and refuses anything else', async () => {
    const { frame, frameWin } = framedPair();
    const { appFetch, onReady } = parentFor(frame);
    openDoor(frameWin);
    await settle(() => onReady.mock.calls.length > 0);
    const { appFetch: relayed } = made.controllers[0]!.input;
    const post = await relayed('/a/doc1/draft-preview', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Draft-Sequence': 's.1', Cookie: 'no' }, body: '{"source":"x"}' });
    expect(await post.text()).toBe('POST /a/doc1/draft-preview {"source":"x"}');
    expect(post.headers.get('retry-after')).toBe('2');
    expect(post.headers.get('set-cookie')).toBeNull();
    const sent = appFetch.mock.calls[0]![1];
    expect(sent.headers).toEqual({ 'content-type': 'application/json', 'x-draft-sequence': 's.1' });
    expect((await (await relayed('/a/doc1/story?surface=raw', {})).text())).toBe('GET /a/doc1/story?surface=raw ');
    await expect(relayed('/a/other/draft-preview', {})).rejects.toThrow('refused');
    await expect(relayed('/api/my/artifacts/doc1/edits', { method: 'POST', body: '{}' })).rejects.toThrow('refused');
    await expect(relayed('/a/doc1/story', { method: 'POST', body: '{}' })).rejects.toThrow('refused');
    expect(appFetch).toHaveBeenCalledTimes(2);
  });

  it('forwards undo, Enter, focus leaving and the comment shortcut while editing — and nothing while reading', async () => {
    const { frame, frameWin } = framedPair();
    const { bridge, onReady } = parentFor(frame);
    const events: Array<{ type: string; nonce?: string; direction?: string; reason?: string }> = [];
    bridge.subscribe((event) => events.push(event as never));
    openDoor(frameWin);
    await settle(() => onReady.mock.calls.length > 0);
    const key = (init: KeyboardEventInit) => {
      return dispatchTrusted(frameWin.document.querySelector('p')!, new frameWin.KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init }));
    };
    key({ key: 'z', metaKey: true });
    await tick(); await tick();
    expect(events, 'reading: the key is the document\'s own').toEqual([]);
    bridge.send({ type: STORY_EDIT_MODE_MESSAGE, on: true });
    await settle(() => made.controllers[0]!.sent.length > 0);
    const undo = key({ key: 'z', metaKey: true });
    expect(undo.defaultPrevented).toBe(true);
    key({ key: 'Z', ctrlKey: true, shiftKey: true });
    key({ key: 'm', metaKey: true, altKey: true });
    key({ key: 'Enter' });
    // A synthetic key (the author's script) forwards nothing.
    frameWin.document.querySelector('p')!.dispatchEvent(new frameWin.KeyboardEvent('keydown', { key: 'z', metaKey: true, bubbles: true }));
    dispatchTrusted(frameWin.document.querySelector('p')!, (new frameWin.FocusEvent('focusout', { bubbles: true })));
    await settle(() => events.length >= 5);
    await tick(); await tick();
    expect(events.map(({ type, direction, reason }) => [type, direction ?? reason ?? null])).toEqual([
      [STORY_HISTORY_MESSAGE, 'undo'], [STORY_HISTORY_MESSAGE, 'redo'], [STORY_COMMENT_KEY_MESSAGE, null],
      [STORY_EDIT_FLUSH_MESSAGE, 'focusout'], [STORY_EDIT_FLUSH_MESSAGE, 'enter'],
    ]);
    expect(events.every((event) => event.nonce === 'n'.repeat(32))).toBe(true);
  });

  it('holds the document\'s own live stream from edit mode on until the saved version is drawn', async () => {
    const { frame, frameWin } = framedPair();
    const { bridge, onReady } = parentFor(frame);
    openDoor(frameWin);
    await settle(() => onReady.mock.calls.length > 0);
    const hooks = frameWin as unknown as Record<string, unknown>;
    expect(hooks[STORY_ADOPT_HOOK]).toBeUndefined();
    bridge.send({ type: STORY_EDIT_MODE_MESSAGE, on: true });
    await settle(() => typeof hooks[STORY_ADOPT_HOOK] === 'function');
    expect(typeof hooks[STORY_ADOPT_HOOK]).toBe('function');
    bridge.send({ type: STORY_EDIT_MODE_MESSAGE, on: false });
    await tick(); await tick();
    expect(typeof hooks[STORY_ADOPT_HOOK]).toBe('function');
    await bridge.restored();
    expect(hooks[STORY_ADOPT_HOOK]).toBeUndefined();
  });

  it('hands the page the document\'s `$` params from its own frame only, bounded and without a hash', async () => {
    const { frame, pageProxy } = framedPair();
    const onUrlValues = vi.fn();
    parentFor(frame, { onUrlValues });
    // From the frame's window and origin (what lib/islands/boot posts to the app origin).
    pageProxy.postMessage({ type: STORY_URL_VALUES_MESSAGE, search: '?$region=east' }, APP);
    pageProxy.postMessage({ type: STORY_URL_VALUES_MESSAGE, search: '' }, APP);
    // Malformed: a hash, whitespace, an oversized query, not a string.
    pageProxy.postMessage({ type: STORY_URL_VALUES_MESSAGE, search: '?$region=east#evil' }, APP);
    pageProxy.postMessage({ type: STORY_URL_VALUES_MESSAGE, search: '?$region=a b' }, APP);
    pageProxy.postMessage({ type: STORY_URL_VALUES_MESSAGE, search: `?$region=${'x'.repeat(9000)}` }, APP);
    pageProxy.postMessage({ type: STORY_URL_VALUES_MESSAGE, search: 1 }, APP);
    await tick(); await tick();
    // Another window, or the right window from another origin.
    window.dispatchEvent(new MessageEvent('message', { data: { type: STORY_URL_VALUES_MESSAGE, search: '?$region=other' }, origin: PAGES, source: window }));
    window.dispatchEvent(new MessageEvent('message', { data: { type: STORY_URL_VALUES_MESSAGE, search: '?$region=other' }, origin: 'https://evil.test', source: frame.contentWindow }));
    expect(onUrlValues.mock.calls).toEqual([['?$region=east'], ['']]);
    expect(urlValuesOf({ type: STORY_URL_VALUES_MESSAGE, search: '$region=east' })).toBe('$region=east');
    expect(urlValuesOf({ type: 'mx:frame-bridge', search: '?$region=east' })).toBeNull();
  });

  it('the page\'s reader mode and data wakeups reach the framed document', async () => {
    const { frame, frameWin } = framedPair();
    const { bridge, onReady } = parentFor(frame);
    openDoor(frameWin);
    await settle(() => onReady.mock.calls.length > 0);
    bridge.send({ type: 'mx:reader-mode', mode: 'dark' });
    bridge.invalidate(['orders']);
    const controller = made.controllers[0]!;
    await settle(() => controller.sent.length >= 2);
    expect(frameWin.document.documentElement.classList.contains('dark')).toBe(true);
    expect(controller.sent).toEqual([{ type: 'mx:reader-mode', mode: 'dark' }, { type: 'mx:data', datasets: ['orders'] }]);
  });

  it('places the frame\'s viewport inside the iframe\'s box, and a sandboxed copy closes when the frame navigates', async () => {
    const { frame, frameWin } = framedPair();
    const onClosed = vi.fn();
    const { bridge, onReady } = parentFor(frame, { onClosed, frameOrigin: 'null' });
    frame.getBoundingClientRect = () => new DOMRect(30, 64, 800, 600);
    Object.defineProperties(frame, { clientLeft: { value: 1 }, clientTop: { value: 2 }, clientWidth: { value: 798 }, clientHeight: { value: 596 } });
    const rect = bridge.getViewportRect();
    expect([rect.left, rect.top, rect.width, rect.height]).toEqual([31, 66, 798, 596]);
    openDoor(frameWin);
    await settle(() => onReady.mock.calls.length > 0);
    frame.dispatchEvent(new Event('load'));
    frame.dispatchEvent(new Event('load'));
    expect(onClosed).toHaveBeenCalledWith('the framed document navigated');
    await expect(bridge.restored()).rejects.toThrow('closed');
  });

  it('attaches to a frame whose door opened before the page ran, and re-attaches when the document loads again', async () => {
    const { frame, frameWin, toFrame } = framedPair();
    // The server drew the frame: its door is open and its hello went to a page that was not listening yet.
    openDoor(frameWin);
    await tick();
    const { bridge, onReady } = parentFor(frame);
    const events: unknown[] = [];
    bridge.subscribe((event) => events.push(event));
    bridge.send({ type: STORY_SELECT_MESSAGE, path: null });
    await settle(() => onReady.mock.calls.length > 0);
    expect(onReady).toHaveBeenLastCalledWith('n'.repeat(32));
    const first = made.controllers[0]!;
    await settle(() => first.sent.length > 0);
    expect(first.sent).toEqual([{ type: STORY_SELECT_MESSAGE, path: null }]);
    const keyOf = (index: number) => (toFrame.filter((post) => (post.data as { payload?: { kind?: string } }).payload?.kind === 'attach')[index]?.data as { key?: string } | undefined)?.key;
    const firstKey = keyOf(0);

    // The document loads again (a consent grant, a live reload): its new door says hello, and gets a new session.
    const waiting = bridge.restored();
    frameWin.parent.postMessage({ type: FRAME_BRIDGE_MESSAGE, payload: { kind: 'hello' } }, APP);
    await expect(waiting).rejects.toThrow('loaded again');
    expect(onReady).toHaveBeenLastCalledWith('');
    await settle(() => made.controllers.length > 1);
    await settle(() => onReady.mock.lastCall?.[0] === 'n'.repeat(32));
    expect(made.controllers.length).toBe(2);
    expect(first.disposed).toBe(true);
    const keys = new Set(toFrame.flatMap((post) => ((post.data as { payload?: { kind?: string }; key?: string }).payload?.kind === 'attach' ? [(post.data as { key: string }).key] : [])));
    expect(keys.size).toBe(2);
    expect(keys.has(firstKey!)).toBe(true);
    bridge.send({ type: STORY_SELECT_MESSAGE, path: '0' });
    const second = made.controllers[1]!;
    await settle(() => second.sent.length > 0);
    expect(second.sent).toEqual([{ type: STORY_SELECT_MESSAGE, path: '0' }]);
    // A load event alone (the same document) changes nothing.
    frame.dispatchEvent(new Event('load'));
    await tick();
    expect(made.controllers.length).toBe(2);
    expect(events).toEqual([]);
  });

  it('reads the app origin the server wrote on the document, else its own URL origin', () => {
    const doc = document.implementation.createHTMLDocument('x');
    expect(frameAppOrigin(doc, window)).toBe(window.location.origin);
    doc.documentElement.setAttribute(APP_ORIGIN_ATTR, APP);
    expect(frameAppOrigin(doc, window)).toBe(APP);
  });

  it('checks a relayed request by path, method and origin', () => {
    const at = (path: unknown, method: unknown = 'GET') => relayedRequest(window, 'doc1', { path, method, headers: {}, body: null });
    expect(at('/a/doc1/draft-preview')?.path).toBe('/a/doc1/draft-preview');
    expect(at('/a/doc1/story?surface=raw&$x=1')?.path).toBe('/a/doc1/story?surface=raw&$x=1');
    for (const [path, method] of [['https://evil.test/a/doc1/story', 'GET'], ['/a/doc2/story', 'GET'], ['/a/doc1/draft-preview', 'PUT'], ['/a/doc1/../doc2/story', 'GET'], [42, 'GET']]) {
      expect(at(path, method), `${String(path)} ${String(method)}`).toBeNull();
    }
  });
});
