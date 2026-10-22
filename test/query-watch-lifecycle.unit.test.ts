import test from "node:test";
import assert from "node:assert/strict";
import { createQueryWatch } from "../src/apollo/watch-query.ts";
import { createLocalStore } from "../src/apollo/client.ts";

function fixture() {
  const store = createLocalStore({ filter: "initial" });
  let acquired = 0,
    released = 0,
    stateStops = 0,
    remoteStops = 0;
  const listeners = new Set<() => void>();
  const watch = createQueryWatch<{ filter: string; shared: unknown }>({
    state: {
      ...store,
      subscribe(listener) {
        const stop = store.subscribe(listener);
        return () => {
          stateStops++;
          stop();
        };
      },
    },
    signature: (document) => String(document.filter),
    local: (document) => ({ filter: document.filter! }),
    empty: { shared: null },
    remote: {
      acquire() {
        acquired++;
        return () => {
          released++;
        };
      },
      subscribe(listener) {
        listeners.add(listener);
        return () => {
          remoteStops++;
          listeners.delete(listener);
        };
      },
      fetch: async () => ({ data: { shared: { count: 1 } } }),
    },
  });
  return {
    store,
    watch,
    listeners,
    counts: () => ({ acquired, released, stateStops, remoteStops }),
  };
}

test("local publication failure closes mixed watch once without interrupting other observers", async () => {
  const f = fixture();
  const failed = f.watch.subscribe((result) => {
    if (result.data.filter === "changed") throw Error("observer failed");
  });
  const observed: unknown[] = [];
  const other = f.watch.subscribe((result) =>
    observed.push(result.data.filter),
  );
  await Promise.resolve();
  await f.store.write({
    expected: { filter: "initial" },
    next: { filter: "changed" },
  });
  assert.equal(observed.at(-1), "changed");
  assert.deepEqual(f.counts(), {
    acquired: 2,
    released: 1,
    stateStops: 1,
    remoteStops: 1,
  });
  assert.equal(f.listeners.size, 1);
  failed.unsubscribe();
  assert.equal(f.counts().released, 1);
  other.unsubscribe();
  assert.deepEqual(f.counts(), {
    acquired: 2,
    released: 2,
    stateStops: 2,
    remoteStops: 2,
  });
});

test("initial observer failure propagates after draining both subscriptions and budget", () => {
  const f = fixture();
  assert.throws(
    () =>
      f.watch.subscribe(() => {
        throw Error("initial failed");
      }),
    /initial failed/,
  );
  assert.deepEqual(f.counts(), {
    acquired: 1,
    released: 1,
    stateStops: 1,
    remoteStops: 1,
  });
  assert.equal(f.listeners.size, 0);
});
