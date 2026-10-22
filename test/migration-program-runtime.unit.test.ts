import test from "node:test";
import assert from "node:assert/strict";
import { createProgramBindings } from "../src/migration/programs/runtime.ts";
import type { ProgramBindingTransport } from "../src/migration/programs/runtime-contracts.ts";
const manifest = {
  values: ["region"],
  queries: ["total"],
  mutations: ["insert"],
  defaults: { region: "initial" },
};
const deferred = <T>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
};
test("program startup waits for authorization and query.ready follows changed values", async () => {
  const auth = deferred<void>();
  const calls: string[] = [];
  const runtime = createProgramBindings(manifest, {
    authorize: () => auth.promise,
    query: async (_name, values) => {
      calls.push(String(values.region));
      return [{ region: values.region as string }];
    },
    mutate: async () => {},
  });
  const starting = runtime.start();
  await Promise.resolve();
  assert.deepEqual(calls, []);
  auth.resolve();
  await starting;
  const [region, setRegion] = runtime.bindings.signal("$region");
  const query = runtime.bindings.query("$total");
  assert.deepEqual(await query.ready, [{ region: "initial" }]);
  setRegion("next");
  assert.equal(region(), "next");
  assert.deepEqual(await query.ready, [{ region: "next" }]);
  await runtime.close();
  assert.throws(() => setRegion("late"), /disposed/);
});
test("program mutation keeps operation identity, never retries failure, and drains before close", async () => {
  const entered = deferred<void>(),
    finish = deferred<void>();
  const ids: string[] = [];
  const transport: ProgramBindingTransport = {
    authorize: async () => {},
    query: async () => [],
    mutate: async (_n, _a, _r, id) => {
      ids.push(id);
      entered.resolve();
      await finish.promise;
      throw Error("unknown");
    },
  };
  const runtime = createProgramBindings(manifest, transport);
  await runtime.start();
  const write = runtime.bindings.mutation("$insert")({ amount: 3 });
  const rejected = assert.rejects(write, /disposed|unknown/);
  await entered.promise;
  let closed = false;
  const closing = runtime.close().then(() => {
    closed = true;
  });
  await Promise.resolve();
  assert.equal(closed, false);
  finish.resolve();
  await closing;
  await rejected;
  assert.deepEqual(ids, ["operation-1"]);
  await runtime.close();
});
test("program state is isolated and stale query completion cannot replace latest generation", async () => {
  const old = deferred<Array<{ region: string }>>();
  const runtime = createProgramBindings(manifest, {
    authorize: async () => {},
    query: async (_n, v) =>
      v.region === "initial" ? old.promise : [{ region: String(v.region) }],
    mutate: async () => {},
  });
  await runtime.start();
  const query = runtime.bindings.query("$total");
  runtime.bindings.signal("$region")[1]("latest");
  assert.deepEqual(await query.ready, [{ region: "latest" }]);
  old.resolve([{ region: "stale" }]);
  await runtime.drain();
  assert.deepEqual(query(), [{ region: "latest" }]);
  await runtime.close();
  const second = createProgramBindings(manifest, {
    authorize: async () => {},
    query: async () => [],
    mutate: async () => {},
  });
  await second.start();
  assert.equal(second.bindings.signal("$region")[0](), "initial");
  await second.close();
});
