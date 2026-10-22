import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { createServiceLifecycle } from "../src/server/service-lifecycle.ts";
import type {
  ServiceLifecycleOptions,
  ServiceInvalidationFactory,
} from "../src/server/service-lifecycle-contracts.ts";
const deferred = () => {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => (resolve = done));
  return { promise, resolve };
};
function fixture() {
  const server = new EventEmitter(),
    calls: string[] = [],
    changed: string[] = [];
  const options: ServiceLifecycleOptions = {
    server,
    invalidationReaders: [
      () => ({ after: async () => [] }),
      () => ({ after: async () => [] }),
    ],
    live: {
      close: () => {
        calls.push("live");
      },
      changedAndWait: (id) => {
        changed.push(id);
      },
    },
    runners: {
      close: () => {
        calls.push("runners");
      },
    },
    backend: {
      close: () => {
        calls.push("backend");
      },
    },
    datasets: {
      close: () => {
        calls.push("datasets");
      },
    },
    repository: {
      close: () => {
        calls.push("repository");
      },
    },
  };
  let created = 0;
  const factory: ServiceInvalidationFactory = (consumer) => {
    const index = created++;
    void consumer.changed("page" + index);
    return {
      sequence: "0",
      poll: async () => {},
      close: async () => {
        calls.push("consumer" + index);
      },
    };
  };
  return { server, calls, changed, options, factory, created: () => created };
}
test("close before listening prevents consumer creation, including a synchronous late listening event", async () => {
  const f = fixture(),
    lifecycle = createServiceLifecycle(f.options, f.factory);
  assert.equal(f.created(), 0);
  const closing = lifecycle.close();
  f.server.emit("listening");
  await closing;
  assert.equal(f.created(), 0);
  assert.equal(f.server.listenerCount("listening"), 0);
  assert.deepEqual(f.calls, [
    "live",
    "runners",
    "backend",
    "datasets",
    "repository",
  ]);
});
test("listening starts consumers once and repeated close returns the same completion promise", async () => {
  const f = fixture(),
    lifecycle = createServiceLifecycle(f.options, f.factory);
  f.server.emit("listening");
  f.server.emit("listening");
  assert.equal(f.created(), 2);
  assert.deepEqual(f.changed, ["page0", "page1"]);
  const first = lifecycle.close(),
    second = lifecycle.close();
  assert.equal(first, second);
  await first;
  assert.equal(lifecycle.close(), first);
  assert.deepEqual(f.calls, [
    "live",
    "runners",
    "backend",
    "consumer0",
    "consumer1",
    "datasets",
    "repository",
  ]);
});
test("a throwing disposer cannot skip other cleanup and persistence waits for every owned operation", async () => {
  const f = fixture(),
    pending = deferred(),
    consumerPending = deferred(),
    failure = Error("live cleanup failed");
  f.options.live.close = () => {
    f.calls.push("live");
    throw failure;
  };
  f.options.runners.close = async () => {
    f.calls.push("runners");
    await pending.promise;
    f.calls.push("runners settled");
  };
  let index = 0;
  const lifecycle = createServiceLifecycle(f.options, () => {
    const id = index++;
    return {
      sequence: "0",
      poll: async () => {},
      close: () => {
        f.calls.push("consumer" + id);
        if (id === 0) throw Error("consumer failed");
        return consumerPending.promise;
      },
    };
  });
  f.server.emit("listening");
  const closing = lifecycle.close();
  await Promise.resolve();
  await Promise.resolve();
  assert.deepEqual(f.calls, [
    "live",
    "runners",
    "backend",
    "consumer0",
    "consumer1",
    "datasets",
  ]);
  pending.resolve();
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(f.calls.includes("repository"), false);
  consumerPending.resolve();
  await assert.rejects(closing, (error) => error === failure);
  assert.equal(f.calls.at(-1), "repository");
});
