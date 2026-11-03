import { describe, expect, it } from 'vitest';
import { BrowserUnavailable, createBrowserHolder, REPLACED_CLOSE_WAIT_MS } from '../src/browser-holder';

class FakeBrowser {
  connected = true;
  closes = 0;
  constructor(readonly id: number, private readonly closeGate: () => Promise<void>) {}
  isConnected() { return this.connected; }
  async close() { this.closes++; await this.closeGate(); this.connected = false; }
}

/** A holder over fake browsers and a manual clock: launches can be held open, closes held, timers fired by hand. */
function harness(idleMs = 1_000) {
  const launched: FakeBrowser[] = [];
  const state = { launches: 0, fail: false, launchGate: undefined as Promise<void> | undefined, closeGate: undefined as Promise<void> | undefined };
  const timers = new Map<number, { run: () => void; ms: number }>();
  let nextTimer = 0;
  const holder = createBrowserHolder<FakeBrowser>({
    idleMs,
    launch: async () => {
      state.launches++;
      if (state.launchGate) await state.launchGate;
      if (state.fail) throw new Error('no chromium');
      const browser = new FakeBrowser(state.launches, () => state.closeGate ?? Promise.resolve());
      launched.push(browser);
      return browser;
    },
    timer: (run, ms) => { const id = nextTimer++; timers.set(id, { run, ms }); return () => { timers.delete(id); }; },
  });
  const fire = (ms: number) => { for (const [id, timer] of [...timers]) if (timer.ms === ms) { timers.delete(id); timer.run(); } };
  const flush = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };
  const gate = () => { let open!: () => void; const promise = new Promise<void>(resolve => { open = resolve; }); return { promise, open }; };
  return { holder, launched, state, timers, fire, flush, gate };
}

describe('the render browser holder', () => {
  it('gives concurrent callers during a relaunch one browser, and none of them closes it', async () => {
    const { holder, launched, state, flush, gate } = harness();
    (await holder.acquire(1_000)).release();
    launched[0]!.connected = false; // crashed
    const relaunch = gate();
    state.launchGate = relaunch.promise;
    const callers = [holder.acquire(1_000), holder.acquire(1_000), holder.acquire(1_000)];
    await flush();
    expect(state.launches).toBe(2);
    relaunch.open();
    const leases = await Promise.all(callers);
    expect(new Set(leases.map(lease => lease.browser))).toEqual(new Set([launched[1]]));
    expect(launched[1]!.closes).toBe(0);
    expect(launched[0]!.closes).toBe(1);
    // A late caller that still holds the dead browser retires it without touching the replacement.
    await holder.retire(launched[0]!);
    expect(launched[1]!.closes).toBe(0);
    expect((await holder.acquire(1_000)).browser).toBe(launched[1]);
    expect(state.launches).toBe(2);
  });

  it('arms the idle shutdown only when the last lease is released, and disarms it on the next acquire', async () => {
    const { holder, launched, timers, fire, flush } = harness(1_000);
    const first = await holder.acquire(1_000);
    const second = await holder.acquire(1_000);
    first.release();
    first.release(); // idempotent: never releases the other lease
    expect(timers.size).toBe(0);
    second.release();
    expect(timers.size).toBe(1);
    const third = await holder.acquire(1_000);
    expect(timers.size).toBe(0);
    fire(1_000);
    await flush();
    expect(launched[0]!.closes).toBe(0);
    third.release();
    fire(1_000);
    await flush();
    expect(launched[0]!.closes).toBe(1);
  });

  it('waits for the browser it replaces to close before launching, bounded so a wedged close never blocks', async () => {
    const { holder, launched, state, fire, flush, gate } = harness(1_000);
    (await holder.acquire(1_000)).release();
    const closing = gate();
    state.closeGate = closing.promise;
    fire(1_000); // idle shutdown begins closing browser 1
    await flush();
    const next = holder.acquire(1_000);
    await flush();
    expect(state.launches).toBe(1);
    closing.open();
    await next;
    expect(state.launches).toBe(2);
    // A close that never finishes delays the launch only up to its bound.
    state.closeGate = new Promise<void>(() => {});
    const wedged = await holder.acquire(1_000);
    void holder.retire(wedged.browser);
    wedged.release();
    const after = holder.acquire(1_000);
    await flush();
    expect(state.launches).toBe(2);
    fire(REPLACED_CLOSE_WAIT_MS);
    expect((await after).browser).toBe(launched[2]);
  });

  it('answers BrowserUnavailable for a failed launch, and the next acquire tries again', async () => {
    const { holder, state, timers } = harness();
    state.fail = true;
    await expect(holder.acquire(1_000)).rejects.toBeInstanceOf(BrowserUnavailable);
    expect(timers.size).toBe(1); // the failed acquire released its hold
    state.fail = false;
    await expect(holder.acquire(1_000)).resolves.toMatchObject({ browser: { id: 2 } });
  });
});
