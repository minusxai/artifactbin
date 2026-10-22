import type {
  AuthorEffectLifetime,
  AuthorLifetimeClock,
  AuthorListener,
} from "./lifecycle-contracts.ts";

/** Owns admitted effects. This is lifetime management, not a JavaScript sandbox. */
export function createAuthorEffectLifetime(
  clock: AuthorLifetimeClock,
  runOwned: (callback: () => void) => void = (callback) => callback(),
): AuthorEffectLifetime {
  let active = true;
  type Registration = {
    target: EventTarget;
    type: string;
    listener: AuthorListener;
    capture: boolean;
    wrapped: EventListener;
    abort?: () => void;
    signal?: AbortSignal;
  };
  const listeners = new Set<Registration>(),
    timers = new Map<number, "timeout" | "interval">(),
    frames = new Set<number>(),
    cleanups: (() => void)[] = [];
  const requireActive = () => {
    if (!active) throw new Error("Author effect lifetime is disposed");
  };
  const capture = (options?: boolean | EventListenerOptions) =>
    typeof options === "boolean" ? options : (options?.capture ?? false);
  const remove = (r: Registration) => {
    listeners.delete(r);
    r.target.removeEventListener(r.type, r.wrapped, r.capture);
    if (r.abort) r.signal?.removeEventListener("abort", r.abort);
  };
  const callback = (fn: unknown): void => {
    if (typeof fn !== "function")
      throw new Error("Author callback must be a function");
  };
  const delay = (value: number | undefined) => {
    if (
      value !== undefined &&
      (!Number.isFinite(value) || value < 0 || value > 2_147_483_647)
    )
      throw new Error("Invalid author timer delay");
    return value ?? 0;
  };
  const schedule = (
    kind: "timeout" | "interval",
    fn: (...args: unknown[]) => void,
    ms: number | undefined,
    args: unknown[],
  ) => {
    requireActive();
    callback(fn);
    if (timers.size + frames.size >= 10_000)
      throw new Error("Author effect resource limit");
    let id: number;
    const invoke = () => {
      if (!active || !timers.has(id)) return;
      if (kind === "timeout") timers.delete(id);
      runOwned(() => fn(...args));
    };
    id = clock[kind](invoke, delay(ms));
    timers.set(id, kind);
    return id;
  };
  return {
    get active() {
      return active;
    },
    listen(target, type, listener, options) {
      requireActive();
      if (
        !(target instanceof EventTarget) ||
        typeof type !== "string" ||
        !type ||
        !(
          typeof listener === "function" ||
          (listener && typeof listener.handleEvent === "function")
        )
      )
        throw new Error("Invalid author event registration");
      if (
        options &&
        typeof options === "object" &&
        Object.keys(options).some(
          (key) => !["capture", "once", "passive", "signal"].includes(key),
        )
      )
        throw new Error("Unsupported author listener options");
      const cap = capture(options);
      if (listeners.size >= 10_000)
        throw new Error("Author effect resource limit");
      if (
        [...listeners].some(
          (r) =>
            r.target === target &&
            r.type === type &&
            r.listener === listener &&
            r.capture === cap,
        )
      )
        return;
      const opts =
        typeof options === "object" && options !== null
          ? {
              once: Boolean(options.once),
              passive: Boolean(options.passive),
              signal: options.signal,
            }
          : undefined;
      if (opts?.signal?.aborted) return;
      const r: Registration = {
        target,
        type,
        listener,
        capture: cap,
        wrapped: () => {},
        signal: opts?.signal,
      };
      r.wrapped = function (event) {
        if (!active || !listeners.has(r)) return;
        if (opts?.once) remove(r);
        runOwned(() => {
          if (typeof listener === "function") listener.call(target, event);
          else listener.handleEvent(event);
        });
      };
      listeners.add(r);
      try {
        target.addEventListener(type, r.wrapped, {
          capture: cap,
          passive: opts?.passive,
        });
        if (opts?.signal) {
          r.abort = () => remove(r);
          opts.signal.addEventListener("abort", r.abort, { once: true });
        }
      } catch (error) {
        remove(r);
        throw error;
      }
    },
    unlisten(target, type, listener, options) {
      for (const r of listeners)
        if (
          r.target === target &&
          r.type === type &&
          r.listener === listener &&
          r.capture === capture(options)
        )
          remove(r);
    },
    timeout(fn, ms, ...args) {
      return schedule("timeout", fn, ms, args);
    },
    interval(fn, ms, ...args) {
      return schedule("interval", fn, ms, args);
    },
    frame(fn) {
      requireActive();
      callback(fn);
      if (timers.size + frames.size >= 10_000)
        throw new Error("Author effect resource limit");
      let id: number;
      id = clock.frame((time) => {
        if (!active || !frames.delete(id)) return;
        runOwned(() => fn(time));
      });
      frames.add(id);
      return id;
    },
    clearTimer(id) {
      const kind = timers.get(id);
      if (!kind) return;
      timers.delete(id);
      if (kind === "timeout") clock.clearTimeout(id);
      else clock.clearInterval(id);
    },
    cancelFrame(id) {
      if (frames.delete(id)) clock.cancelFrame(id);
    },
    own(dispose) {
      requireActive();
      callback(dispose);
      if (cleanups.length >= 10_000)
        throw new Error("Author effect resource limit");
      cleanups.push(dispose);
    },
    dispose() {
      if (!active) return;
      active = false;
      const errors: unknown[] = [];
      const drain = (fn: () => void) => {
        try {
          fn();
        } catch (error) {
          errors.push(error);
        }
      };
      for (const r of [...listeners]) drain(() => remove(r));
      for (const [id, kind] of timers)
        drain(() =>
          kind === "timeout" ? clock.clearTimeout(id) : clock.clearInterval(id),
        );
      timers.clear();
      for (const id of frames) drain(() => clock.cancelFrame(id));
      frames.clear();
      for (const fn of cleanups.splice(0).reverse()) drain(fn);
      if (errors.length)
        throw new AggregateError(errors, "Author effect cleanup failed");
    },
  };
}
