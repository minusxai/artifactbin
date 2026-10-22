import test from "node:test";
import assert from "node:assert/strict";
import { parse } from "graphql";
import { createCompiledDatasetMutations } from "../src/migration/conversion/compiled/dataset-mutations.ts";
import type { CompiledDatasetMutationOptions } from "../src/migration/conversion/compiled/dataset-mutations-contracts.ts";
function setup(replies: unknown[]) {
  const calls: any[] = [],
    resets: string[][] = [];
  let refreshes = 0,
    ids = 0;
  const options: CompiledDatasetMutationOptions = {
    bindings: [
      {
        name: "reserve",
        backendNamespace: "legacyData",
        paramTypes: { id: "number" },
        reset: ["id"],
      },
    ],
    documents: {
      legacyData: parse(
        "mutation Write($operation:String!,$requestId:String!,$params:DatasetParams!){legacyData{mutate(operation:$operation,requestId:$requestId,params:$params){affected rowCount version generation}}}",
      ),
    },
    client: {
      mutate: async (args: any) => {
        calls.push(args);
        const next = replies.shift();
        if (next instanceof Error) throw next;
        return next as any;
      },
    },
    requestId: () => `request-00000000-${++ids}`,
    values: () => ({ id: 7, privateOther: "not sent" }),
    reset: (names) => resets.push([...names]),
    committed: () => {
      refreshes++;
    },
  };
  return {
    adapter: createCompiledDatasetMutations(options),
    calls,
    resets,
    refreshes: () => refreshes,
  };
}
const result = { affected: 1, rowCount: 2, version: 3, generation: 4 };
const committed = {
  data: { legacyData: { mutate: result } },
  extensions: { outcomes: { "legacyData.mutate": "committed" } },
};
test("named mutation sends only registered scalar snapshot and resets/refetches after commit", async () => {
  const s = setup([committed]);
  assert.deepEqual(await s.adapter.mutate("reserve"), result);
  assert.deepEqual(s.calls[0].variables, {
    operation: "reserve",
    requestId: "request-00000000-1",
    params: { id: 7 },
  });
  assert.deepEqual(s.resets, [["id"]]);
  assert.equal(s.refreshes(), 1);
  assert.equal(s.adapter.status("reserve")?.state, "committed");
  assert.ok(!JSON.stringify(s.calls[0].variables).includes("sql"));
});
test("unknown response retains original id and argument snapshot for explicit reconciliation", async () => {
  const s = setup([new Error("transport"), committed]);
  await assert.rejects(s.adapter.mutate("reserve", { id: 9 }), /unknown/);
  assert.deepEqual(s.resets, []);
  assert.equal(s.refreshes(), 0);
  await assert.rejects(s.adapter.mutate("reserve", { id: 10 }), /unknown/);
  assert.equal(s.calls.length, 1);
  assert.deepEqual(await s.adapter.retry("reserve"), result);
  assert.deepEqual(s.calls[1].variables, s.calls[0].variables);
  assert.equal(s.refreshes(), 1);
});
test("denied/offline responses never reset, and invalid/client authority args never reach transport", async () => {
  for (const outcome of ["rejected", "offline"]) {
    const s = setup([
      {
        data: null,
        extensions: { outcomes: { "legacyData.mutate": outcome } },
      },
    ]);
    await assert.rejects(s.adapter.mutate("reserve"), new RegExp(outcome));
    assert.deepEqual(s.resets, []);
    assert.equal(s.refreshes(), 0);
  }
  const s = setup([]);
  for (const [name, args] of [
    ["unknown", {}],
    ["reserve", { id: "wrong" }],
    ["reserve", { id: 1, owner: "evil" }],
    ["reserve", { id: NaN }],
  ])
    await assert.rejects(s.adapter.mutate(name as string, args as any));
  assert.equal(s.calls.length, 0);
});
test("overlapping clicks share one pending attempt; malformed committed response remains unknown", async () => {
  let release!: (value: any) => void;
  const s = setup([]);
  // The injected client still uses the canonical mutate signature.
  const options: any = {
    bindings: [
      { name: "reserve", backendNamespace: "legacyData", paramTypes: {} },
    ],
    documents: { legacyData: s.calls },
    requestId: () => "same-000000000000",
    values: () => ({}),
    reset: () => {},
    committed: () => {},
    client: { mutate: () => new Promise((r) => (release = r)) },
  };
  const a = createCompiledDatasetMutations(options);
  const first = a.mutate("reserve"),
    second = a.mutate("reserve");
  assert.equal(a.pending(), true);
  release({
    data: { legacyData: { mutate: { affected: 1 } } },
    extensions: { outcomes: { "legacyData.mutate": "committed" } },
  });
  await assert.rejects(first, /unknown/);
  await assert.rejects(second, /unknown/);
  assert.equal(a.status("reserve")?.state, "unknown");
});

test("a delayed commit preserves viewer edits made after submission and refresh failure never changes confirmed outcome", async () => {
  let resolve!: (v: any) => void;
  let value = 7;
  const resets: string[][] = [];
  const s = setup([]);
  const adapter = createCompiledDatasetMutations({
    bindings: [
      {
        name: "reserve",
        backendNamespace: "legacyData",
        paramTypes: { id: "number" },
        reset: ["id"],
      },
    ],
    documents: { legacyData: parse("mutation{legacyData{mutate{affected}}}") },
    client: {
      mutate: async () => await new Promise<any>((r) => (resolve = r)),
    },
    requestId: () => "request-000000000",
    values: () => ({ id: value }),
    reset: (n) => resets.push([...n]),
    committed: () => {
      throw Error("refresh failed");
    },
  });
  const pending = adapter.mutate("reserve");
  value = 8;
  await assert.rejects(adapter.mutate("reserve"), /different arguments/);
  resolve(committed);
  assert.deepEqual(await pending, result);
  assert.deepEqual(resets, []);
  assert.equal(adapter.status("reserve")?.state, "committed");
});
