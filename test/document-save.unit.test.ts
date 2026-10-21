import { test } from "node:test";
import assert from "node:assert/strict";
import { createDocumentSave } from "../src/browser/document-save.ts";
import type { SaveClock } from "../src/browser/document-save-contracts.ts";
const deferred = <T>() => {
  let resolve!: (value: T) => void, reject!: (error: Error) => void;
  const promise = new Promise<T>((a, b) => {
    resolve = a;
    reject = b;
  });
  return { promise, resolve, reject };
};
function clock() {
  let next = 0;
  const pending = new Map<number, () => void>();
  return {
    pending,
    clock: {
      set(fn) {
        const id = ++next;
        pending.set(id, fn);
        return id;
      },
      clear(id) {
        pending.delete(id as number);
      },
    } satisfies SaveClock,
    run() {
      const callbacks = [...pending.values()];
      pending.clear();
      callbacks.forEach((fn) => fn());
    },
  };
}
const flush = async () => {
  for (let i = 0; i < 8; i++) await Promise.resolve();
};
test("write snapshots are cloned; same-flight callers coalesce and only acknowledged version clears dirty", async () => {
  const tick = clock();
  let state = { count: 1 };
  const writes: any[] = [];
  const done = deferred<{ etag: string }>();
  const saver = createDocumentSave({
    capture: () => state,
    download() {},
    clock: tick.clock,
    etag: "old",
    write: async (request) => {
      writes.push(request);
      return done.promise;
    },
  });
  saver.touch();
  const a = saver.save(),
    b = saver.save();
  assert.equal(a, b);
  await flush();
  state.count = 2;
  saver.touch();
  assert.equal(writes[0].snapshot.count, 1);
  assert.equal(writes[0].etag, "old");
  done.resolve({ etag: "new" });
  assert.equal(await a, "written");
  assert.equal(saver.status.dirty, true);
  assert.equal(saver.status.etag, "new");
  assert.equal(tick.pending.size, 1);
});
test("autosave debounces; acknowledged current version cleans and no duplicate write starts", async () => {
  const tick = clock();
  let writes = 0;
  const saver = createDocumentSave({
    capture: () => ({}),
    download() {},
    clock: tick.clock,
    write: async () => {
      writes++;
      return { etag: "saved" };
    },
  });
  saver.touch();
  saver.touch();
  assert.equal(tick.pending.size, 1);
  tick.run();
  await flush();
  assert.equal(writes, 1);
  assert.equal(saver.status.dirty, false);
  assert.equal(tick.pending.size, 0);
});
test("download started never claims written or clears dirty; download failures propagate", async () => {
  let captured: any;
  const saver = createDocumentSave({
    capture: () => ({ count: 3 }),
    download: (s) => {
      captured = s;
    },
  });
  saver.touch();
  assert.equal(await saver.save(), "download-started");
  assert.equal(captured.count, 3);
  assert.equal(saver.status.dirty, true);
  const bad = createDocumentSave({
    capture: () => ({}),
    download() {
      throw Error("blocked");
    },
  });
  await assert.rejects(bad.save(), /blocked/);
});
test("write failure preserves etag/dirty and reports scheduled failure without retry loop", async () => {
  const tick = clock();
  const errors: Error[] = [];
  const saver = createDocumentSave({
    capture: () => ({}),
    download() {},
    etag: "old",
    clock: tick.clock,
    onError: (e) => errors.push(e),
    write: async () => {
      throw Error("disk full");
    },
  });
  saver.touch();
  tick.run();
  await flush();
  assert.equal(errors.length, 1);
  assert.equal(saver.status.dirty, true);
  assert.equal(saver.status.etag, "old");
  assert.equal(tick.pending.size, 0);
  await assert.rejects(saver.save(), /disk full/);
});
test("suspend aborts pending write; stale success cannot clear dirty or advance etag", async () => {
  const tick = clock();
  const done = deferred<{ etag: string }>();
  let signal: AbortSignal | undefined;
  const saver = createDocumentSave({
    capture: () => ({}),
    download() {},
    clock: tick.clock,
    etag: "old",
    write: async (r) => {
      signal = r.signal;
      return done.promise;
    },
  });
  saver.touch();
  const pending = saver.save();
  await flush();
  saver.suspend();
  await assert.rejects(pending, /suspended/);
  assert.equal(signal?.aborted, true);
  done.resolve({ etag: "stale" });
  await flush();
  assert.equal(saver.status.etag, "old");
  assert.equal(saver.status.dirty, true);
  assert.equal(tick.pending.size, 0);
  await assert.rejects(saver.save(), /suspended/);
  saver.resume();
  assert.equal(tick.pending.size, 1);
});
test("dispose cancels timer and pending work, blocks touches/saves and emits no late callbacks", async () => {
  const tick = clock();
  let changes = 0;
  const done = deferred<{ etag: string }>();
  const saver = createDocumentSave({
    capture: () => ({}),
    download() {},
    clock: tick.clock,
    onChange: () => changes++,
    write: async () => done.promise,
  });
  saver.touch();
  const p = saver.save();
  await flush();
  saver.dispose();
  await assert.rejects(p, /disposed/);
  const before = changes;
  done.resolve({ etag: "late" });
  await flush();
  assert.equal(changes, before);
  assert.equal(tick.pending.size, 0);
  assert.throws(() => saver.touch(), /disposed/);
  await assert.rejects(saver.save(), /disposed/);
});
test("save captures state at invocation rather than a later microtask", async () => {
  const state = { n: 1 };
  let written: any;
  const saver = createDocumentSave({
    capture: () => state,
    download() {},
    write: async (r) => {
      written = r.snapshot;
      return { etag: "x" };
    },
  });
  saver.touch();
  const pending = saver.save();
  state.n = 2;
  saver.touch();
  await pending;
  assert.equal(written.n, 1);
  saver.dispose();
});
test("immediate resume after abort still schedules pending dirty state", async () => {
  const tick = clock();
  const first = deferred<{ etag: string }>();
  let calls = 0;
  const saver = createDocumentSave({
    capture: () => ({}),
    download() {},
    clock: tick.clock,
    write: async () => (++calls === 1 ? first.promise : { etag: "new" }),
  });
  saver.touch();
  const p = saver.save();
  await flush();
  saver.suspend();
  saver.resume();
  await assert.rejects(p, /suspended/);
  assert.equal(tick.pending.size, 1);
  tick.run();
  await flush();
  assert.equal(calls, 2);
  assert.equal(saver.status.dirty, false);
  first.resolve({ etag: "old" });
  await flush();
  assert.equal(saver.status.etag, "new");
});
test("capture and invalid acknowledgement failures stay dirty without advancing ETag", async () => {
  const badCapture = createDocumentSave({
    capture: () => {
      throw Error("invalid state");
    },
    download() {},
  });
  badCapture.touch();
  await assert.rejects(badCapture.save(), /invalid state/);
  assert.equal(badCapture.status.dirty, true);
  const badReceipt = createDocumentSave({
    capture: () => ({}),
    etag: "original",
    download() {},
    write: async () => ({ etag: "" }),
  });
  badReceipt.touch();
  await assert.rejects(badReceipt.save(), /acknowledgement/);
  assert.equal(badReceipt.status.etag, "original");
  assert.equal(badReceipt.status.dirty, true);
});
test("disposing before dispatch prevents write and observer errors cannot lose acknowledgements", async () => {
  let writes = 0;
  const saver = createDocumentSave({
    capture: () => ({}),
    download() {},
    write: async () => {
      writes++;
      return { etag: "ok" };
    },
    onChange() {
      throw Error("UI failure");
    },
  });
  saver.touch();
  const p = saver.save();
  saver.dispose();
  await assert.rejects(p, /disposed/);
  assert.equal(writes, 0);
  const healthy = createDocumentSave({
    capture: () => ({}),
    download() {},
    write: async () => ({ etag: "ok" }),
    onChange() {
      throw Error("UI failure");
    },
  });
  healthy.touch();
  assert.equal(await healthy.save(), "written");
  assert.equal(healthy.status.dirty, false);
});
