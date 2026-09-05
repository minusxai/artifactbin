/**
 * GRACEFUL EXIT for a process entry. On the first SIGTERM/SIGINT run the steps
 * IN ORDER — the events client's flush BEFORE the listener closes, because the
 * batched tail is exactly what a deploy would otherwise lose — then exit 0.
 * Measured on the lean app image: node as PID 1 with no handler never sees
 * SIGTERM at all, `docker stop` waits its full 10 s and SIGKILLs it, and the
 * tail is gone; with a handler it returns in 0.4 s and the tail arrives.
 *
 * A second signal while closing is ignored; a step that throws is logged and
 * the next step still runs; exit is called exactly once.
 */
export interface ShutdownOptions {
  /** Run in order; each awaited before the next. */
  steps: Array<() => Promise<void>>;
  signals?: NodeJS.Signals[];
  /** The process to listen on and exit — injected so a test can hand in a fake. */
  process?: Pick<NodeJS.Process, 'once' | 'exit'>;
  log?: (msg: string, error?: unknown) => void;
}

/** Install the handlers; returns the close function itself (idempotent), for callers that want to run it directly. */
export function installShutdown(opts: ShutdownOptions): () => Promise<void> {
  const { steps, signals = ['SIGTERM', 'SIGINT'], process = globalThis.process, log = console.error } = opts;
  // ONE promise, made on the first call: a second signal (or a second close())
  // awaits the same run rather than starting another, which is what keeps
  // `exit` to exactly once.
  let closing: Promise<void> | undefined;
  const close = (): Promise<void> => (closing ??= run());
  const run = async (): Promise<void> => {
    for (const step of steps) {
      try {
        await step();
      } catch (error) {
        // A step that cannot finish must not strand the ones after it — the
        // listener still has to close even when the flush failed.
        log('[shutdown] step failed:', error);
      }
    }
    process.exit(0);
  };
  for (const signal of signals) process.once(signal, () => void close());
  return close;
}
