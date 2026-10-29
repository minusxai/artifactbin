/**
 * lib/http's live stream (a declared leaf): one EventSource that resumes from its last event id after a failure,
 * backs off between attempts, treats silence past LIVE_SILENCE_MS as a failure, wakes on `online` and visibility,
 * tells build observers what build the server's keepalives carry, and closes completely. Fake timers, a fake source.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  LIVE_BACKOFF_MAX_MS, LIVE_KEEPALIVE_EVENT, LIVE_KEEPALIVE_MS, LIVE_SILENCE_MS, LIVE_STALE_MS, liveBackoffDelay, observeLiveBuild, openLiveStream,
} from '@/lib/http';

class FakeSource {
  static opened: FakeSource[] = [];
  onopen: ((event: Event) => void) | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  closed = false;
  listeners = new Map<string, ((event: MessageEvent) => void)[]>();
  constructor(readonly url: string) { FakeSource.opened.push(this); }
  addEventListener(type: string, listener: (event: MessageEvent) => void) { this.listeners.set(type, [...this.listeners.get(type) ?? [], listener]); }
  close() { this.closed = true; }
  emit(type: string, data: string, lastEventId = '') {
    const event = { data, lastEventId } as MessageEvent;
    if (type === 'message') this.onmessage?.(event);
    for (const listener of this.listeners.get(type) ?? []) listener(event);
  }
}
const latest = () => FakeSource.opened.at(-1)!;

function fakeHost() {
  const listeners = new Map<string, () => void>();
  const docListeners = new Map<string, () => void>();
  const document = {
    visibilityState: 'visible',
    addEventListener: (type: string, l: () => void) => docListeners.set(type, l),
    removeEventListener: (type: string) => docListeners.delete(type),
  };
  return {
    host: { addEventListener: (type: string, l: () => void) => listeners.set(type, l), removeEventListener: (type: string) => listeners.delete(type), document },
    fire: (type: string) => listeners.get(type)?.(),
    visibility: (state: string) => { document.visibilityState = state; docListeners.get('visibilitychange')?.(); },
    listening: () => listeners.size + docListeners.size,
  };
}

beforeEach(() => { vi.useFakeTimers(); FakeSource.opened = []; vi.stubGlobal('EventSource', FakeSource); });
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

describe('the backoff', () => {
  it('doubles from one second, capped, with half its ceiling as jitter', () => {
    expect(liveBackoffDelay(0, () => 0)).toBe(500);
    expect(liveBackoffDelay(0, () => 1)).toBe(1000);
    expect(liveBackoffDelay(3, () => 1)).toBe(8000);
    expect(liveBackoffDelay(-2, () => 0)).toBe(500);
    expect(liveBackoffDelay(40, () => 1)).toBe(LIVE_BACKOFF_MAX_MS);
    expect(LIVE_KEEPALIVE_MS).toBeLessThan(LIVE_STALE_MS);
    expect(LIVE_STALE_MS).toBeLessThan(LIVE_SILENCE_MS);
  });
});

describe('a live stream', () => {
  it('delivers messages and named events, then resumes from the last event id after an error', () => {
    const messages: string[] = [], named: string[] = [], errors = vi.fn(), reconnects = vi.fn();
    const stream = openLiveStream({ url: '/a/x/events?v=1#frag', onMessage: m => messages.push(m), events: { comment: d => named.push(d) }, onError: errors, onReconnect: reconnects, random: () => 0 });
    expect(latest().url).toBe('/a/x/events?v=1#frag');
    latest().emit('message', 'one', '7');
    latest().emit('comment', 'c1', '8');
    expect([messages, named]).toEqual([['one'], ['c1']]);
    const first = latest();
    first.onerror?.(new Event('error'));
    expect(first.closed).toBe(true);
    expect(errors).toHaveBeenCalledOnce();
    vi.advanceTimersByTime(499);
    expect(FakeSource.opened).toHaveLength(1);
    vi.advanceTimersByTime(1);
    expect(latest().url).toBe('/a/x/events?v=1&since=8');
    first.emit('message', 'stale source');
    expect(messages).toEqual(['one']);
    latest().emit('message', 'two');
    expect(reconnects).toHaveBeenCalledOnce();
    stream.close();
  });

  it('backs off longer after each failure and resets once it hears from the server', () => {
    const stream = openLiveStream({ url: '/e', random: () => 1 });
    latest().onerror?.(new Event('error'));
    vi.advanceTimersByTime(1000);
    expect(FakeSource.opened).toHaveLength(2);
    latest().onerror?.(new Event('error'));
    vi.advanceTimersByTime(1999);
    expect(FakeSource.opened).toHaveLength(2);
    vi.advanceTimersByTime(1);
    expect(FakeSource.opened).toHaveLength(3);
    latest().emit(LIVE_KEEPALIVE_EVENT, '{}');
    latest().onerror?.(new Event('error'));
    vi.advanceTimersByTime(1000);
    expect(FakeSource.opened).toHaveLength(4);
    stream.close();
  });

  it('treats silence past the limit as a failure, and a keepalive keeps it open', () => {
    const errors = vi.fn();
    const stream = openLiveStream({ url: '/e', onError: errors, random: () => 0 });
    latest().onopen?.(new Event('open'));
    vi.advanceTimersByTime(LIVE_SILENCE_MS - 1);
    latest().emit(LIVE_KEEPALIVE_EVENT, '{}');
    vi.advanceTimersByTime(LIVE_SILENCE_MS - 1);
    expect(errors).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(errors).toHaveBeenCalledOnce();
    stream.close();
  });

  it('reopens at once on wake when stale, and only reports a wake when fresh', () => {
    const { host, fire, visibility, listening } = fakeHost();
    const wake = vi.fn();
    const stream = openLiveStream({ url: '/e', host, onWake: wake });
    fire('online');
    expect(wake).toHaveBeenCalledOnce();
    expect(FakeSource.opened).toHaveLength(1);
    vi.advanceTimersByTime(LIVE_STALE_MS + 1);
    visibility('hidden');
    expect(FakeSource.opened).toHaveLength(1);
    visibility('visible');
    expect(FakeSource.opened).toHaveLength(2);
    stream.close();
    expect(listening()).toBe(0);
    expect(latest().closed).toBe(true);
    fire('online');
    stream.close();
    expect(FakeSource.opened).toHaveLength(2);
  });

  it('tells build observers the build a keepalive names, ignoring malformed frames', () => {
    const builds: string[] = [];
    const stop = observeLiveBuild(build => builds.push(build));
    const stream = openLiveStream({ url: '/e' });
    for (const frame of ['{"build":"b1"}', '{}', 'not json', '{"build":""}', 'null', '{"build":"b2"}']) latest().emit(LIVE_KEEPALIVE_EVENT, frame);
    stop();
    latest().emit(LIVE_KEEPALIVE_EVENT, '{"build":"b3"}');
    expect(builds).toEqual(['b1', 'b2']);
    stream.close();
  });

  it('does nothing without an EventSource', () => {
    vi.stubGlobal('EventSource', undefined);
    const stream = openLiveStream({ url: '/e' });
    expect(FakeSource.opened).toHaveLength(0);
    stream.close();
  });
});
