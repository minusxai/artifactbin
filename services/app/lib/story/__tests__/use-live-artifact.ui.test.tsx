/**
 * The viewer's live subscription. THE STREAM CARRIES PINGS: `{editId,
 * version, by}` names the head, and the document itself is FETCHED from
 * `/a/<id>/events/frame` — complete every time (the stylesheet included), so
 * there is no sticky state to keep here any more. What the hook still owns
 * is ORDER: a version floor that never rewinds, and the caller's right to
 * disown its own writes before they become state.
 */
import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useLiveArtifact } from '@/lib/story/use-live-artifact';

/** Minimal EventSource stand-in whose messages the test drives by hand. */
class FakeEventSource {
  listeners: Record<string, Array<(e: MessageEvent) => void>> = {};
  addEventListener(type: string, fn: (e: MessageEvent) => void) { (this.listeners[type] ??= []).push(fn); }
  removeEventListener(type: string, fn: (e: MessageEvent) => void) { this.listeners[type] = (this.listeners[type] ?? []).filter((f) => f !== fn); }
  emitData(payload: unknown) { for (const fn of this.listeners.data ?? []) fn({ data: JSON.stringify(payload) } as MessageEvent); }
  static last: FakeEventSource | null = null;
  onmessage: ((e: { data: string }) => void) | null = null;
  closed = false;
  constructor(public url: string) { FakeEventSource.last = this; }
  /** A version PING; the frame the fetch will answer with is set beside it. */
  emit(frame: Record<string, unknown>) {
    served = frame;
    this.onmessage?.({ data: JSON.stringify({ editId: frame.editId, version: frame.version, by: frame.by ?? null }) });
  }
  close() { this.closed = true; }
}

/** What `/a/<id>/events/frame` answers next. */
let served: Record<string, unknown> | null = null;
let fetches = 0;

beforeEach(() => {
  served = null;
  fetches = 0;
  vi.stubGlobal('EventSource', FakeEventSource);
  vi.stubGlobal('fetch', (async (url: string) => {
    fetches += 1;
    if (!String(url).endsWith('/events/frame') || !served) return new Response('not found', { status: 404 });
    return new Response(JSON.stringify(served), { headers: { 'content-type': 'application/json' } });
  }) as unknown as typeof fetch);
});
afterEach(() => {
  vi.unstubAllGlobals();
  FakeEventSource.last = null;
});

const frame = (over: Record<string, unknown>) => ({
  editId: 'e2', version: 2, format: 'markup', title: 't', source: '<p>a</p>', content: null, compiledCss: null, authorCss: null, ...over,
});
const emit = (f: Record<string, unknown>) => act(async () => { FakeEventSource.last!.emit(f); await Promise.resolve(); });

describe('useLiveArtifact', () => {
  it('subscribes to this artifact and closes the stream on unmount', () => {
    const hook = renderHook(() => useLiveArtifact('story1', 'e1', 1));
    expect(FakeEventSource.last?.url).toBe('/a/story1/events');
    hook.unmount();
    expect(FakeEventSource.last?.closed).toBe(true);
  });

  it('ignores an opening ping that only echoes what the page already renders — and fetches nothing', async () => {
    const hook = renderHook(() => useLiveArtifact('story1', 'e1', 1));
    await emit(frame({ editId: 'e1', version: 1 }));
    expect(hook.result.current).toBeNull();
    expect(fetches).toBe(0);
  });

  it('fetches and surfaces the frame a newer ping points at', async () => {
    const hook = renderHook(() => useLiveArtifact('story1', 'e1', 1));
    await emit(frame({ source: '<p>new</p>', compiledCss: '.a{}' }));
    await waitFor(() => expect(hook.result.current).toMatchObject({ source: '<p>new</p>', compiledCss: '.a{}' }));
    expect(fetches).toBe(1);
  });

  it('uses the frame AS FETCHED — the stylesheet travels with every frame, nothing is sticky', async () => {
    const hook = renderHook(() => useLiveArtifact('story1', 'e1', 1));
    await emit(frame({ editId: 'e2', compiledCss: '.new-class{color:red}' }));
    await waitFor(() => expect(hook.result.current?.compiledCss).toBe('.new-class{color:red}'));
    await emit(frame({ editId: 'e3', version: 3, source: '<p>edited</p>', compiledCss: '.new-class{color:red}' }));
    await waitFor(() => expect(hook.result.current?.source).toBe('<p>edited</p>'));
    expect(hook.result.current?.compiledCss).toBe('.new-class{color:red}');
  });

  it('a malformed ping is a dropped wakeup, not a crash', () => {
    const hook = renderHook(() => useLiveArtifact('story1', 'e1', 1));
    act(() => { FakeEventSource.last!.onmessage?.({ data: 'not json' }); });
    expect(hook.result.current).toBeNull();
  });

  it('never rewinds when an older ping arrives after a newer one', async () => {
    const hook = renderHook(() => useLiveArtifact('story1', 'e1', 1));
    await emit(frame({ editId: 'e3', version: 3, source: '<p>fresh</p>' }));
    await waitFor(() => expect(hook.result.current?.version).toBe(3));
    await emit(frame({ editId: 'e2', version: 2, source: '<p>old</p>' }));
    expect(hook.result.current).toMatchObject({ editId: 'e3', version: 3, source: '<p>fresh</p>' });
  });

  it('drops a frame that arrives after a newer one was already shown (a slow fetch cannot rewind)', async () => {
    const hook = renderHook(() => useLiveArtifact('story1', 'e1', 1));
    await emit(frame({ editId: 'e3', version: 3, source: '<p>fresh</p>' }));
    await waitFor(() => expect(hook.result.current?.version).toBe(3));
    served = frame({ editId: 'e2', version: 2, source: '<p>old</p>' });
    await act(async () => { FakeEventSource.last!.onmessage?.({ data: JSON.stringify({ editId: 'e4', version: 4, by: null }) }); await Promise.resolve(); });
    await act(async () => { await Promise.resolve(); });
    expect(hook.result.current?.version).toBe(3);
  });

  it('hands control back to refreshed server props when their version catches up', async () => {
    const hook = renderHook(
      ({ version }) => useLiveArtifact('story1', version === 1 ? 'e1' : 'e2', version),
      { initialProps: { version: 1 } },
    );
    await emit(frame({ editId: 'e2', version: 2, source: '<p>live</p>' }));
    await waitFor(() => expect(hook.result.current?.version).toBe(2));
    hook.rerender({ version: 2 });
    expect(hook.result.current).toBeNull();
  });

  it('does not subscribe at all when disabled', () => {
    renderHook(() => useLiveArtifact('story1', 'e1', 1, false));
    expect(FakeEventSource.last).toBeNull();
  });
});

/**
 * The EDITOR watches the same stream it writes to. Every accepted `/edits`
 * write pings, and fetching its own frame back would be a fetch plus a full
 * editor render per keystroke burst, all to arrive at "nothing to do". So the
 * caller says which pings are its own, and those never become a fetch — while
 * still advancing the version floor a LATER ping from someone else is judged by.
 */
describe('useLiveArtifact — the caller can disown its own frames', () => {
  it('drops a ping the caller recognises as its own, without a fetch or a re-render', async () => {
    let renders = 0;
    const hook = renderHook(() => {
      renders += 1;
      return useLiveArtifact('story1', 'e1', 1, true, (editId) => editId === 'mine');
    });
    const before = renders;
    await emit(frame({ editId: 'mine', version: 2, source: '<p>echo</p>' }));
    expect(hook.result.current).toBeNull();
    expect(renders).toBe(before);
    expect(fetches).toBe(0);
  });

  it('still surfaces a frame written by someone else', async () => {
    const hook = renderHook(() => useLiveArtifact('story1', 'e1', 1, true, (editId) => editId === 'mine'));
    await emit(frame({ editId: 'mine', version: 2, source: '<p>echo</p>' }));
    await emit(frame({ editId: 'theirs', version: 3, source: '<p>theirs</p>' }));
    await waitFor(() => expect(hook.result.current).toMatchObject({ editId: 'theirs', source: '<p>theirs</p>' }));
  });

  it('a dropped ping still raises the version floor (a late older ping stays refused)', async () => {
    const hook = renderHook(() => useLiveArtifact('story1', 'e1', 1, true, (editId) => editId === 'mine'));
    await emit(frame({ editId: 'mine', version: 5, source: '<p>echo</p>' }));
    await emit(frame({ editId: 'stale', version: 4, source: '<p>old</p>' }));
    expect(hook.result.current).toBeNull();
    expect(fetches).toBe(0);
  });
});
