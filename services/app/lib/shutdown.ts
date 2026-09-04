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
  void opts;
  throw new Error('events-app: implement installShutdown');
}
