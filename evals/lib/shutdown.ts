/**
 * Shutting down is not part of the work, and must never be able to outlive it.
 *
 * A proxy's `close()` calls back only once every connection is gone, and one
 * that never goes away holds the process open forever. That is not a slow run,
 * it is a LOST one: CI cancels the job at its timeout and the upload step never
 * runs, so a leg that did all four tasks and scored them reports nothing. The
 * sockets belong to the OS the moment we exit; waiting on them buys nothing.
 */
export const TEARDOWN_MS = 5_000;

/** Wait for `work`, but never longer than `ms`, and never fail because teardown did. */
export function settleWithin<T>(work: Promise<T>, ms: number): Promise<T | undefined> {
  return new Promise<T | undefined>((resolve) => {
    const timer = setTimeout(() => resolve(undefined), ms);
    timer.unref?.();
    work.then(
      (v) => { clearTimeout(timer); resolve(v); },
      () => { clearTimeout(timer); resolve(undefined); },
    );
  });
}

/**
 * Exit with `code` once the work is done, whatever handles are still open.
 *
 * A stray socket must not turn a finished run into a cancelled job. The timer is
 * unref'd, so a clean process still exits by itself and immediately; only one
 * that would otherwise HANG is forced, and the grace period lets stdout flush.
 */
export function exitWhenDone(code: number, graceMs = TEARDOWN_MS): void {
  process.exitCode = code;
  const timer = setTimeout(() => process.exit(code), graceMs);
  timer.unref();
}
