import test from "node:test";
import assert from "node:assert/strict";
import {
  prepareMigrationBackends,
  registerMigrationBackends,
} from "../src/migration/backend-preparation.ts";
import { generatedDatasetBackendSource } from "../src/migration/datasets/import-metadata.ts";
import { readBackendModule } from "../src/backend/af-module.ts";
import { boundedBackendSchema } from "../src/graphql/execution-policy.ts";
import { sealDeployment, digest } from "../src/backend/deployment.ts";
import type { MigrationBackendPreparationInput } from "../src/migration/backend-preparation-contracts.ts";
const input: MigrationBackendPreparationInput = {
  sourceNamespace: "fixture",
  origin: "https://example.test",
  allocatedIds: ["Page12", "Page34"],
  pages: [
    {
      legacyId: "old-page",
      pageId: "Page12",
      owner: { kind: "user", id: "member" },
      revisions: [
        {
          version: 1,
          imports: [
            {
              name: "sales",
              legacyRef: "ds:1",
              datasetLegacyId: "ds",
              datasetVersion: 1,
            },
          ],
        },
        {
          version: 2,
          imports: [
            {
              name: "sales",
              legacyRef: "ds:2",
              datasetLegacyId: "ds",
              datasetVersion: 2,
            },
          ],
        },
      ],
    },
  ],
};
const moduleInfo = await readBackendModule(generatedDatasetBackendSource);
const schema = boundedBackendSchema(moduleInfo.typeDefs);
const deployment = sealDeployment(
  generatedDatasetBackendSource,
  "test compiled bundle",
  {
    typeDefs: moduleInfo.typeDefs,
    fields: [
      ...Object.keys(schema.getQueryType()?.getFields() ?? {}),
      ...Object.keys(schema.getMutationType()?.getFields() ?? {}),
    ],
  },
);
test("one fixed compiled source yields stable per-page backend IDs and exact per-revision binding receipts", async () => {
  let calls = 0;
  const host = {
    compile: async (source: string) => {
      calls++;
      assert.equal(source, generatedDatasetBackendSource);
      return deployment;
    },
    invoke: async () => null,
  };
  const prepared = await prepareMigrationBackends(input, { host });
  assert.equal(calls, 1);
  assert.equal(prepared.receipts.length, 2);
  assert.equal(prepared.bindings.length, 2);
  const [a, b] = prepared.receipts;
  assert.ok(a && b);
  assert.match(a.backendId, /^[A-Za-z0-9]{6}$/);
  assert.equal(a.backendId, b.backendId);
  assert.equal(a.backendNamespace, "legacyData");
  assert.equal(a.sourceSha256, digest(generatedDatasetBackendSource));
  assert.equal(a.bundleSha256, digest(deployment.bundle));
  assert.deepEqual(a.deployment, deployment);
  assert.deepEqual(
    prepared.bindings.map((v) => [v.pageVersion, v.datasetVersion]),
    [
      [1, 1],
      [2, 2],
    ],
  );
  assert.deepEqual(await prepareMigrationBackends(input, { host }), prepared);
  const collision = await prepareMigrationBackends(
    { ...input, allocatedIds: [...input.allocatedIds, a.backendId] },
    { host },
  );
  assert.notEqual(collision.receipts[0]!.backendId, a.backendId);
});
test("group pages and malformed Import descriptors fail before compilation; empty imports need no host", async () => {
  let calls = 0;
  const host = {
    compile: async () => {
      calls++;
      return deployment;
    },
    invoke: async () => null,
  };
  await assert.rejects(
    prepareMigrationBackends(
      {
        ...input,
        pages: [
          { ...input.pages[0]!, owner: { kind: "group", id: "group:fixture" } },
        ],
      },
      { host },
    ),
    /Group/,
  );
  await assert.rejects(
    prepareMigrationBackends(
      {
        ...input,
        pages: [
          {
            ...input.pages[0]!,
            revisions: [
              {
                version: 1,
                imports: [
                  {
                    ...input.pages[0]!.revisions[0]!.imports[0]!,
                    datasetVersion: 0,
                  },
                ],
              },
            ],
          },
        ],
      },
      { host },
    ),
    /Invalid/,
  );
  assert.equal(calls, 0);
  assert.deepEqual(await prepareMigrationBackends({ ...input, pages: [] }), {
    receipts: [],
    bindings: [],
    operations: [],
    browserMutations: [],
  });
});
test("registration rejects altered compiled receipts before touching destination SQL", async () => {
  const prepared = await prepareMigrationBackends(input, {
    host: { compile: async () => deployment, invoke: async () => null },
  });
  let queries = 0;
  await assert.rejects(
    registerMigrationBackends(
      {
        query: async () => {
          queries++;
          return { rows: [] };
        },
      },
      [{ ...prepared.receipts[0]!, sourceSha256: "0".repeat(64) }],
    ),
    /receipt/,
  );
  assert.equal(queries, 0);
});

test("same-owner backend IDs from a different page are collisions, never reused", async () => {
  const prepared = await prepareMigrationBackends(input, {
    host: { compile: async () => deployment, invoke: async () => null },
  });
  const receipt = prepared.receipts[0]!;
  const statements: string[] = [];
  await assert.rejects(
    registerMigrationBackends(
      {
        query: async (sql) => {
          statements.push(sql);
          if (sql.includes("FROM files f"))
            return { rows: [{ owner: receipt.owner, principal_kind: "user" }] };
          if (sql.includes("FROM retired_file_ids")) return { rows: [] };
          if (sql.includes("FROM file_ids"))
            return {
              rows: [
                { owner: receipt.owner, kind: "backend", published: true },
              ],
            };
          if (sql.includes("FROM af_backend_files"))
            return {
              rows: [{ owner: receipt.owner, page_id: "Page34", deployment }],
            };
          throw Error("Unexpected destination mutation");
        },
      },
      [receipt],
    ),
    /collision/,
  );
  assert.ok(statements.every((sql) => sql.startsWith("SELECT")));
});

test("later revisions that remove Imports still emit an empty-backend receipt", async () => {
  const page = input.pages[0]!;
  const prepared = await prepareMigrationBackends(
    {
      ...input,
      pages: [
        {
          ...page,
          revisions: [...page.revisions, { version: 3, imports: [] }],
        },
      ],
    },
    { host: { compile: async () => deployment, invoke: async () => null } },
  );
  assert.equal(prepared.receipts.length, 3);
  assert.deepEqual(
    prepared.receipts.map((r) => r.linked),
    [true, true, false],
  );
  assert.equal(prepared.bindings.length, 2);
});

test("named mutations pin trusted SQL to exact backend, page revision and binding", async () => {
  const mutation = {
    name: "reserve",
    bindingName: "sales",
    datasetLegacyId: "ds",
    target: { schema: "public", table: "rows" },
    sqlSchema: "sales",
    sql: "delete from sales.rows where id=$id",
    analysis: { operation: "delete" as const, columns: [] },
    paramTypes: { id: "number" as const },
    conflictMode: "refuse" as const,
  };
  const page = input.pages[0]!;
  const revised = {
    ...input,
    pages: [
      {
        ...page,
        revisions: [
          {
            ...page.revisions[0]!,
            editId: "original-edit",
            mutations: [mutation],
          },
        ],
      },
    ],
  };
  const host = { compile: async () => deployment, invoke: async () => null };
  const prepared = await prepareMigrationBackends(revised, { host });
  assert.deepEqual(prepared.browserMutations, [
    {
      pageLegacyId: "old-page",
      pageVersion: 1,
      mutation: {
        name: "reserve",
        backendNamespace: "legacyData",
        recoveryScope: prepared.browserMutations[0]!.mutation.recoveryScope,
        paramTypes: { id: "number" },
      },
    },
  ]);
  assert.ok(!JSON.stringify(prepared.browserMutations).includes("delete from"));
  assert.equal(
    Object.hasOwn(prepared.browserMutations[0]!.mutation, "analysis"),
    false,
  );
  const scope = prepared.browserMutations[0]!.mutation.recoveryScope;
  assert.match(scope, /^[a-f0-9]{64}$/);
  const rowMutation = {
    ...mutation,
    sql: "delete from sales.rows where id=$row__id",
    paramTypes: { row__id: null },
    rowParams: { id: { param: "row__id", type: null } },
  };
  const rowPrepared = await prepareMigrationBackends(
    {
      ...revised,
      pages: [
        {
          ...revised.pages[0]!,
          revisions: [
            { ...revised.pages[0]!.revisions[0]!, mutations: [rowMutation] },
          ],
        },
      ],
    },
    { host },
  );
  assert.deepEqual(rowPrepared.browserMutations[0]!.mutation.paramTypes, {});
  assert.deepEqual(
    rowPrepared.browserMutations[0]!.mutation.rowParams,
    rowMutation.rowParams,
  );
  assert.notEqual(
    rowPrepared.browserMutations[0]!.mutation.recoveryScope,
    scope,
  );
  assert.deepEqual(rowPrepared.operations[0]!.operation.paramTypes, {
    row__id: null,
  });
  const nextDeployment = sealDeployment(
    generatedDatasetBackendSource,
    "new compiled bundle",
    { typeDefs: moduleInfo.typeDefs, fields: [...deployment.fields] },
  );
  assert.equal(
    (
      await prepareMigrationBackends(revised, {
        host: { ...host, compile: async () => nextDeployment },
      })
    ).browserMutations[0]!.mutation.recoveryScope,
    scope,
  );

  assert.equal(
    (await prepareMigrationBackends(revised, { host })).browserMutations[0]!
      .mutation.recoveryScope,
    scope,
  );
  for (const changed of [
    { ...mutation, sql: "delete from sales.rows where id=$id and id>0" },
    { ...mutation, expectedAffected: 1 },
  ]) {
    const altered = {
      ...revised,
      pages: [
        {
          ...revised.pages[0]!,
          revisions: [
            { ...revised.pages[0]!.revisions[0]!, mutations: [changed] },
          ],
        },
      ],
    };
    assert.notEqual(
      (await prepareMigrationBackends(altered, { host })).browserMutations[0]!
        .mutation.recoveryScope,
      scope,
    );
  }
  const nextRevision = {
    ...revised,
    pages: [
      {
        ...revised.pages[0]!,
        revisions: [
          {
            ...revised.pages[0]!.revisions[0]!,
            version: 2,
            editId: "next-edit",
          },
        ],
      },
    ],
  };
  assert.notEqual(
    (await prepareMigrationBackends(nextRevision, { host }))
      .browserMutations[0]!.mutation.recoveryScope,
    scope,
  );

  assert.deepEqual(prepared.operations, [
    {
      sourceNamespace: "fixture",
      bindingName: "sales",
      operation: {
        name: "reserve",
        backendId: prepared.receipts[0]!.backendId,
        backendVersion: deployment.version,
        page: {
          id: "Page12",
          version: 1,
          legacyId: "old-page",
          editId: "original-edit",
        },
        datasetId: "ds",
        target: mutation.target,
        sqlSchema: "sales",
        sql: mutation.sql,
        analysis: mutation.analysis,
        paramTypes: { id: "number" },
        conflictMode: "refuse",
      },
    },
  ]);
  for (const revision of [
    { ...revised.pages[0]!.revisions[0]!, editId: undefined },
    {
      ...revised.pages[0]!.revisions[0]!,
      mutations: [{ ...mutation, datasetLegacyId: "other" }],
    },
    { ...revised.pages[0]!.revisions[0]!, mutations: [mutation, mutation] },
  ]) {
    await assert.rejects(
      prepareMigrationBackends(
        { ...input, pages: [{ ...page, revisions: [revision] }] },
        { host },
      ),
      /Invalid/,
    );
  }
});

test("a declared membership-only revision receives a real compiled backend without dataset Imports", async () => {
  const page = input.pages[0]!;
  const result = await prepareMigrationBackends(
    {
      ...input,
      pages: [
        {
          ...page,
          revisions: [{ version: 1, readsMembers: true, imports: [] }],
        },
      ],
    },
    { host: { compile: async () => deployment, invoke: async () => null } },
  );
  assert.equal(result.bindings.length, 0);
  assert.equal(result.receipts.length, 1);
  assert.equal(result.receipts[0]!.linked, true);
  assert.deepEqual(result.receipts[0]!.members, {
    sourceNamespace: input.sourceNamespace,
  });
});

test("viewer-only current revisions receive a compiled capability receipt without Imports or historical identity rebinding", async () => {
  const current: MigrationBackendPreparationInput = {
    ...input,
    pages: [
      {
        ...input.pages[0]!,
        revisions: [
          { version: 1, imports: [] },
          { version: 2, imports: [], readsViewer: true },
        ],
      },
    ],
  };
  const prepared = await prepareMigrationBackends(current, {
    host: { compile: async () => deployment, invoke: async () => null },
  });
  assert.deepEqual(
    prepared.receipts.map((r) => ({ linked: r.linked, viewer: r.viewer })),
    [
      { linked: false, viewer: undefined },
      { linked: true, viewer: { sourceNamespace: "fixture" } },
    ],
  );
  assert.deepEqual(prepared.bindings, []);
  await assert.rejects(
    prepareMigrationBackends(
      {
        ...current,
        pages: [
          {
            ...current.pages[0]!,
            revisions: [
              { version: 1, imports: [], readsViewer: true },
              { version: 2, imports: [] },
            ],
          },
        ],
      },
      { host: { compile: async () => deployment, invoke: async () => null } },
    ),
    /Invalid migration backend preparation/,
  );
});
test("editing-cell receipts keep typed generated SQL slot private, preserve value descriptor and bind recovery identity", async () => {
  const prepare = (type: "number" | "string", param = "cell__value") =>
    prepareMigrationBackends(
      {
        ...input,
        pages: [
          {
            ...input.pages[0]!,
            revisions: [
              {
                ...input.pages[0]!.revisions[0]!,
                editId: "source-edit",
                mutations: [
                  {
                    name: "editCell",
                    bindingName: "sales",
                    datasetLegacyId: "ds",
                    target: { schema: "public", table: "rows" },
                    sqlSchema: "sales",
                    sql: "update sales.rows set value=$cell__value where id=$id",
                    paramTypes: { cell__value: type, id: "number" },
                    valueParam: { param, type },
                    conflictMode: "refuse",
                  },
                ],
              },
            ],
          },
        ],
      },
      { host: { compile: async () => deployment, invoke: async () => null } },
    );
  const prepared = await prepare("number");
  assert.deepEqual(prepared.operations[0]!.operation.paramTypes, {
    cell__value: "number",
    id: "number",
  });
  assert.deepEqual(
    (prepared.operations[0]!.operation as { valueParam?: unknown }).valueParam,
    { param: "cell__value", type: "number" },
  );
  assert.deepEqual(prepared.browserMutations[0]!.mutation.paramTypes, {
    id: "number",
  });
  assert.deepEqual(prepared.browserMutations[0]!.mutation.valueParam, {
    param: "cell__value",
    type: "number",
  });
  assert.match(
    prepared.browserMutations[0]!.mutation.recoveryScope,
    /^[a-f0-9]{64}$/,
  );
  assert.notEqual(
    (await prepare("string")).browserMutations[0]!.mutation.recoveryScope,
    prepared.browserMutations[0]!.mutation.recoveryScope,
  );
  assert.equal(
    JSON.stringify(prepared.browserMutations).includes("update sales"),
    false,
  );
  await assert.rejects(prepare("number", "ordinary"), /Invalid/);
});

test("an admitted server-handler head receives the fixed callable backend without dataset imports", async () => {
  const prepared = await prepareMigrationBackends(
    {
      ...input,
      pages: [
        {
          ...input.pages[0]!,
          revisions: [{ version: 1, imports: [], runsProgram: true }],
        },
      ],
    },
    { host: { compile: async () => deployment, invoke: async () => null } },
  );
  assert.equal(prepared.receipts.length, 1);
  assert.equal(prepared.receipts[0]!.linked, true);
  assert.equal(prepared.receipts[0]!.program, true);
  assert.equal(prepared.bindings.length, 0);
  assert.ok(schema.getMutationType()?.getFields().run);
});

test("source-query pages get their own fixed backend variant and viewer authority without changing hosted backends", async () => {
  const { generatedSourceQueryBackendSource } = await import(
    "../src/migration/source-query-backend.ts"
  );
  const sql = "select 1 as value";
  const query = {
    pageLegacyId: "source-page",
    pageVersion: 1,
    name: "q",
    sourceRef: "ref:source01",
    resource: "source-source01",
    sql,
    sqlSha256: digest(sql),
    params: {},
    columns: [{ name: "value", type: "number" as const }],
  };
  let calls = 0;
  const host = {
    compile: async (source: string) => {
      calls++;
      const module = await readBackendModule(source);
      const schema = boundedBackendSchema(module.typeDefs);
      return sealDeployment(source, "fixture compiled variant", {
        typeDefs: module.typeDefs,
        fields: [
          ...Object.keys(schema.getQueryType()?.getFields() ?? {}),
          ...Object.keys(schema.getMutationType()?.getFields() ?? {}),
        ],
      });
    },
    invoke: async () => null,
  };
  const prepared = await prepareMigrationBackends(
    {
      ...input,
      pages: [
        ...input.pages,
        {
          legacyId: "source-page",
          pageId: "Page56",
          owner: { kind: "user", id: "member" },
          revisions: [
            {
              version: 1,
              imports: [],
              readsViewer: true,
              sourceQueries: [query],
            },
          ],
        },
      ],
    },
    { host },
  );
  assert.equal(calls, 2);
  assert.equal(
    prepared.receipts[0]!.deployment.source,
    generatedDatasetBackendSource,
  );
  const receipt = prepared.receipts.find(
    (r) => r.pageLegacyId === "source-page",
  )!;
  assert.equal(receipt.deployment.source, generatedSourceQueryBackendSource);
  assert.equal(receipt.sourceQueries, true);
  assert.equal(receipt.linked, true);
  assert.equal(receipt.viewer?.sourceNamespace, "fixture");
  assert.deepEqual(prepared.sourceQueryRegistrations?.[0]?.queries, [query]);
  assert.equal(
    prepared.sourceQueryRegistrations?.[0]?.receipt.backendId,
    receipt.backendId,
  );
});
