import test from "node:test";
import assert from "node:assert/strict";
import { prepareLocalFlow } from "../src/migration/conversion/compiled/local-engine.ts";
const proof = {
  valueName: "assignee",
  sourceRef: "ref:Dataset001",
  version: 1,
  bindingName: "tasks",
  schema: "public",
  table: "rows" as const,
  column: "owner",
  type: "user" as const,
  constraints: { self: true, memberOf: ["ref:Scope001"] },
};
const binding = {
  name: "tasks",
  legacyRef: "ref:Dataset001",
  backendNamespace: "backend",
  backendHref: "/backend",
  mode: "live" as const,
  version: 1,
  tables: [
    {
      schema: "public",
      table: "rows",
      columns: [{ name: "owner", type: "user" }],
    },
  ],
};
const raw = {
  imports: [{ name: "tasks", ref: "Dataset001" }],
  queries: [{ name: "options" }],
  values: [
    {
      kind: "scalar",
      name: "assignee",
      type: "user",
      source: "Dataset001",
      column: "owner",
      default: null,
    },
  ],
};
const archive = async (path: string) => {
  assert.equal(path, "lib/dataflow/compile-dataflow.ts");
  return {
    prepareCompile: async (_: unknown, resolve: any) => ({
      source: await resolve("Dataset001"),
    }),
    compileDataflow: (_: unknown, ctx: any) => {
      assert.deepEqual(
        ctx.source.tables[0].columns[0].constraints,
        proof.constraints,
      );
      return {
        ok: true,
        compiled: {
          values: [{ ...raw.values[0], constraints: proof.constraints }],
          mutations: [],
          imports: [
            { name: "tasks", ref: "Dataset001", tables: ctx.source.tables },
          ],
          queries: [
            {
              name: "options",
              engine: "sqlite",
              reads: { builtins: [] },
              columns: [
                { name: "owner", type: "user", constraints: proof.constraints },
              ],
            },
          ],
        },
      };
    },
  };
};
test("offline bound compilation preserves inherited authority during compile and emits no private constraint metadata", async () => {
  const result = await prepareLocalFlow(
    archive,
    raw,
    [],
    { assignee: null },
    {},
    [binding],
    [proof],
  );
  assert.equal(result.flow.values[0].type, "user");
  assert.equal(result.flow.values[0].default, null);
  for (const key of ["constraints", "source", "column"])
    assert.equal(Object.hasOwn(result.flow.values[0], key), false);
  assert.equal(JSON.stringify(result.flow).includes("Scope001"), false);
  assert.deepEqual(result.results, { tables: {}, errors: {} });
});
test("offline bound compilation refuses absent, mismatched and duplicate proof authority", async () => {
  for (const proofs of [
    [],
    [{ ...proof, column: "other" }],
    [{ ...proof, bindingName: "other" }],
    [{ ...proof, version: 2 }],
    [proof, proof],
  ])
    await assert.rejects(
      prepareLocalFlow(
        archive,
        raw,
        [],
        { assignee: null },
        {},
        [binding],
        proofs,
      ),
    );
  await assert.rejects(
    prepareLocalFlow(
      archive,
      raw,
      [],
      { assignee: null },
      {},
      [
        {
          ...binding,
          tables: [
            {
              schema: "public",
              table: "rows",
              columns: [{ name: "owner", type: "string" }],
            },
          ],
        },
      ],
      [proof],
    ),
  );
});

import { publicBoundFlow } from "../src/migration/conversion/compiled/bound-flow.ts";
test("removing offline authority metadata preserves authored rows named like policy fields", () => {
  const table = {
    name: "local",
    kind: "table",
    rows: [
      {
        constraints: "authored value",
        source: "authored source",
        column: "authored column",
      },
    ],
    columns: [{ name: "constraints", type: "string" }],
  };
  const output = publicBoundFlow(
    { values: [table], imports: [], queries: [] },
    [proof],
  );
  assert.deepEqual(output.values, [table]);
});
