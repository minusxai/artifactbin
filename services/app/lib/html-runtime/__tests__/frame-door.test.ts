/**
 * The frame's door (lib/islands/frame-door) restates the bridge envelope's id so the reader chunk carries no
 * contract value: it must stay the contract's value exactly.
 */
import { describe, expect, it } from 'vitest';
import { isFrameBridgeEnvelope, STORY_FRAME_BRIDGE_MESSAGE } from '@/lib/html-reader/contract';
import { FRAME_BRIDGE_MESSAGE, openFrameDoor } from '../../html-runtime/frame-door';

describe('the frame door envelope', () => {
  it('names the envelope once: the door restates the contract value exactly', () => {
    expect(FRAME_BRIDGE_MESSAGE).toBe(STORY_FRAME_BRIDGE_MESSAGE);
    expect(isFrameBridgeEnvelope({ type: STORY_FRAME_BRIDGE_MESSAGE, key: 'k', payload: { kind: 'hello' } })).toBe(true);
    for (const junk of [null, 'mx:frame-bridge', { type: STORY_FRAME_BRIDGE_MESSAGE }, { type: STORY_FRAME_BRIDGE_MESSAGE, payload: { kind: 1 } }, { type: 'mx:other', payload: { kind: 'hello' } }]) {
      expect(isFrameBridgeEnvelope(junk)).toBe(false);
    }
  });
});

/**
 * The door is the frame's only listener for bridge envelopes, registered before the author's script exists. A fake
 * window stands in for the browser's dispatch (listeners on the window in registration order, a stopped event goes no
 * further) and for MessageEvent, whose getters the door captures; `isTrusted` is what a browser sets.
 */
describe('the door keeps region sessions out of the author\'s reach', () => {
  const APP = 'https://app.example';
  function frame() {
    const parentPosts: [unknown, string][] = [];
    const parent = { postMessage: (message: unknown, origin: string) => { parentPosts.push([message, origin]); } };
    class FakeEvent { stopped = false; stopImmediatePropagation() { this.stopped = true; } }
    class FakeMessageEvent extends FakeEvent {
      constructor(private readonly init: { data: unknown; origin: string; source: unknown }, readonly isTrusted: boolean) { super(); }
      get data() { return this.init.data; }
      get origin() { return this.init.origin; }
      get source() { return this.init.source; }
    }
    const listeners: { type: string; listener: (event: unknown) => void }[] = [];
    const win = {
      parent, MessageEvent: FakeMessageEvent, Event: FakeEvent,
      addEventListener: (type: string, listener: (event: unknown) => void) => { listeners.push({ type, listener }); },
      removeEventListener: (type: string, listener: (event: unknown) => void) => { const at = listeners.findIndex((entry) => entry.type === type && entry.listener === listener); if (at >= 0) listeners.splice(at, 1); },
    };
    const dispatch = (data: unknown, { trusted = true, source = parent as unknown, origin = APP } = {}) => {
      const event = new FakeMessageEvent({ data, origin, source }, trusted);
      for (const { type, listener } of [...listeners]) { if (event.stopped) break; if (type === 'message') listener(event); }
    };
    const received: { kind: string }[] = [];
    let post: ((payload: unknown) => void) | null = null;
    const close = openFrameDoor(win as unknown as Window, APP, async () => ({
      startFrameBridge: (options) => { post = options.post as (payload: unknown) => void; return { receive: (payload) => { received.push(payload); }, dispose() {} }; },
    }));
    return { win, dispatch, received, parentPosts, close, post: (payload: unknown) => post!(payload) };
  }
  const KEY = 'k'.repeat(24);
  const envelope = (payload: unknown, key: unknown = KEY) => ({ type: STORY_FRAME_BRIDGE_MESSAGE, key, payload });
  const session = { kind: 'region-session', regionId: 'r1', regionKind: 'rich', clientId: 7, state: new Uint8Array([1, 2, 3]), seq: 1 };
  const settle = async () => { for (let i = 0; i < 5; i++) await Promise.resolve(); };

  it('no author listener ever sees an envelope or its key, and forged region messages never reach the editor', async () => {
    const f = frame();
    const seenByAuthor: unknown[] = [];
    // The author's script runs after the door: its listener is later in the window's list.
    f.win.addEventListener('message', (event: unknown) => { seenByAuthor.push((event as { data: unknown }).data); });
    f.dispatch(envelope({ kind: 'attach', id: 'p1', editId: '1', source: null }));
    await settle();
    f.dispatch(envelope(session));
    expect(f.received).toEqual([session]);
    // Forgeries: synthetic (untrusted), from the frame itself, from another origin, without or with a guessed key.
    f.dispatch(envelope({ ...session, regionId: 'forged-untrusted' }), { trusted: false });
    f.dispatch(envelope({ ...session, regionId: 'forged-self' }), { source: f.win });
    f.dispatch(envelope({ ...session, regionId: 'forged-origin' }), { origin: 'https://evil.example' });
    f.dispatch({ type: STORY_FRAME_BRIDGE_MESSAGE, payload: { ...session, regionId: 'forged-keyless' } });
    f.dispatch(envelope({ ...session, regionId: 'forged-key' }, 'g'.repeat(24)));
    f.dispatch(envelope({ kind: 'region-remote', regionId: 'r1', updates: [new Uint8Array([9])], seq: 2 }, 'g'.repeat(24)));
    expect(f.received).toEqual([session]);
    expect(seenByAuthor).toEqual([]);
    // What the editor sends goes to the parent only, at the app's origin, under the session's key.
    f.post({ kind: 'region-update', regionId: 'r1', update: new Uint8Array([4]) });
    expect(f.parentPosts.at(-1)).toEqual([{ type: STORY_FRAME_BRIDGE_MESSAGE, key: KEY, payload: { kind: 'region-update', regionId: 'r1', update: new Uint8Array([4]) } }, APP]);
    // Messages that are not envelopes are the author's own business.
    f.dispatch({ type: 'author-message' }, { source: f.win, origin: 'https://page.example' });
    expect(seenByAuthor).toEqual([{ type: 'author-message' }]);
    f.close();
  });
});
