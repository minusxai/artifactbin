/**
 * The contract every read routed through the shared retry (lib/http/retry-lazily) is held to, one call site at a time:
 * a 502/503/504 or a dropped connection is asked again, a 4xx is the server's answer and is not, and an AbortSignal the
 * site carries stops the waits. Each site's test names how to start the read, which requests are its own, and how to
 * tell that its answer landed; this drives the fake clock through the policy's backoff.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

type Answer = Response | Error;
export interface RetryingRead {
  /** Starts the read. Returns how the site aborts it (its unmount, its controller) when it carries an AbortSignal. */
  start(): void | { abort(): void } | Promise<void | { abort(): void }>;
  /** True once the site has taken the successful answer. */
  landed(): boolean | Promise<boolean>;
}
export interface RetryingReadOptions {
  /** The site's own request; other requests are answered by `otherwise`. */
  matches: (url: string, init?: RequestInit) => boolean;
  /** The successful answer. */
  ok: () => Response;
  otherwise?: (url: string, init?: RequestInit) => Response | Promise<Response>;
  /** The site passes an AbortSignal (a controller, an unmount). */
  abortable?: boolean;
}

const json = (status: number, body: unknown = {}) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const realTick = () => new Promise<void>((resolve) => { const channel = new MessageChannel(); channel.port1.onmessage = () => { channel.port1.close(); resolve(); }; channel.port2.postMessage(0); });

/** Advance the fake clock in small steps, letting module loads and promise chains run between them. */
async function drive(ms: number, until?: () => boolean | Promise<boolean>) {
  for (let spent = 0; spent < ms; spent += 50) {
    await realTick();
    await vi.advanceTimersByTimeAsync(50);
    if (until && await until()) return;
  }
}

export function describeRetryingRead(name: string, make: () => RetryingRead, options: RetryingReadOptions) {
  describe(`${name} rides out a restart through the shared retry`, () => {
    let queue: Answer[] = [];
    let calls = 0;
    beforeAll(async () => { await import('@/lib/http/retry'); });
    beforeEach(() => {
      queue = []; calls = 0;
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'] });
      vi.stubGlobal('fetch', vi.fn(async (input: unknown, init?: RequestInit) => {
        const url = String(input instanceof Request ? input.url : input);
        if (!options.matches(url, init)) return options.otherwise ? options.otherwise(url, init) : json(404);
        calls++;
        const next = queue.shift() ?? options.ok();
        if (next instanceof Error) throw next;
        return next;
      }));
    });
    afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

    const run = async (first: Answer) => {
      queue = [first, options.ok()];
      const read = make();
      await read.start();
      await drive(20_000, async () => calls >= 2 && await read.landed());
      return read;
    };

    it.each([502, 503, 504])('asks again after a %i and takes the answer', async (status) => {
      const read = await run(json(status, { error: 'restarting' }));
      expect(calls).toBe(2);
      expect(await read.landed()).toBe(true);
    });

    it('asks again after a dropped connection and takes the answer', async () => {
      const read = await run(new TypeError('Failed to fetch'));
      expect(calls).toBe(2);
      expect(await read.landed()).toBe(true);
    });

    it.each([400, 403, 404])('does not ask again after a %i', async (status) => {
      queue = [json(status, { error: 'refused' }), options.ok()];
      await make().start();
      await drive(20_000);
      expect(calls).toBe(1);
    });

    if (options.abortable) {
      it('stops waiting, and sends nothing more, once its signal aborts', async () => {
        queue = [json(503, { error: 'restarting' }), options.ok()];
        const read = make();
        const handle = await read.start();
        await drive(400, () => calls >= 1);
        expect(calls).toBe(1);
        if (!handle) throw new Error('an abortable read must return its abort');
        handle.abort();
        await drive(20_000);
        expect(calls).toBe(1);
        expect(await read.landed()).toBe(false);
      });
    }
  });
}
