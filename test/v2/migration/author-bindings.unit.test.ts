import { test } from "node:test";
import assert from "node:assert/strict";
import { createAuthorBindings } from "../../../src/migration/conversion/compiled/author/bindings.ts";
import type {
  AuthorPorts,
  QuerySnapshot,
  ReactivePort,
} from "../../../src/migration/conversion/compiled/author/contracts.ts";
let identity: string | null = null;
const reactive: ReactivePort = {
  identity: () => identity,
  scope(id, render) {
    const previous = identity;
    identity = id;
    try {
      return render();
    } finally {
      identity = previous;
    }
  },
  signal<T>(v: T) {
    let value = v;
    return [
      () => value,
      (next: T | ((p: T) => T)) =>
        (value =
          typeof next === "function" ? (next as (p: T) => T)(value) : next),
    ];
  },
  untrack: (read) => read(),
};
function fixture() {
  const values = new Map();
  const listeners = new Set<() => void>();
  const queryListeners = new Set<() => void>();
  let snapshot: QuerySnapshot = { rows: [], loading: true, error: null };
  const ports: AuthorPorts = {
    state: {
      read: (k) => values.get(k),
      write(k, v) {
        values.set(k, v);
        for (const listener of listeners) listener();
      },
      subscribe(fn) {
        listeners.add(fn);
        return () => {
          listeners.delete(fn);
        };
      },
    },
    query: () => ({
      read: () => snapshot,
      subscribe(fn) {
        queryListeners.add(fn);
        return () => {
          queryListeners.delete(fn);
        };
      },
    }),
  };
  return {
    ports,
    values,
    listeners,
    queryListeners,
    settle(next: QuerySnapshot) {
      snapshot = next;
      for (const fn of queryListeners) fn();
    },
  };
}
test("declared and named state use functional setters and stable mount identities", () => {
  const f = fixture();
  f.values.set("value:count", 2);
  const b = createAuthorBindings(
    f.ports,
    { values: ["count"], queries: [], mutations: [] },
    reactive,
  );
  const [get, set] = b.signal("$count");
  assert.equal(
    set((v) => (v as number) + 1),
    3,
  );
  assert.equal(get(), 3);
  b.mount("first", () => {
    const [get, set] = b.createSignal(4, { name: "counter" });
    assert.equal(get(), 4);
    set((v) => v + 2);
  });
  b.mount("first", () =>
    assert.equal(b.createSignal(0, { name: "counter" })[0](), 6),
  );
  b.mount("second", () =>
    assert.equal(b.createSignal(0, { name: "counter" })[0](), 0),
  );
  assert.throws(() => b.signal("$missing"));
  b.dispose();
  assert.equal(f.listeners.size, 0);
  assert.throws(() => set(0));
});
test("query ready settles after loading, rejects errors and disposal, and unsubscribes", async () => {
  const f = fixture();
  const b = createAuthorBindings(
    f.ports,
    { values: [], queries: ["rows"], mutations: [] },
    reactive,
  );
  const q = b.query("$rows");
  const ready = q.ready;
  assert.equal(q.loading(), true);
  f.settle({ rows: [{ id: 1 }], loading: false, error: null });
  assert.deepEqual(await ready, [{ id: 1 }]);
  assert.deepEqual(q(), [{ id: 1 }]);
  f.settle({ rows: [], loading: false, error: "bad query" });
  await assert.rejects(q.ready, /bad query/);
  f.settle({ rows: [], loading: true, error: null });
  const pending = q.ready;
  b.dispose();
  await assert.rejects(pending, /disposed/);
  assert.equal(f.queryListeners.size, 0);
});

test("named signals preserve JSON arrays and objects and reject unpersistable values", () => {
  const f = fixture();
  const b = createAuthorBindings(
    f.ports,
    { values: [], queries: [], mutations: [] },
    reactive,
  );
  b.mount("list", () => {
    const [read, set] = b.createSignal([{ done: false }], { name: "items" });
    set((items) => items.map((item) => ({ ...item, done: true })));
    assert.deepEqual(read(), [{ done: true }]);
    assert.throws(() => b.createSignal(() => 0, { name: "function" }));
    assert.throws(() =>
      b.createSignal("x".repeat(256 * 1024), { name: "oversize" }),
    );
    assert.throws(
      () =>
        b.createSignal(
          Object.defineProperty({}, "bad", {
            get() {
              throw Error("getter must not execute");
            },
          }),
          { name: "accessor" },
        ),
      /accessor/,
    );
    assert.throws(() => b.createSignal(new Date(), { name: "date" }));
  });
  b.mount("list", () =>
    assert.deepEqual(b.createSignal([], { name: "items" })[0](), [
      { done: true },
    ]),
  );
  b.dispose();
});

test("persisted state is validated before any signal or subscription is created", () => {
  for (const [key, value] of [
    ["value:count", { bad: true }],
    ["author:" + JSON.stringify([null, "saved"]), "x".repeat(256 * 1024)],
    ["author:" + JSON.stringify([null, "saved"]), new Date()],
  ] as const) {
    const f = fixture();
    f.values.set(key, value);
    const b = createAuthorBindings(
      f.ports,
      { values: ["count"], queries: [], mutations: [] },
      reactive,
    );
    assert.throws(() =>
      key.startsWith("value:")
        ? b.signal("$count")
        : b.createSignal(0, { name: "saved" }),
    );
    assert.equal(f.listeners.size, 0);
    b.dispose();
  }
});
test("disposal drains throwing subscriptions and rejects every pending ready promise", async () => {
  const f = fixture();
  const subscribe = f.ports.state.subscribe;
  f.ports.state.subscribe = (fn) => {
    const stop = subscribe(fn);
    return () => {
      stop();
      throw Error("cleanup failed");
    };
  };
  const b = createAuthorBindings(
    f.ports,
    { values: ["count"], queries: ["rows"], mutations: [] },
    reactive,
  );
  b.signal("$count");
  const ready = b.query("$rows").ready;
  assert.throws(() => b.dispose(), AggregateError);
  await assert.rejects(ready, /disposed/);
  assert.equal(f.listeners.size, 0);
  assert.equal(f.queryListeners.size, 0);
});
