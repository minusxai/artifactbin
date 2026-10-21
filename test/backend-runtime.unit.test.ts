import test from "node:test";
import assert from "node:assert/strict";
import type { BackendClock } from "../src/backend/runtime-contracts.ts";
import { createBackendWork } from "../src/backend/work.ts";
import {
  createSandboxPool,
  sandboxIdentityKey,
} from "../src/backend/sandbox-pool.ts";
function deferred<T = void>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}
function clock() {
  let now = 0;
  const timers = new Map<() => void, number>();
  return {
    now: () => now,
    after(ms: number, cb: () => void) {
      timers.set(cb, now + ms);
      return () => {
        timers.delete(cb);
      };
    },
    advance(ms: number) {
      now += ms;
      for (const [cb, at] of [...timers])
        if (at <= now) {
          timers.delete(cb);
          cb();
        }
    },
  } satisfies BackendClock & { advance(ms: number): void };
}
test("work reserves FIFO slots, cancellation removes waiters and timeouts release no foreign slot", async () => {
  const time = clock(),
    work = createBackendWork({ max: 1, waitMs: 10, clock: time });
  const first = await work.admit();
  const abort = new AbortController();
  const second = assert.rejects(work.admit(abort.signal), /cancelled/);
  let admitted = false;
  const third = work.admit().then((release) => {
    admitted = true;
    return release;
  });
  abort.abort();
  await second;
  assert.equal(admitted, false);
  first();
  first();
  const release = await third;
  const timed = assert.rejects(work.admit(), /backend_busy/);
  time.advance(10);
  await timed;
  release();
  const last = await work.admit();
  last();
  await work.close(async () => {});
});
test("close owns pre-admission work, cancels queued calls and waits operation and resource cleanup", async () => {
  const work = createBackendWork({ max: 1, waitMs: 10 });
  const entered = deferred(),
    cleanup = deferred(),
    resources = deferred();
  let signal!: AbortSignal;
  const pending = work.own(undefined, async (s) => {
    signal = s;
    entered.resolve();
    await cleanup.promise;
    throw Error("cancelled");
  });
  const failed = assert.rejects(pending, /cancelled/);
  await entered.promise;
  let closed = false;
  const closing = work
    .close(() => resources.promise)
    .then(() => {
      closed = true;
    });
  assert.equal(signal.aborted, true);
  assert.equal(work.closed, true);
  await assert.rejects(work.admit(), /backend_unavailable/);
  await assert.rejects(
    work.own(undefined, async () => 1),
    /backend_unavailable/,
  );
  cleanup.resolve();
  await failed;
  assert.equal(closed, false);
  resources.resolve();
  await closing;
});
test("pool reuses exclusively, reserves creation capacity and retires LRU with owned timers", async () => {
  const time = clock(),
    removed: number[] = [];
  let count = 0;
  const pool = createSandboxPool({
    max: 1,
    idleMs: 10,
    clock: time,
    healthy: () => true,
    dispose: async (v: { id: number }) => {
      removed.push(v.id);
      return true;
    },
  });
  const creation = deferred<{ id: number }>();
  const pending = pool.acquire("a", () => creation.promise);
  await assert.rejects(
    pool.acquire("b", async () => ({ id: ++count })),
    /backend_busy/,
  );
  creation.resolve({ id: ++count });
  const first = await pending;
  await first.release(true);
  await first.release(false);
  const again = await pool.acquire("a", async () => ({ id: ++count }));
  assert.equal(again.value.id, 1);
  await again.release(true);
  const other = await pool.acquire("b", async () => ({ id: ++count }));
  assert.equal(other.value.id, 2);
  await other.release(true);
  assert.deepEqual(removed, [1]);
  time.advance(10);
  await pool.close();
  assert.deepEqual(removed, [1, 2]);
});
test("pool close drains late creation and propagates failed disposal", async () => {
  const created = deferred<{ id: number }>(),
    disposed = deferred<boolean>();
  const pool = createSandboxPool({
    max: 1,
    idleMs: 10,
    healthy: () => true,
    dispose: () => disposed.promise,
  });
  const acquiring = assert.rejects(
    pool.acquire("a", () => created.promise),
    /cleanup_failed/,
  );
  await Promise.resolve();
  let closed = false;
  const closing = assert.rejects(pool.close(), /cleanup_failed/).then(() => {
    closed = true;
  });
  created.resolve({ id: 1 });
  await Promise.resolve();
  assert.equal(closed, false);
  disposed.resolve(false);
  await acquiring;
  await closing;
});
test("one-shot and unhealthy resources never return to reusable lookup; close waits busy release", async () => {
  let healthy = true;
  const removed: number[] = [];
  let count = 0;
  const pool = createSandboxPool({
    max: 2,
    idleMs: 10,
    healthy: () => healthy,
    dispose: async (v: { id: number }) => {
      removed.push(v.id);
      return true;
    },
  });
  const first = await pool.acquire(null, async () => ({ id: ++count }));
  await first.release(true);
  const busy = await pool.acquire("a", async () => ({ id: ++count }));
  healthy = false;
  await pool.retire(busy.value);
  let closed = false;
  const closing = pool.close().then(() => {
    closed = true;
  });
  await Promise.resolve();
  assert.equal(closed, false);
  await busy.release(true);
  await closing;
  assert.deepEqual(removed, [1, 2]);
});

test("close rejects queued admission and waits resources even after entrants finish", async () => {
  const work = createBackendWork({ max: 1, waitMs: 100 });
  const release = await work.admit();
  const queued = assert.rejects(work.admit(), /backend_unavailable/);
  const closing = work.close(async () => {});
  await queued;
  release();
  await closing;
});
test("same-key concurrent leases are exclusive; a rejected creation returns its reservation", async () => {
  let id = 0;
  const pool = createSandboxPool({
    max: 2,
    idleMs: 10,
    healthy: () => true,
    dispose: async () => true,
  });
  await assert.rejects(
    pool.acquire("bad", async () => {
      throw Error("create failed");
    }),
    /create failed/,
  );
  const a = await pool.acquire("key", async () => ({ id: ++id }));
  const b = await pool.acquire("key", async () => ({ id: ++id }));
  assert.notEqual(a.value, b.value);
  await a.release(true);
  await b.release(true);
  await pool.close();
});
test("abort during create disposes the late resource before rejecting the caller", async () => {
  const entered = deferred(),
    retiring = deferred(),
    created = deferred<object>(),
    disposed = deferred<boolean>();
  const abort = new AbortController();
  const pool = createSandboxPool({
    max: 1,
    idleMs: 10,
    healthy: () => true,
    dispose: () => {
      retiring.resolve();
      return disposed.promise;
    },
  });
  const rejected = assert.rejects(
    pool.acquire(
      "key",
      () => {
        entered.resolve();
        return created.promise;
      },
      abort.signal,
    ),
    /cancelled/,
  );
  await entered.promise;
  abort.abort();
  created.resolve({});
  let finished = false;
  void rejected.then(() => {
    finished = true;
  });
  await retiring.promise;
  assert.equal(finished, false);
  disposed.resolve(true);
  await rejected;
  await pool.close();
});

test("close awaits detached idle retirement and retains its failed removal verdict", async () => {
  const time = clock(),
    disposed = deferred<boolean>();
  const pool = createSandboxPool({
    max: 1,
    idleMs: 10,
    clock: time,
    healthy: () => true,
    dispose: () => disposed.promise,
  });
  const lease = await pool.acquire("key", async () => ({}));
  await lease.release(true);
  time.advance(10);
  let finished = false;
  const rejected = assert.rejects(pool.close(), /cleanup_failed/).then(() => {
    finished = true;
  });
  await Promise.resolve();
  assert.equal(finished, false);
  disposed.resolve(false);
  await rejected;
});

test("reentrant close shares one promise before abort listeners or resource callbacks run", async () => {
  const work = createBackendWork({ max: 1, waitMs: 10 });
  let barriers = 0,
    nested: Promise<void> | undefined;
  const closing = work.close(() => {
    barriers++;
    nested = work.close(async () => {
      barriers++;
    });
    return Promise.resolve();
  });
  assert.equal(nested, closing);
  await closing;
  assert.equal(barriers, 1);
});
test("shutdown verdict observes cleanup effects from the last entered operation", async () => {
  const work = createBackendWork({ max: 1, waitMs: 10 }),
    finish = deferred();
  let failedCleanup = false,
    cancelledResources = false;
  const call = work.own(undefined, async () => {
    await finish.promise;
    failedCleanup = true;
  });
  const closing = assert.rejects(
    work.close(
      async () => {
        cancelledResources = true;
      },
      () => {
        if (failedCleanup) throw Error("late cleanup failure");
      },
    ),
    /cleanup_failed/,
  );
  assert.equal(cancelledResources, true);
  finish.resolve();
  await call;
  await closing;
});
test("create callback reentrant close drains the resource it creates", async () => {
  let closing!: Promise<void>,
    removed = 0;
  const pool = createSandboxPool({
    max: 1,
    idleMs: 10,
    healthy: () => true,
    dispose: async (_v: number) => {
      removed++;
      return true;
    },
  });
  await assert.rejects(
    pool.acquire("a", async () => {
      closing = pool.close();
      return 1;
    }),
    /backend_unavailable/,
  );
  await closing;
  assert.equal(removed, 1);
});
test("recovery clears completed removal failure while later failures remain visible", async () => {
  const time = clock(),
    later = deferred<boolean>();
  let removals = 0;
  const pool = createSandboxPool({
    max: 2,
    idleMs: 10,
    clock: time,
    healthy: () => true,
    dispose: async (_v: number) => (++removals === 1 ? false : later.promise),
  });
  const first = await pool.acquire("a", async () => 1);
  assert.equal(await first.release(false), false);
  pool.recovered();
  const second = await pool.acquire("b", async () => 2);
  await second.release(true);
  time.advance(10);
  pool.recovered();
  const closing = assert.rejects(pool.close(), /cleanup_failed/);
  later.resolve(false);
  await closing;
});

test("warm identity partitions files, owners and executable inputs while stable secrets ignore order", () => {
  const base = {
    owner: "owner",
    fileId: "file",
    version: "v1",
    bundleHash: "bundle",
    imageId: "image",
    duplex: false,
    env: { A: "one", B: "two" },
  };
  const key = sandboxIdentityKey(base);
  assert.equal(
    sandboxIdentityKey({ ...base, env: { B: "two", A: "one" } }),
    key,
  );
  for (const change of [
    { owner: "other" },
    { fileId: "other" },
    { version: "v2" },
    { bundleHash: "other" },
    { imageId: "other" },
    { duplex: true },
    { env: { A: "rotated", B: "two" } },
  ])
    assert.notEqual(sandboxIdentityKey({ ...base, ...change }), key);
  assert.equal(key.includes("one"), false);
});

test("same-turn close or abort prevents dispatching resource creation", async () => {
  for (const aborting of [false, true]) {
    let dispatched = 0;
    const abort = new AbortController();
    const pool = createSandboxPool({
      max: 1,
      idleMs: 10,
      healthy: () => true,
      dispose: async (_v: number) => true,
    });
    const pending = assert.rejects(
      pool.acquire("a", async () => ++dispatched, abort.signal),
      aborting ? /cancelled/ : /backend_unavailable/,
    );
    if (aborting) abort.abort();
    else void pool.close();
    await pending;
    await pool.close();
    assert.equal(dispatched, 0);
  }
});
test("a clock that fires at once refuses that waiter alone and leaves the queue intact", async () => {
  let immediate = false;
  const time = clock();
  const work = createBackendWork({
    max: 1,
    waitMs: 10,
    clock: {
      now: time.now,
      after: (ms, cb) => (immediate ? (cb(), () => {}) : time.after(ms, cb)),
    },
  });
  const first = await work.admit();
  let queuedAdmitted = false;
  const queued = work.admit().then((release) => {
    queuedAdmitted = true;
    return release;
  });
  immediate = true;
  await assert.rejects(work.admit(), /backend_busy/);
  immediate = false;
  first();
  const release = await queued;
  assert.equal(queuedAdmitted, true);
  release();
  (await work.admit())();
  await work.close(async () => {});
});
test("a call at capacity held only by idle retirement waits for it instead of refusing", async () => {
  const time = clock(),
    disposal = deferred<boolean>();
  let count = 0;
  const pool = createSandboxPool({
    max: 1,
    idleMs: 10,
    clock: time,
    healthy: () => true,
    dispose: (_v: { id: number }) => disposal.promise,
  });
  const first = await pool.acquire("a", async () => ({ id: ++count }));
  await first.release(true);
  time.advance(10);
  let settled = false;
  const next = pool.acquire("b", async () => ({ id: ++count })).finally(() => {
    settled = true;
  });
  await new Promise<void>((r) => setImmediate(r));
  assert.equal(settled, false, "neither refused nor created past capacity");
  disposal.resolve(true);
  const lease = await next;
  assert.equal(lease.value.id, 2);
  await lease.release(false);
  const cancelled = new AbortController();
  const held = await pool.acquire("c", async () => ({ id: ++count }));
  await held.release(true);
  time.advance(10);
  const waiting = pool.acquire("d", async () => ({ id: ++count }), cancelled.signal);
  cancelled.abort();
  await assert.rejects(waiting, /cancelled/);
  await pool.close();
});
