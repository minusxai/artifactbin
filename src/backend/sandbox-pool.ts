import { createHash } from "node:crypto";
import { BackendHostError } from "./contracts.ts";
import { backendClock } from "./work.ts";
import type {
  SandboxPool,
  SandboxPoolOptions,
  SandboxLease,
  SandboxIdentity,
} from "./runtime-contracts.ts";
/** Hash secret values without retaining them in the pool's lookup key. */
export function sandboxIdentityKey(identity: SandboxIdentity): string {
  return createHash("sha256")
    .update(
      JSON.stringify([
        identity.owner,
        identity.fileId,
        identity.version,
        identity.bundleHash,
        identity.imageId,
        identity.duplex,
        Object.entries(identity.env).sort(([a], [b]) =>
          a < b ? -1 : a > b ? 1 : 0,
        ),
      ]),
    )
    .digest("hex");
}
/** Exclusive resource leases and their complete retirement barrier, independent of Docker. */
export function createSandboxPool<T>({
  max,
  idleMs,
  healthy,
  dispose,
  clock = backendClock,
}: SandboxPoolOptions<T>): SandboxPool<T> {
  if (
    !Number.isSafeInteger(max) ||
    max < 1 ||
    !Number.isSafeInteger(idleMs) ||
    idleMs < 1
  )
    throw Error("Invalid pool limits");
  interface Entry {
    value: T;
    key: string | null;
    busy: boolean;
    invalid: boolean;
    used: number;
    cancel?: () => void;
    disposal?: Promise<boolean>;
  }
  const entries = new Set<Entry>(),
    retiring = new Set<Promise<boolean>>(),
    creations = new Set<Promise<unknown>>(),
    leases = new Set<Promise<void>>();
  let reserved = 0,
    closed = false,
    failed = false,
    closing: Promise<void> | undefined;
  function retire(entry: Entry): Promise<boolean> {
    entry.invalid = true;
    entry.cancel?.();
    if (!entry.disposal) {
      entry.disposal = Promise.resolve()
        .then(() => dispose(entry.value))
        .catch(() => false)
        .then((clean) => {
          if (!clean) failed = true;
          if (!entry.busy) entries.delete(entry);
          return clean;
        });
      retiring.add(entry.disposal);
      void entry.disposal.finally(() => retiring.delete(entry.disposal!));
    }
    return entry.disposal;
  }
  /** The first in-flight retirement to finish, or `cancelled` when `signal` aborts first. */
  function untilRetired(signal?: AbortSignal): Promise<boolean> {
    return new Promise<boolean>((resolve, reject) => {
      const abort = () => reject(new BackendHostError("cancelled"));
      signal?.addEventListener("abort", abort, { once: true });
      void Promise.race(retiring).then((clean) => {
        signal?.removeEventListener("abort", abort);
        resolve(clean);
      });
    });
  }
  function lease(entry: Entry): SandboxLease<T> {
    entry.busy = true;
    entry.cancel?.();
    let settle!: () => void;
    const done = new Promise<void>((resolve) => {
      settle = resolve;
    });
    leases.add(done);
    let released: Promise<boolean> | undefined;
    return {
      value: entry.value,
      release(reusable) {
        if (released) return released;
        released = (async () => {
          entry.busy = false;
          if (
            !reusable ||
            entry.key === null ||
            closed ||
            entry.invalid ||
            !healthy(entry.value)
          ) {
            const clean = await retire(entry);
            entries.delete(entry);
            return clean;
          }
          entry.used = clock.now();
          entry.cancel = clock.after(idleMs, () => {
            void retire(entry);
          });
          return true;
        })().finally(() => {
          leases.delete(done);
          settle();
        });
        return released;
      },
    };
  }
  return {
    acquire(key, create, signal) {
      if (closed)
        return Promise.reject(new BackendHostError("backend_unavailable"));
      if (signal?.aborted)
        return Promise.reject(new BackendHostError("cancelled"));
      for (const entry of entries)
        if (
          key !== null &&
          entry.key === key &&
          !entry.busy &&
          !entry.invalid &&
          healthy(entry.value)
        )
          return Promise.resolve(lease(entry));
      // Reserve before yielding: concurrent creates cannot exceed the resource budget.
      if (entries.size + reserved >= max) {
        const oldest = [...entries]
          .filter((e) => !e.busy && !e.invalid)
          .sort((a, b) => a.used - b.used)[0];
        if (!oldest) {
          // Capacity held only by retirements already in flight frees up when they finish:
          // wait for one rather than refuse a call that a moment later would fit.
          if (!retiring.size)
            return Promise.reject(new BackendHostError("backend_busy"));
          return untilRetired(signal).then((clean) => {
            if (!clean) throw new BackendHostError("cleanup_failed");
            return this.acquire(key, create, signal);
          });
        }
        oldest.invalid = true;
        const evicted = retire(oldest);
        // The evicted resource occupies capacity until its removal is proven.
        return evicted.then((clean) => {
          if (!clean) throw new BackendHostError("cleanup_failed");
          return this.acquire(key, create, signal);
        });
      }
      reserved++;
      const pending = Promise.resolve()
        .then(async () => {
          if (closed || signal?.aborted)
            throw new BackendHostError(
              signal?.aborted ? "cancelled" : "backend_unavailable",
            );
          const value = await create();
          const entry: Entry = {
            value,
            key,
            busy: false,
            invalid: false,
            used: clock.now(),
          };
          entries.add(entry);
          if (closed || signal?.aborted || !healthy(value)) {
            const clean = await retire(entry);
            if (!clean) throw new BackendHostError("cleanup_failed");
            throw new BackendHostError(
              signal?.aborted ? "cancelled" : "backend_unavailable",
            );
          }
          return lease(entry);
        })
        .finally(() => {
          reserved--;
          creations.delete(pending);
        });
      creations.add(pending);
      return pending;
    },
    retire(value) {
      const entry = [...entries].find((e) => e.value === value);
      return entry ? retire(entry) : Promise.resolve(true);
    },
    recovered() {
      failed = false;
    },
    close() {
      if (closing) return closing;
      closed = true;
      for (const entry of entries) if (!entry.busy) void retire(entry);
      closing = Promise.allSettled([...creations, ...leases, ...retiring]).then(
        () => {
          if (failed) throw new BackendHostError("cleanup_failed");
        },
      );
      return closing;
    },
  };
}
