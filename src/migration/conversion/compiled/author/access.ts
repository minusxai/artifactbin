import type { AuthorMutationOptions } from "./contracts.ts";
/** Await the first policy settlement in one caller generation; never retarget. */
export function awaitAuthorAccess(
  options: AuthorMutationOptions,
  signal?: AbortSignal,
): Promise<{ context: string; epoch: number | null }> {
  const access = options.access;
  if (!access) {
    const context = options.authorizationContext();
    return context && !signal?.aborted
      ? Promise.resolve({ context, epoch: null })
      : Promise.reject(Error("Author mutation context unavailable"));
  }
  return new Promise((resolve, reject) => {
    let stop: (() => void) | undefined,
      finished = false,
      epoch: number | null = null;
    const finish = (error?: Error, context?: string) => {
      if (finished) return;
      finished = true;
      stop?.();
      signal?.removeEventListener("abort", abort);
      if (error) reject(error);
      else resolve({ context: context!, epoch });
    };
    const abort = () => finish(Error("Author mount disposed"));
    const check = () => {
      if (signal?.aborted) {
        abort();
        return;
      }
      const current = access.read();
      if (epoch !== null && epoch !== current.epoch) {
        finish(Error("Author mutation caller changed"));
        return;
      }
      if (current.epoch !== null) epoch = current.epoch;
      if (current.state === "pending") return;
      if (current.state !== "allowed" || !current.context) {
        finish(Error("Author mutation access " + current.state));
        return;
      }
      finish(undefined, current.context);
    };
    signal?.addEventListener("abort", abort, { once: true });
    check();
    if (!finished) {
      stop = access.subscribe(check);
      if (finished) stop();
      else check();
    }
  });
}
