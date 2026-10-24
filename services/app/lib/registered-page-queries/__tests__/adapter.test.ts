import { it, expect } from "vitest";
import { createSqliteSql } from "@artifactbin/sql/sqlite";
import { composePageSchema, executePageOperation } from "@/lib/page-operations";
import { createBackendCompiler } from "@/lib/page-operations/backend";
import {
  prepareRegisteredQueryBackend,
  registeredPlan,
  commitRegisteredQueryBackend,
} from "../registry";
import {
  registeredQueryDescriptor,
  registeredQueryInvoker,
} from "../namespace";
import { createRetainedRegisteredQueries } from "../retained";
import type {
  HtmlPageVersion,
  RunnerService,
  Queryable,
} from "@artifactbin/contracts";
const page: HtmlPageVersion = {
  pageId: "page",
  version: 3,
  revision: "3",
  html: "<p>Saved page</p>",
  links: [],
  nextNodeId: 1,
};
const program = {
  scalars: { amount: { type: "number" as const, default: null } },
  queries: [
    {
      name: "sum",
      sql: "select sum(amount) as amount from items.rows where $amount is null or amount >= $amount",
      dependencies: [],
    },
  ],
  imports: [{ alias: "items", binding: "private-source", table: "rows" }],
};
const prepared = prepareRegisteredQueryBackend(
  "queries",
  "backend",
  page,
  program,
  {
    compilerSha256: "a".repeat(64),
    sourceSha256: "b".repeat(64),
    sqlEngineSha256: "c".repeat(64),
  },
);
const saved = { ...page, links: [prepared.link] };
const backend = {
  ...prepared.backend,
  backendId: prepared.link.backendId,
  version: prepared.link.version,
  pageId: page.pageId,
  ownerId: "owner",
  secretBindings: [],
};
it("pins page bytes/version/backend and refuses forged envelope or SDL", () => {
  expect(
    registeredPlan(saved, prepared.link, backend)?.registration.pageVersion,
  ).toBe(3);
  for (const changed of [
    { ...backend, compiled: backend.compiled + " " },
    { ...backend, typeDefs: backend.typeDefs + " " },
    {
      ...backend,
      source: backend.source.replace("private-source", "other-source"),
    },
  ])
    expect(() => registeredPlan(saved, prepared.link, changed)).toThrow();
  expect(() =>
    registeredPlan({ ...saved, html: "changed" }, prepared.link, backend),
  ).toThrow();
  expect(
    registeredPlan(saved, prepared.link, {
      ...backend,
      compiled: "ordinary JavaScript",
    }),
  ).toBeNull();
});
it("cannot obtain the reserved compiled envelope through ordinary public compilation", async () => {
  const runner = {
    start: async () => ({ runId: "compile" }),
    getRun: async () => ({
      status: "completed",
      output: { typeDefs: prepared.backend.typeDefs },
    }),
  } as unknown as RunnerService;
  const result = await createBackendCompiler(runner)(
    `export const typeDefs=${JSON.stringify(prepared.backend.typeDefs)};export default {};`,
  );
  expect(result.compiled.startsWith("!registered-page-queries-v1")).toBe(false);
  expect(() =>
    registeredPlan(saved, prepared.link, { ...backend, ...result }),
  ).not.toThrow();
});
it("commits only after the exact page version/link exists in the same transaction", async () => {
  const statements: string[] = [];
  const tx = {
    query: async (sql: string) => {
      statements.push(sql);
      return {
        rows: sql.includes("FROM artifacts ")
          ? [{ user_id: "owner", version: 3 }]
          : sql.includes("FROM artifact_versions ")
            ? [{ source: page.html, meta: { htmlLinks: [prepared.link] } }]
            : [],
      };
    },
  } as unknown as Queryable;
  await commitRegisteredQueryBackend(tx, saved, "owner", prepared);
  expect(statements.at(-1)).toContain("INSERT INTO html_backend_versions");
  await expect(
    commitRegisteredQueryBackend(
      tx,
      { ...saved, html: "changed" },
      "owner",
      prepared,
    ),
  ).rejects.toThrow("query_registration_changed");
});
it("executes real page GraphQL with result-only document authority and viewer filtered source windows", async () => {
  const sql = createSqliteSql();
  let reads = 0,
    checks = 0;
  const fences: Array<() => Promise<void>> = [];
  const document = {
    id: "page",
    format: "html",
    user_id: "owner",
    version: 3,
    edit_id: "edit",
    meta: {},
  };
  const artifact = {
    id: "private-source",
    format: "dataset",
    version: 1,
    edit_id: "data",
    meta: {},
    visibility: "private",
  };
  const calls: any[] = [];
  const adapter = createRetainedRegisteredQueries(
    { userId: "viewer", tokenId: null, email: null, documentEditor: false },
    saved,
    {
      readPage: async () => saved,
      readDocument: async () => document as any,
      readBackend: async () => backend,
      resolveImport: async (doc, id, actor) => {
        calls.push([doc.id, id, actor.userId]);
        return {
          artifact: artifact as any,
          catalog: {
            kind: "stored",
            defaultSchema: "public",
            refreshSeconds: 0,
            tables: [
              {
                schema: "public",
                name: "rows",
                objectKey: "object",
                columns: [{ name: "amount", type: "number" }],
              },
            ],
          },
        };
      },
      sourceStats: async () => ({ rows: 2, bytes: 100 }),
      readWindow: async (_catalog, _sql, _params, options) => {
        reads++;
        await options?.authorize?.();
        return {
          columns: [{ name: "amount", type: "number" }],
          rows: [{ amount: 2 }, { amount: 4 }],
          refreshedAt: "now",
        };
      },
      execute: (input) => sql.run(input),
      now: () => new Date("2026-01-01T00:00:00Z"),
      retainReadFence: (verify) => {
        checks++;
        fences.push(verify);
      },
    },
  );
  const plan = registeredPlan(saved, prepared.link, backend)!;
  const context = { ...plan.registration, subject: "viewer" };
  const invoke = registeredQueryInvoker(saved, context, adapter.execute);
  const answer = await executePageOperation({
    schema: composePageSchema([
      {
        name: "queries",
        fileId: "backend",
        version: backend.version,
        typeDefs: backend.typeDefs,
      },
    ]),
    caller: { pageId: "page", subject: "viewer", role: "VIEWER" },
    request: {
      query:
        "query { queries { evaluate(values:{amount:null},only:[sum]) { tables {name error rows {cells {number isNull}}} } } }",
    },
    invoke,
  });
  expect(answer.errors).toBeUndefined();
  expect(answer.data).toMatchObject({
    queries: {
      evaluate: {
        tables: [
          {
            name: "sum",
            error: null,
            rows: [{ cells: [{ number: 6, isNull: false }] }],
          },
        ],
      },
    },
  });
  expect(reads).toBe(1);
  expect(
    calls.every(
      (call) =>
        call[0] === "page" &&
        call[1] === "private-source" &&
        call[2] === "viewer",
    ),
  ).toBe(true);
  expect(checks).toBeGreaterThan(0);
  await fences[0]!();
  artifact.version++;
  await expect(fences[0]!()).rejects.toThrow("dataset_changed");
  const rejected = await executePageOperation({
    schema: composePageSchema([
      {
        name: "queries",
        fileId: "backend",
        version: backend.version,
        typeDefs: backend.typeDefs,
      },
    ]),
    caller: { pageId: "page", subject: "viewer", role: "VIEWER" },
    request: {
      query:
        'query {queries {evaluate(values:{_now:"spoof"},only:[sum]) {tables {name}}}}',
    },
    invoke,
  });
  expect(rejected.errors?.length).toBeGreaterThan(0);
});

it("emits a portable public descriptor with no SQL, binding IDs or platform overrides", () => {
  const descriptor = registeredQueryDescriptor("queries", program, "sum");
  expect(descriptor).toMatchObject({
    name: "sum",
    namespace: "queries",
    tableName: "sum",
    responsePath: ["queries", "evaluate", "tables"],
    decode: "registered-page-table-cells-v1",
    values: [{ name: "amount", type: "number" }],
  });
  expect(JSON.stringify(descriptor)).not.toContain("private-source");
  expect(descriptor.document).toContain("$values: queries__Values!");
  expect(
    registeredQueryDescriptor("queries", { ...program, scalars: {} }, "sum")
      .document,
  ).not.toContain("$values");
});
