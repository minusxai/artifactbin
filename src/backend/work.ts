import { BackendHostError } from "./contracts.ts";
import type { BackendClock, BackendWork } from "./runtime-contracts.ts";
export const backendClock: BackendClock = {
  now: () => Date.now(),
  after(ms, callback) {
    const timer = setTimeout(callback, ms);
    timer.unref();
    return () => clearTimeout(timer);
  },
};
/** Owns call lifetime and admission; resources remain owned by their pool. */
export function createBackendWork({
  max,
  waitMs,
  clock = backendClock,
}: {
  max: number;
  waitMs: number;
  clock?: BackendClock;
}): BackendWork {
  if (
    !Number.isSafeInteger(max) ||
    max < 1 ||
    !Number.isSafeInteger(waitMs) ||
    waitMs < 0
  )
    throw Error("Invalid admission limits");
  let closed = false,
    active = 0,
    closing: Promise<void> | undefined;
  const entered = new Map<AbortController, Promise<void>>();
  const waiting: { grant(): void; reject(error: Error): void }[] = [];
  function release() {
    let released = false;
    return () => {
      if (released) return;
      released = true;
      active--;
      if (!closed) while (active < max && waiting.length) waiting[0]!.grant();
    };
  }
  return {
    get closed() {
      return closed;
    },
    own(signal, operation) {
      if (closed)
        return Promise.reject(new BackendHostError("backend_unavailable"));
      if (signal?.aborted)
        return Promise.reject(new BackendHostError("cancelled"));
      const controller = new AbortController();
      let settle!: () => void;
      entered.set(
        controller,
        new Promise<void>((resolve) => {
          settle = resolve;
        }),
      );
      const abort = () => controller.abort();
      signal?.addEventListener("abort", abort, { once: true });
      let result;
      try {
        result = operation(controller.signal);
      } catch (error) {
        result = Promise.reject(error);
      }
      return result.finally(() => {
        signal?.removeEventListener("abort", abort);
        entered.delete(controller);
        settle();
      });
    },
    admit(signal) {
      if (closed)
        return Promise.reject(new BackendHostError("backend_unavailable"));
      if (signal?.aborted)
        return Promise.reject(new BackendHostError("cancelled"));
      if (active < max && !waiting.length) {
        active++;
        return Promise.resolve(release());
      }
      return new Promise((resolve, reject) => {
        let settled = false,
          cancel: (() => void) | undefined;
        const leave = () => {
          if (settled) return false;
          settled = true;
          cancel?.();
          signal?.removeEventListener("abort", abort);
          const index = waiting.indexOf(waiter);
          if (index >= 0) waiting.splice(index, 1);
          return true;
        };
        const waiter = {
          grant() {
            if (leave()) {
              active++;
              resolve(release());
            }
          },
          reject(error: Error) {
            if (leave()) reject(error);
          },
        };
        const abort = () => waiter.reject(new BackendHostError("cancelled"));
        // Queued before any timer exists: a clock may fire its callback at once.
        waiting.push(waiter);
        signal?.addEventListener("abort", abort, { once: true });
        const timer = clock.after(waitMs, () =>
          waiter.reject(new BackendHostError("backend_busy")),
        );
        if (settled) timer();
        else cancel = timer;
      });
    },
    close(resources, verify) {
      if (closing) return closing;
      let resolveClose!: () => void, rejectClose!: (error: Error) => void;
      closing = new Promise<void>((resolve, reject) => {
        resolveClose = resolve;
        rejectClose = reject;
      });
      closed = true;
      for (const waiter of [...waiting])
        waiter.reject(new BackendHostError("backend_unavailable"));
      const pending = [...entered.values()];
      for (const controller of entered.keys()) controller.abort();
      let barrier;
      try {
        barrier = resources();
      } catch (error) {
        barrier = Promise.reject(error);
      }
      void Promise.allSettled([...pending, barrier]).then((results) => {
        if (results.some((r) => r.status === "rejected"))
          rejectClose(new BackendHostError("cleanup_failed"));
        else {
          try {
            verify?.();
            resolveClose();
          } catch {
            rejectClose(new BackendHostError("cleanup_failed"));
          }
        }
      });
      return closing;
    },
  };
}
