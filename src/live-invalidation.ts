import type {
  LiveInvalidationConsumer,
  LiveInvalidationOptions,
} from "./live-invalidation-contracts.ts";
const BATCH = 128;
/** Each process observes every durable event. Restart replays retained history; reconnect refreshes authoritative data. */
export function createLiveInvalidationConsumer(
  options: LiveInvalidationOptions,
): LiveInvalidationConsumer {
  const interval = options.intervalMs ?? 500;
  if (!Number.isSafeInteger(interval) || interval < 1 || interval > 60000)
    throw Error("Invalid invalidation interval");
  const clock = options.clock ?? {
    after(ms: number, fn: () => void) {
      const timer = setTimeout(fn, ms);
      timer.unref();
      return () => clearTimeout(timer);
    },
  };
  let sequence = "0",
    stopped = false,
    running: Promise<void> | undefined,
    cancel: (() => void) | undefined,
    nextDelay = interval;
  async function run() {
    const events = await options.reader.after(sequence, BATCH);
    if (events.length > BATCH) throw Error("Invalid invalidation batch");
    nextDelay = events.length === BATCH ? 0 : interval;
    for (const event of events) {
      if (stopped) return;
      if (
        !/^[1-9][0-9]*$/.test(event.sequence) ||
        BigInt(event.sequence) <= BigInt(sequence) ||
        !Array.isArray(event.pageIds) ||
        event.pageIds.some(
          (id) => typeof id !== "string" || !id || id.length > 256,
        )
      )
        throw Error("Invalid invalidation event");
      for (const page of new Set(event.pageIds)) {
        if (stopped) return;
        await options.changed(page);
      }
      sequence = event.sequence;
    }
  }
  function poll() {
    if (stopped) return Promise.resolve();
    if (running) return running;
    running = run().finally(() => {
      running = undefined;
    });
    return running;
  }
  function schedule(ms: number) {
    if (stopped) return;
    cancel = clock.after(ms, () => {
      cancel = undefined;
      void poll().then(
        () => schedule(nextDelay),
        (error) => {
          try {
            options.onError?.(error);
          } catch {}
          schedule(interval);
        },
      );
    });
  }
  if (options.autoStart !== false) schedule(0);
  return {
    get sequence() {
      return sequence;
    },
    poll,
    async close() {
      stopped = true;
      cancel?.();
      cancel = undefined;
      await running?.catch(() => {});
    },
  };
}
