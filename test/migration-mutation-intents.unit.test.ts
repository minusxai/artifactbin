import test from "node:test";
import assert from "node:assert/strict";
import { parse } from "graphql";
import { createCompiledDatasetMutations } from "../src/migration/conversion/compiled/dataset-mutations.ts";
import { compiledMutationIntentStore } from "../src/migration/conversion/compiled/dataset-mutation-intents.ts";
import { persistentStore } from "../src/browser/core/standalone.ts";
import { createClient, gql } from "../src/apollo/client.ts";
import type { CompiledDatasetMutationOptions } from "../src/migration/conversion/compiled/dataset-mutations-contracts.ts";
const result = { affected: 1, rowCount: 1, version: 2, generation: 2 };
const committed = {
  data: { data: { mutate: result } },
  extensions: { outcomes: { "data.mutate": "committed" as const } },
};
function setup() {
  const disk = new Map<string, string>();
  const storage = {
    getItem: (k: string) => disk.get(k) ?? null,
    setItem: (k: string, v: string) => {
      disk.set(k, v);
    },
  };
  let context: string | null = "opaque-caller-a",
    id = 0;
  const calls: any[] = [];
  function mount(
    scope = "a".repeat(64),
    transport: CompiledDatasetMutationOptions["client"] = {
      mutate: async (input) => {
        calls.push(input);
        throw Error("lost");
      },
    },
  ) {
    const state = persistentStore({}, "page", storage),
      client = createClient({ backends: [], state });
    const query = gql`
      {
        datasetMutationIntents
      }
    `;
    return createCompiledDatasetMutations({
      bindings: [
        {
          name: "save",
          recoveryScope: scope,
          backendNamespace: "data",
          paramTypes: { value: "number" },
          reset: ["value"],
        },
      ],
      documents: { data: parse("mutation{data{mutate}}") },
      client: transport,
      intentStore: compiledMutationIntentStore(client, query),
      authorizationContext: () => context,
      requestId: () => `request-000000000-${++id}`,
      values: () => ({ value: 7, secret: "do not persist" }),
      reset() {},
      committed() {},
    });
  }
  return {
    mount,
    calls,
    disk,
    setContext: (v: string | null) => {
      context = v;
    },
  };
}
test("unknown reload restores original request and args without auto-send; commit clears durable intent", async () => {
  const s = setup();
  const first = s.mount();
  await assert.rejects(first.mutate("save", { value: 9 }), /unknown/);
  const before = JSON.stringify(s.calls[0].variables);
  assert.ok(![...s.disk.values()].join().includes("do not persist"));
  const second = s.mount(undefined, {
    mutate: async (input) => {
      s.calls.push(input);
      return committed as any;
    },
  });
  assert.equal(second.status("save")?.state, "unknown");
  assert.equal(s.calls.length, 1);
  await assert.rejects(second.mutate("save", { value: 10 }), /unknown/);
  assert.equal(s.calls.length, 1);
  await second.retry("save");
  assert.equal(JSON.stringify(s.calls[1].variables), before);
  const third = s.mount();
  assert.equal(third.status("save"), null);
  assert.equal(s.calls.length, 2);
});
test("reconcile requires original verified caller and revision, retaining intent on mismatch", async () => {
  const s = setup();
  await assert.rejects(s.mount().mutate("save"), /unknown/);
  const restored = s.mount();
  for (const context of [null, "opaque-caller-b"]) {
    s.setContext(context);
    await assert.rejects(restored.retry("save"));
    assert.equal(s.calls.length, 1);
    assert.ok(s.disk.size);
  }
  s.setContext("opaque-caller-a");
  await assert.rejects(s.mount("b".repeat(64)).retry("save"));
  assert.equal(s.calls.length, 1);
  await assert.rejects(restored.retry("save"), /unknown/);
  assert.equal(s.calls.length, 2);
  assert.deepEqual(s.calls[1].variables, s.calls[0].variables);
});
test("another mounted adapter cannot blindly replace a pending durable operation", async () => {
  const s = setup(),
    a = s.mount(),
    b = s.mount();
  await assert.rejects(a.mutate("save"), /unknown/);
  await assert.rejects(b.mutate("save", { value: 10 }));
  assert.equal(s.calls.length, 1);
});

test("blocked durable storage prevents dispatch and a pending reload never invents a new operation", async () => {
  let calls = 0;
  let finish!: (reply: any) => void;
  const intents: Record<string, any> = {};
  const base: CompiledDatasetMutationOptions = {
    bindings: [
      {
        recoveryScope: "a".repeat(64),
        name: "save",
        backendNamespace: "data",
        paramTypes: { value: "number" },
      },
    ],
    documents: { data: parse("mutation{data{mutate}}") },
    client: {
      mutate: async () => {
        calls++;
        return new Promise((r) => {
          finish = r;
        });
      },
    },
    authorizationContext: () => "caller",
    requestId: () => "request-000000000-1",
    values: () => ({ value: 7 }),
    reset() {},
    committed() {},
  };
  const blocked = createCompiledDatasetMutations({
    ...base,
    intentStore: {
      read: () => ({}),
      compareAndSet: async () => {
        throw Error("Durability unavailable");
      },
    },
  });
  await assert.rejects(blocked.mutate("save"), /Durability/);
  assert.equal(calls, 0);
  const store = {
    read: () => JSON.parse(JSON.stringify(intents)),
    compareAndSet: async (name: string, expected: string | null, next: any) => {
      if ((intents[name]?.requestId ?? null) !== expected) return false;
      if (next) intents[name] = next;
      else delete intents[name];
      return true;
    },
  };
  const adapter = createCompiledDatasetMutations({
    ...base,
    intentStore: store,
  });
  const pending = adapter.mutate("save");
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(calls, 1);
  const reloaded = createCompiledDatasetMutations({
    ...base,
    intentStore: store,
  });
  assert.equal(reloaded.status("save")?.state, "unknown");
  assert.equal(calls, 1);
  await assert.rejects(reloaded.mutate("save"), /unknown/);
  finish(committed);
  await pending;
  assert.deepEqual(intents, {});
});
test("malformed or oversized saved recovery data fails closed", () => {
  const base = {
    bindings: [],
    documents: {},
    client: {
      mutate: async () => {
        throw Error();
      },
    },
    authorizationContext: () => "caller",
    requestId: () => "",
    values: () => ({}),
    reset() {},
    committed() {},
  };
  for (const read of [
    () => [],
    () => ({ save: { version: 1 } }),
    () => ({ ["x".repeat(140000)]: null }),
  ])
    assert.throws(
      () =>
        createCompiledDatasetMutations({
          ...base,
          intentStore: { read, compareAndSet: async () => true },
        }),
      /Invalid stored/,
    );
});

test("a committed write with a failed local clear is reconciled only with its original receipt after reload", async () => {
  const s = setup();
  const first = s.mount(undefined, {
    mutate: async (input) => {
      s.calls.push(input);
      return committed as any;
    },
  });
  // Make removal fail after the durable pre-dispatch intent save.
  const saved: Record<string, any> = {};
  let writes = 0;
  const options: CompiledDatasetMutationOptions = {
    bindings: [
      {
        recoveryScope: "a".repeat(64),
        name: "save",
        backendNamespace: "data",
        paramTypes: { value: "number" },
      },
    ],
    documents: { data: parse("mutation{data{mutate}}") },
    client: {
      mutate: async (input) => {
        s.calls.push(input);
        return committed as any;
      },
    },
    authorizationContext: () => "caller",
    requestId: () => "request-000000000-1",
    values: () => ({ value: 7 }),
    reset() {},
    committed() {},
    intentStore: {
      read: () => JSON.parse(JSON.stringify(saved)),
      compareAndSet: async (name, expected, next) => {
        writes++;
        if (!next && writes === 2) throw Error("quota");
        if ((saved[name]?.requestId ?? null) !== expected) return false;
        if (next) saved[name] = next;
        else delete saved[name];
        return true;
      },
    },
  };
  const adapter = createCompiledDatasetMutations(options);
  await adapter.mutate("save");
  assert.equal(adapter.status("save")?.state, "committed");
  assert.ok(saved.save);
  const reloaded = createCompiledDatasetMutations(options);
  assert.equal(reloaded.status("save")?.state, "unknown");
  await reloaded.retry("save");
  assert.deepEqual(s.calls[1].variables, s.calls[0].variables);
  assert.deepEqual(saved, {});
});
