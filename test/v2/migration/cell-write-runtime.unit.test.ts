import { test } from "node:test";
import assert from "node:assert/strict";
import { parse } from "graphql";
import { createCompiledDatasetMutations } from "../../../src/migration/conversion/compiled/dataset-mutations.ts";
import type {
  CompiledDatasetMutationOptions,
  CompiledMutationIntent,
} from "../../../src/migration/conversion/compiled/dataset-mutations-contracts.ts";
const committed = {
  data: {
    legacyData: {
      mutate: { affected: 1, rowCount: 2, version: 3, generation: 4 },
    },
  },
  extensions: { outcomes: { "legacyData.mutate": "committed" as const } },
};
function fixture() {
  let context: string | null = "current-reader",
    saved: Record<string, CompiledMutationIntent> = {},
    lost = false;
  const calls: any[] = [];
  const options: CompiledDatasetMutationOptions = {
    bindings: [
      {
        name: "save",
        backendNamespace: "legacyData",
        recoveryScope: "a".repeat(64),
        paramTypes: { note: "string" },
        rowParams: { id: { param: "row__id", type: "string" } },
        valueParam: { param: "cell__value", type: "number" },
      },
    ],
    documents: { legacyData: parse("mutation{legacyData{mutate}}") },
    client: {
      mutate: async (input: any) => {
        calls.push(structuredClone(input.variables));
        if (lost) throw Error("lost");
        return committed as any;
      },
    },
    intentStore: {
      read: () => saved,
      compareAndSet: async (name, expected, next) => {
        if ((saved[name]?.requestId ?? null) !== expected) return false;
        if (next) saved = { ...saved, [name]: structuredClone(next) };
        else {
          saved = { ...saved };
          delete saved[name];
        }
        return true;
      },
    },
    authorizationContext: () => context,
    requestId: () => "request-000000000001",
    values: () => ({ note: "snapshot note" }),
    reset() {},
    committed() {},
  };
  return {
    mount: () => createCompiledDatasetMutations(options),
    calls,
    options,
    saved: () => saved,
    context: (v: string | null) => {
      context = v;
    },
    lose: (v: boolean) => {
      lost = v;
    },
  };
}
test("editing value is typed and snapshotted separately from ordinary arguments and the row", async () => {
  const f = fixture(),
    adapter = f.mount();
  const row = { id: "row-a" };
  await adapter.mutate("save", { _value: 2 }, row);
  assert.deepEqual(f.calls[0].params, {
    note: "snapshot note",
    row__id: "row-a",
    cell__value: 2,
  });
  await assert.rejects(
    adapter.mutate("save", { _value: 2, cell__value: 99 }, row),
  );
  await assert.rejects(adapter.mutate("save", {}, row));
  await assert.rejects(adapter.mutate("save", { _value: "2" }, row));
  assert.equal(f.calls.length, 1);
  const empty = fixture();
  await empty.mount().mutate("save", { _value: "" }, row);
  assert.equal(empty.calls[0].params.cell__value, null);
});
test("unknown cell save restores immutable value and row for reconciliation without newer-draft replay", async () => {
  const f = fixture();
  f.lose(true);
  const first = f.mount(),
    row = { id: "row-a" };
  await assert.rejects(first.mutate("save", { _value: 2 }, row), /unknown/);
  row.id = "row-b";
  const original = structuredClone(f.calls[0]);
  assert.equal(f.saved().save?.params.cell__value, 2);
  const restored = f.mount();
  assert.equal(f.calls.length, 1);
  await assert.rejects(restored.mutate("save", { _value: 8 }, row), /unknown/);
  assert.equal(f.calls.length, 1);
  f.context(null);
  await assert.rejects(restored.retry("save"));
  assert.equal(f.calls.length, 1);
  assert(f.saved().save);
  f.context("current-reader");
  f.lose(false);
  await restored.retry("save");
  assert.deepEqual(f.calls[1], original);
  assert.deepEqual(f.saved(), {});
});
test("invalid generated cell mappings fail admission rather than becoming ordinary caller slots", () => {
  for (const descriptor of [
    { param: "note", type: "number" },
    { param: "cell__value", type: null },
    { param: "cell__value", type: "object" },
  ]) {
    const f = fixture();
    (f.options.bindings[0] as any).valueParam = descriptor;
    assert.throws(() => f.mount());
  }
});
