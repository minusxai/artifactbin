/**
 * ONE RECONNECTING SERVER-SENT-EVENTS STREAM, owned by the page rather than by the browser.
 *
 * A bare EventSource gives up for good on any non-2xx answer (a 502 from a proxy while the app
 * restarts, the events door's own 503 at capacity) and cannot tell a half-open TCP stream (laptop
 * sleep, Wi-Fi change, NAT timeout) from a quiet one. Every live stream in the app goes through this
 * instead:
 *
 *  - ANY error or close is answered by closing the source and opening a fresh one after an
 *    exponential backoff (1 s doubling to a 30 s cap, with jitter). The first event of a working
 *    stream resets the backoff. A reopen needs no bookkeeping: the server's first frame is always
 *    the current head (app/a/[id]/events), so reconnecting IS catching up.
 *  - The server sends a named `keepalive` event every 15 s (a comment line never reaches script).
 *    `LIVE_SILENCE_MS` without any event means the stream is dead, and it is reopened.
 *  - When the page becomes visible again or the browser comes back online, a stream that has been
 *    silent past `LIVE_STALE_MS` (or is waiting out a backoff) is reopened at once; a stream that is
 *    demonstrably alive instead asks its owner to check the head itself (`onWake`).
 */

/** The named event both live doors send as their heartbeat. Old clients ignore an unknown event name. */
export const LIVE_KEEPALIVE_EVENT = 'keepalive';
/** How often the servers send it. */
export const LIVE_KEEPALIVE_MS = 15_000;
/** Silence after which a stream is treated as dead: three missed heartbeats. */
export const LIVE_SILENCE_MS = 45_000;
/** Silence after which a page coming back (visible, online) reopens rather than trusting the stream. */
export const LIVE_STALE_MS = 20_000;
const LIVE_BACKOFF_MS = 1_000;
export const LIVE_BACKOFF_MAX_MS = 30_000;

/** The wait before retry `attempt` (0-based): exponential to the cap, then "equal jitter" (half fixed, half random). */
export function liveBackoffDelay(attempt: number, random: () => number = Math.random): number {
  const ceiling = Math.min(LIVE_BACKOFF_MAX_MS, LIVE_BACKOFF_MS * 2 ** Math.max(0, attempt));
  return Math.round(ceiling / 2 + random() * (ceiling / 2));
}

/** The slice of `window` the stream listens on; injectable so a test can drive visibility and connectivity. */
export interface LiveStreamHost {
  addEventListener(type: string, listener: () => void): void;
  removeEventListener(type: string, listener: () => void): void;
  document?: { visibilityState?: string; addEventListener(type: string, listener: () => void): void; removeEventListener(type: string, listener: () => void): void };
}

interface LiveStreamOptions {
  url: string;
  /** The default (unnamed) `message` frame's data. */
  onMessage?: (data: string) => void;
  /** Named frames, by event name. */
  events?: Record<string, (data: string) => void>;
  /** The page came back while the stream still looks alive: check the current head out of band. */
  onWake?: () => void;
  /** The stream broke (error, close or heartbeat silence) and a reopen is scheduled. */
  onError?: () => void;
  host?: LiveStreamHost;
  random?: () => number;
}

interface LiveStream {
  close(): void;
}

type Source = {
  onopen: ((event: Event) => void) | null;
  onmessage: ((event: MessageEvent) => void) | null;
  onerror: ((event: Event) => void) | null;
  addEventListener(type: string, listener: (event: MessageEvent) => void): void;
  close(): void;
};

export function openLiveStream(options: LiveStreamOptions): LiveStream {
  const host: LiveStreamHost | undefined = options.host ?? (typeof window === 'undefined' ? undefined : window);
  const EventSourceCtor = (globalThis as { EventSource?: new (url: string) => Source }).EventSource;
  let source: Source | null = null;
  let attempt = 0;
  let closed = false;
  let lastEvent = Date.now();
  let retry: ReturnType<typeof setTimeout> | undefined;
  let watchdog: ReturnType<typeof setTimeout> | undefined;

  const armWatchdog = () => {
    clearTimeout(watchdog);
    watchdog = setTimeout(fail, LIVE_SILENCE_MS);
  };
  /** Anything arrived: the server answered and is streaming, so the backoff starts over. */
  const heard = () => {
    lastEvent = Date.now();
    attempt = 0;
    armWatchdog();
  };

  function open() {
    if (closed || !EventSourceCtor) return;
    clearTimeout(retry);
    retry = undefined;
    source?.close();
    const current = new EventSourceCtor(options.url);
    source = current;
    // `lastEvent` is NOT reset here: a reopen that hangs while connecting has heard nothing, and a
    // page coming back online must treat it as stale rather than as a live stream.
    const mine = () => source === current && !closed;
    current.onopen = () => { if (mine()) armWatchdog(); };
    current.onmessage = (event) => { if (!mine()) return; heard(); options.onMessage?.(String(event.data)); };
    for (const [name, handler] of Object.entries(options.events ?? {})) {
      current.addEventListener(name, (event) => { if (!mine()) return; heard(); handler(String(event.data)); });
    }
    current.addEventListener(LIVE_KEEPALIVE_EVENT, () => { if (mine()) heard(); });
    current.onerror = () => { if (mine()) fail(); };
    // A connect that hangs (offline, a black-holed route) is bounded by the same silence rule.
    armWatchdog();
  }

  function fail() {
    if (closed) return;
    clearTimeout(watchdog);
    source?.close();
    source = null;
    clearTimeout(retry);
    retry = setTimeout(open, liveBackoffDelay(attempt++, options.random));
    options.onError?.();
  }

  const wake = () => {
    if (closed) return;
    if (!source || Date.now() - lastEvent > LIVE_STALE_MS) {
      attempt = 0;
      open();
      return;
    }
    options.onWake?.();
  };
  const onVisibility = () => { if (host?.document?.visibilityState !== 'hidden') wake(); };
  host?.addEventListener('online', wake);
  host?.document?.addEventListener('visibilitychange', onVisibility);

  open();

  return {
    close() {
      if (closed) return;
      closed = true;
      clearTimeout(retry);
      clearTimeout(watchdog);
      source?.close();
      source = null;
      host?.removeEventListener('online', wake);
      host?.document?.removeEventListener('visibilitychange', onVisibility);
    },
  };
}
