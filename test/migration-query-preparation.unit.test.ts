import test from "node:test";
import assert from "node:assert/strict";
import { prepareMigrationQueryReceipt } from "../src/migration/query-preparation.ts";
import type { MigrationQueryCompilerOutput } from "../src/migration/query-preparation-contracts.ts";
const compiled = (): MigrationQueryCompilerOutput => ({
  module: {
    factorySource: "function(){return null}",
    sourceSha256: "a".repeat(64),
    references: {
      values: ["limit"],
      queries: ["first", "second"],
      mutations: [],
    },
  },
  flow: {
    values: [
      { name: "limit", kind: "scalar", type: "number", default: 2 },
      {
        name: "local",
        kind: "table",
        type: "table",
        default: null,
        columns: [{ name: "label", type: "string" }],
        rows: [{ label: "kept" }],
      },
    ],
    imports: [
      {
        name: "sales",
        ref: "Legacy1",
        tables: [
          { name: "rows", columns: [{ name: "label", type: "string" }] },
        ],
      },
    ],
    queries: [
      {
        name: "first",
        engine: "sqlite",
        sql: "select label from sales.rows limit $limit",
        reads: {
          queries: [],
          values: ["limit"],
          imports: ["sales"],
          builtins: [],
        },
      },
      {
        name: "second",
        engine: "sqlite",
        sql: "select * from first",
        reads: { queries: ["first"], values: [], imports: [], builtins: [] },
      },
    ],
    mutations: [],
  },
});
const bindings = [
  {
    name: "sales",
    legacyRef: "ref:Legacy1",
    backendNamespace: "legacyData",
    backendHref: "/af/v1/ids/Bk0001",
    version: 3,
    mode: "live" as const,
    tables: [
      {
        schema: "public",
        table: "rows",
        columns: [{ name: "label", type: "string" as const }],
      },
    ],
  },
];
const prepare = (result = compiled()) =>
  prepareMigrationQueryReceipt(
    {
      source: "unchanged canonical source",
      version: 4,
      bindings,
      compilerIdentity: "b".repeat(64),
    },
    async () => result,
  );
test("offline query plan preserves compiler dependency order, typed defaults, local rows and exact import catalog pins", async () => {
  const r = await prepare();
  assert.equal(r?.pageVersion, 4);
  assert.equal(r?.moduleSourceSha256, "a".repeat(64));
  assert.equal(r?.flowSourceSha256.length, 64);
  assert.deepEqual(
    r?.plan.queries.map((q) => q.dependencies),
    [[], ["first"]],
  );
  assert.deepEqual(r?.plan.scalars, { limit: { type: "number", default: 2 } });
  assert.deepEqual(r?.plan.tables[0]?.rows, [{ label: "kept" }]);
  assert.deepEqual(r?.plan.imports, [
    {
      schema: "sales",
      table: "rows",
      read: { binding: "sales", schema: "public", table: "rows" },
    },
  ]);
  assert.equal(JSON.stringify(r).includes("factorySource"), false);
});
test("query publication refuses compiler forward dependencies, mutable local defaults, unported builtin and catalog mismatch", async () => {
  for (const change of [
    (r: MigrationQueryCompilerOutput) => {
      r.flow.queries[0]!.reads.queries = ["second"];
    },
    (r: MigrationQueryCompilerOutput) => {
      r.flow.mutations = [{ name: "edit", target: { local: "local" } }];
    },
    (r: MigrationQueryCompilerOutput) => {
      r.flow.queries[0]!.reads.builtins = ["_members"];
    },
    (r: MigrationQueryCompilerOutput) => {
      r.flow.imports[0]!.ref = "Other1";
    },
  ]) {
    const r = compiled();
    change(r);
    await assert.rejects(prepare(r), /query/);
  }
});
test("server script classifier requires actual script syntax and never treats prose or comments as authority", async () => {
  const { hasLegacyServerModule } = await import(
    "../src/migration/query-source.ts"
  );
  assert.equal(hasLegacyServerModule('<p>script type="server"</p>'), false);
  assert.equal(
    hasLegacyServerModule(
      '<Helmet><script type="server">{`export default()=>1`}</script></Helmet><p>Kept</p>',
    ),
    true,
  );
  assert.equal(
    hasLegacyServerModule(
      '<Helmet><script type="module">{`export default()=>1`}</script></Helmet>',
    ),
    false,
  );
});
