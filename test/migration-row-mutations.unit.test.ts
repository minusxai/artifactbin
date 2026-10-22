import test from "node:test";
import assert from "node:assert/strict";
import { parse } from "graphql";
import { createCompiledDatasetMutations } from "../src/migration/conversion/compiled/dataset-mutations.ts";
import type {
  CompiledDatasetMutationOptions,
  CompiledMutationIntent,
} from "../src/migration/conversion/compiled/dataset-mutations-contracts.ts";
function setup() {
  let saved: CompiledMutationIntent | null = null,
    context = "caller",
    scope = "a".repeat(64),
    ids = 0;
  const calls: any[] = [];
  const mount = () =>
    createCompiledDatasetMutations({
      bindings: [
        {
          name: "save",
          backendNamespace: "data",
          recoveryScope: scope,
          paramTypes: { label: "string" },
          rowParams: {
            id: { param: "row__id", type: "number" },
            mixed: { param: "row__mixed", type: null },
          },
        },
      ],
      documents: { data: parse("mutation{data{mutate}}") },
      client: {
        mutate: async (input) => {
          calls.push(input);
          throw Error("lost");
        },
      },
      requestId: () => `row-request-000000-${++ids}`,
      values: () => ({ label: "draft", id: 999 }),
      reset() {},
      committed() {},
      authorizationContext: () => context,
      intentStore: {
        read: () => (saved ? { save: structuredClone(saved) } : {}),
        compareAndSet: async (_name, expected, next) => {
          if ((saved?.requestId ?? null) !== expected) return false;
          saved = structuredClone(next);
          return true;
        },
      },
    } satisfies CompiledDatasetMutationOptions);
  return {
    mount,
    calls,
    saved: () => saved,
    scope: (s: string) => {
      scope = s;
    },
    context: (s: string) => {
      context = s;
    },
  };
}
test("full query row projects only whitelisted own scalars and durably reconciles the same snapshot after reload", async () => {
  const f = setup(),
    row: any = { id: 7, mixed: true, extra: { secret: "ignored" } };
  Object.defineProperty(row, "unread", {
    get() {
      throw Error("must not read extra");
    },
    enumerable: true,
  });
  await assert.rejects(f.mount().mutate("save", { label: "explicit" }, row));
  assert.equal(f.calls.length, 1);
  assert.deepEqual(f.calls[0].variables.params, {
    label: "explicit",
    row__id: 7,
    row__mixed: true,
  });
  assert.deepEqual(f.saved()?.params, {
    label: "explicit",
    row__id: 7,
    row__mixed: true,
  });
  assert.equal(JSON.stringify(f.saved()).includes("secret"), false);
  row.id = 8;
  row.mixed = "changed";
  const restored = f.mount();
  await assert.rejects(restored.retry("save"));
  assert.deepEqual(f.calls[1].variables, f.calls[0].variables);
  f.scope("b".repeat(64));
  await assert.rejects(f.mount().retry("save"));
  assert.equal(f.calls.length, 2);
});
test("missing, nonfinite, object, wrong typed and accessor required row fields never persist or dispatch", async () => {
  for (const row of [
    { mixed: 1 },
    { id: NaN, mixed: 1 },
    { id: 1, mixed: {} },
    { id: "1", mixed: 1 },
    Object.defineProperty({ mixed: 1 }, "id", {
      get() {
        throw Error("getter");
      },
      enumerable: true,
    }),
  ]) {
    const f = setup();
    await assert.rejects(f.mount().mutate("save", {}, row));
    assert.equal(f.calls.length, 0);
    assert.equal(f.saved(), null);
  }
});
test("null metadata accepts bounded JSON scalars instead of coercing them to strings", async () => {
  for (const mixed of [null, 1, true, "text"]) {
    const f = setup();
    await assert.rejects(f.mount().mutate("save", {}, { id: 1, mixed }));
    assert.equal(f.calls.length, 1);
    assert.equal(f.calls[0].variables.params.row__mixed, mixed);
  }
});
