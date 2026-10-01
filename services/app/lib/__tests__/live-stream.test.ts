/**
 * THE RECONNECTING LIVE STREAM (lib/live-stream): the page, not the browser, owns liveness. Any error
 * or close reopens with exponential backoff (1 s → 30 s, jittered), heartbeat silence counts as a
 * dead stream, and a page coming back (visible, online) reopens a stale stream or asks its owner to
 * check the head.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  LIVE_BACKOFF_MAX_MS, LIVE_KEEPALIVE_EVENT, LIVE_SILENCE_MS, LIVE_STALE_MS, liveBackoffDelay, openLiveStream, type LiveStreamHost,
} from '../live-stream';

class FakeEventSource extends EventTarget {
  static made: FakeEventSource[] = [];
  onopen: ((e: Event) => void) | null = null;
  onmessage: ((e: MessageEvent) => void) | null = null;
  onerror: ((e: Event) => void) | null = null;
  closed = false;
  constructor(public url: string) { super(); FakeEventSource.made.push(this); }
  close() { this.closed = true; }
  open() { this.onopen?.(new Event('open')); }
  message(data: string) { this.onmessage?.(new MessageEvent('message', { data })); }
  named(name: string, data = '{}') { this.dispatchEvent(new MessageEvent(name, { data })); }
  /** What the browser reports for a dropped connection, a refused one, or a 502/503 answer alike. */
  fail() { this.onerror?.(new Event('error')); }
}

function fakeHost() {
  const win = new EventTarget();
  const doc = Object.assign(new EventTarget(), { visibilityState: 'visible' as string });
  const host = Object.assign(win, { document: doc }) as unknown as LiveStreamHost;
  return {
    host,
    hide: () => { doc.visibilityState = 'hidden'; doc.dispatchEvent(new Event('visibilitychange')); },
    show: () => { doc.visibilityState = 'visible'; doc.dispatchEvent(new Event('visibilitychange')); },
    online: () => win.dispatchEvent(new Event('online')),
  };
}

const latest = () => FakeEventSource.made.at(-1)!;
const noJitter = () => 1; // the full ceiling, so delays are exact

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal('EventSource', FakeEventSource);
  FakeEventSource.made = [];
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('backoff', () => {
  it('doubles from 1 s to a 30 s cap, jittered between half and the full ceiling', () => {
    expect([0, 1, 2, 3, 4, 5, 6, 10].map((n) => liveBackoffDelay(n, () => 1))).toEqual([1000, 2000, 4000, 8000, 16000, 30000, 30000, 30000]);
    expect(liveBackoffDelay(0, () => 0)).toBe(500);
    expect(liveBackoffDelay(20, () => 0)).toBe(LIVE_BACKOFF_MAX_MS / 2);
  });
});

describe('openLiveStream', () => {
  it('delivers unnamed and named frames to their handlers', () => {
    const onMessage = vi.fn(), onData = vi.fn();
    const stream = openLiveStream({ url: '/a/x/events', onMessage, events: { data: onData }, host: fakeHost().host });
    latest().message('{"editId":"e2"}');
    latest().named('data', '{"datasets":["D1"]}');
    expect(onMessage).toHaveBeenCalledWith('{"editId":"e2"}');
    expect(onData).toHaveBeenCalledWith('{"datasets":["D1"]}');
    stream.close();
    expect(latest().closed).toBe(true);
  });

  it('reopens after ANY error (a 502 on reconnect included) with exponential backoff, and resets once a frame arrives', () => {
    const onError = vi.fn();
    const stream = openLiveStream({ url: '/a/x/events', host: fakeHost().host, random: noJitter, onError });
    expect(FakeEventSource.made).toHaveLength(1);

    latest().fail(); // dropped
    expect(FakeEventSource.made[0]!.closed, 'the broken source is closed, never left to the browser').toBe(true);
    expect(onError).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(999);
    expect(FakeEventSource.made).toHaveLength(1);
    vi.advanceTimersByTime(1);
    expect(FakeEventSource.made).toHaveLength(2);

    latest().fail(); // the proxy answered 502 while the app restarted: EventSource would stop for good here
    vi.advanceTimersByTime(1999);
    expect(FakeEventSource.made).toHaveLength(2);
    vi.advanceTimersByTime(1);
    expect(FakeEventSource.made).toHaveLength(3);

    latest().fail();
    vi.advanceTimersByTime(4000);
    expect(FakeEventSource.made).toHaveLength(4);

    // The server is back: its first frame (the catch-up head) resets the backoff.
    latest().open();
    latest().message('{"editId":"e3"}');
    latest().fail();
    vi.advanceTimersByTime(1000);
    expect(FakeEventSource.made, 'back to 1 s after a working stream').toHaveLength(5);
    stream.close();
  });

  it('caps the wait at 30 s however long the outage lasts', () => {
    const stream = openLiveStream({ url: '/a/x/events', host: fakeHost().host, random: noJitter });
    for (let i = 0; i < 8; i++) { latest().fail(); vi.advanceTimersByTime(LIVE_BACKOFF_MAX_MS); }
    const before = FakeEventSource.made.length;
    latest().fail();
    vi.advanceTimersByTime(LIVE_BACKOFF_MAX_MS - 1);
    expect(FakeEventSource.made).toHaveLength(before);
    vi.advanceTimersByTime(1);
    expect(FakeEventSource.made).toHaveLength(before + 1);
    stream.close();
  });

  it('treats heartbeat silence as a dead stream and reopens it; heartbeats keep it open', () => {
    const stream = openLiveStream({ url: '/a/x/events', host: fakeHost().host, random: noJitter });
    latest().open();
    for (let i = 0; i < 6; i++) { vi.advanceTimersByTime(15_000); latest().named(LIVE_KEEPALIVE_EVENT); }
    expect(FakeEventSource.made, 'a stream that keeps beating is left alone').toHaveLength(1);

    vi.advanceTimersByTime(LIVE_SILENCE_MS); // half-open: no error, just nothing
    expect(FakeEventSource.made[0]!.closed).toBe(true);
    vi.advanceTimersByTime(1000);
    expect(FakeEventSource.made).toHaveLength(2);
    stream.close();
  });

  it('a page coming back online reopens a stale or broken stream at once, skipping the backoff', () => {
    const page = fakeHost();
    const stream = openLiveStream({ url: '/a/x/events', host: page.host, random: noJitter });
    for (let i = 0; i < 4; i++) { latest().fail(); vi.advanceTimersByTime(30_000); }
    latest().fail(); // offline: now waiting out a long backoff
    const before = FakeEventSource.made.length;
    page.online();
    expect(FakeEventSource.made).toHaveLength(before + 1);
    stream.close();
  });

  it('coming back online while a reopen hangs in connecting (no event heard for a while) reopens at once', () => {
    const page = fakeHost();
    const onWake = vi.fn();
    const stream = openLiveStream({ url: '/a/x/events', host: page.host, onWake, random: noJitter });
    latest().open();
    latest().message('{}');
    vi.advanceTimersByTime(LIVE_SILENCE_MS); // offline: silence, the watchdog reopens
    vi.advanceTimersByTime(1000);
    expect(FakeEventSource.made).toHaveLength(2); // this one hangs: no error, no event
    vi.advanceTimersByTime(10_000);
    page.online();
    expect(FakeEventSource.made, 'nothing heard for 56 s: reopened, not trusted').toHaveLength(3);
    expect(onWake).not.toHaveBeenCalled();
    stream.close();
  });

  it('a page made visible after a silent spell reopens; one whose stream is alive asks its owner to check the head', () => {
    const page = fakeHost();
    const onWake = vi.fn();
    const stream = openLiveStream({ url: '/a/x/events', host: page.host, onWake });
    latest().open();
    latest().message('{}');

    page.hide();
    vi.advanceTimersByTime(5_000);
    page.show();
    expect(FakeEventSource.made, 'alive: no reconnect churn on a tab switch').toHaveLength(1);
    expect(onWake).toHaveBeenCalledTimes(1);

    page.hide();
    // The tab was frozen: no heartbeat arrived and no timer ran.
    vi.setSystemTime(Date.now() + LIVE_STALE_MS + 1);
    page.show();
    expect(FakeEventSource.made, 'stale: reopened, and the reopen is the catch-up').toHaveLength(2);
    expect(onWake).toHaveBeenCalledTimes(1);
    stream.close();
  });

  it('close stops every timer and listener: nothing reopens afterwards', () => {
    const page = fakeHost();
    const stream = openLiveStream({ url: '/a/x/events', host: page.host });
    latest().fail();
    stream.close();
    vi.advanceTimersByTime(LIVE_SILENCE_MS * 2);
    page.online();
    page.show();
    expect(FakeEventSource.made).toHaveLength(1);
  });
});
