/**
 * THE ONE RENDER BROWSER: launched on first use, shared by every lease, shut after it has been idle.
 *
 * - A LEASE holds the idle shutdown off: the timer is armed only when the last lease is released, and an
 *   acquire disarms it before anything else, so idleness never closes a browser a render is using.
 * - ONE LAUNCH AT A TIME: every concurrent caller awaits the same launch, and a disconnected browser is replaced
 *   only if it is still the held one, so callers that saw the same dead browser share one relaunch and none of
 *   them closes a browser another caller launched.
 * - NEVER TWO BROWSERS: a launch first waits (bounded) for the close of the browser it replaces.
 * - A failed launch never poisons the next try; it rejects with `BrowserUnavailable` (the `unavailable` verdict).
 *
 * Pure policy over any `HeldBrowser` (Playwright's Browser is one) and an injected timer, so it is tested with
 * fakes. Closing a timed-out PAGE is the caller's; `retire` is for a browser that could not even do that.
 */
export interface HeldBrowser { isConnected(): boolean; close(): Promise<void> }

export interface BrowserLease<B> {
  readonly browser: B;
  /** Idempotent. The last release arms the idle shutdown. */
  release(): void;
}

export class BrowserUnavailable extends Error {}

/** Longest a launch waits for the browser it replaces to close; a wedged close never blocks rendering. */
export const REPLACED_CLOSE_WAIT_MS = 5_000;

export function createBrowserHolder<B extends HeldBrowser>(opts: {
  launch: (timeoutMs: number) => Promise<B>;
  idleMs: number;
  /** Runs `run` after `ms`; returns the disarm. */
  timer: (run: () => void, ms: number) => () => void;
}) {
  type Slot = { launch: Promise<B>; browser?: B };
  let slot: Slot | undefined;
  let closing: Promise<void> = Promise.resolve();
  let active = 0;
  let disarmIdle: (() => void) | undefined;

  const settledWithin = (work: Promise<unknown>, ms: number) => new Promise<void>(resolve => {
    const disarm = opts.timer(resolve, ms);
    void work.then(() => { disarm(); resolve(); }, () => { disarm(); resolve(); });
  });

  /** A close the next launch waits for, each bounded on its own so a wedged one delays no launch for long. */
  const closingNow = (close: Promise<unknown>): Promise<void> => {
    const done = settledWithin(close, REPLACED_CLOSE_WAIT_MS);
    closing = Promise.all([closing, done]).then(() => {});
    return done;
  };

  /** Closes exactly this slot's browser; the slot is emptied only if it is still the held one. */
  const shut = (held: Slot): Promise<void> => {
    if (slot === held) slot = undefined;
    return closingNow(held.launch.then(browser => browser.close()));
  };

  const start = (timeoutMs: number): Slot => {
    const held: Slot = {
      launch: (async () => {
        await closing;
        return opts.launch(timeoutMs);
      })().then(
        browser => { held.browser = browser; return browser; },
        (error: unknown) => { if (slot === held) slot = undefined; throw new BrowserUnavailable((error as Error)?.message ?? String(error)); },
      ),
    };
    slot = held;
    return held;
  };

  const connected = async (timeoutMs: number): Promise<B> => {
    for (let attempt = 0; ; attempt++) {
      const held = slot ?? start(timeoutMs);
      const browser = await held.launch;
      if (browser.isConnected()) return browser;
      if (slot === held) void shut(held); // else another caller already replaced it
      if (attempt > 0) throw new BrowserUnavailable('Browser disconnected right after launch');
    }
  };

  return {
    /** A connected browser for one unit of work. Rejects with `BrowserUnavailable` when none can be launched. */
    async acquire(timeoutMs: number): Promise<BrowserLease<B>> {
      active++;
      disarmIdle?.(); disarmIdle = undefined;
      let released = false;
      const release = () => {
        if (released) return;
        released = true;
        if (--active > 0) return;
        disarmIdle = opts.timer(() => { disarmIdle = undefined; if (active === 0 && slot) void shut(slot); }, opts.idleMs);
      };
      try { return { browser: await connected(timeoutMs), release }; } catch (error) { release(); throw error; }
    },
    /** Closes this browser; the next acquire launches a new one unless another already replaced it. */
    retire(browser: B): Promise<void> {
      return slot?.browser === browser ? shut(slot) : closingNow(browser.close());
    },
    async close(): Promise<void> {
      disarmIdle?.(); disarmIdle = undefined;
      if (slot) void shut(slot);
      await closing;
    },
  };
}
