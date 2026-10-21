import { ConnectorError } from "./json.ts";
export function createLifetime(maxActive: number, timeoutMs: number) {
  const active = new Map<AbortController, () => void>();
  async function run<T>(
    signal: AbortSignal | undefined,
    fn: (signal: AbortSignal, dispatch: () => void) => Promise<T>,
  ): Promise<T> {
    if (active.size >= maxActive) throw new ConnectorError("UNAVAILABLE");
    const stop = new AbortController();
    let dispatched = false;
    const abort = () =>
      stop.abort(
        new ConnectorError(
          "CANCELLED",
          dispatched ? "unknown" : "not-executed",
        ),
      );
    active.set(stop, abort);
    if (signal?.aborted) abort();
    else signal?.addEventListener("abort", abort, { once: true });
    const timer = setTimeout(
      () =>
        stop.abort(
          new ConnectorError(
            "TIMEOUT",
            dispatched ? "unknown" : "not-executed",
          ),
        ),
      timeoutMs,
    );
    try {
      stop.signal.throwIfAborted();
      return await fn(stop.signal, () => {
        dispatched = true;
      });
    } catch (e) {
      if (stop.signal.aborted) throw stop.signal.reason;
      if (e instanceof ConnectorError)
        throw new ConnectorError(e.code, dispatched ? "unknown" : e.outcome);
      throw new ConnectorError(
        (e as { code?: string })?.code === "23505" ? "CONFLICT" : "UNAVAILABLE",
        dispatched ? "unknown" : "not-executed",
      );
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
      active.delete(stop);
    }
  }
  return {
    run,
    close() {
      for (const cancel of active.values()) cancel();
    },
  };
}
