import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "node:http";
import { fixture, binding, context } from "./dataset-runtime-fixture.ts";
import { createBackendHost } from "../src/backend/container-host.ts";
import { compileLegacyServerModule } from "../src/migration/server-module.ts";
import { createDatasetSqlExecutor } from "../src/backend/dataset-sql-executor.ts";
import { remoteDatasetSqlExecutor } from "../src/backend/dataset-sql-transport.ts";
import { createExecutionService } from "../src/backend/execution-service.ts";
import { createSqlDatabase } from "../src/persistence/sql.ts";
import { registerSavedQueries } from "../src/persistence/dataset-queries.ts";
import { createSavedQueryHost } from "../src/server/registered-query-host.ts";
import { createDatasetRuntime } from "../src/server/dataset-runtime.ts";
import { createDatasetMutationObjectStore } from "../src/datasets/mutation/object-store.ts";
test("internal V8 query closure crosses fresh PG authority and policy reads into authenticated remote readonly SQL", async () => {
  const host = createBackendHost({ sandboxNetwork: "none" }),
    sql = createDatasetSqlExecutor({ deploymentNamespace: "queryhost" });
  const compiled = await compileLegacyServerModule(
    'import {query} from "page";const rows=query("$summary");export default async function(){await rows.ready;return rows()}',
    { values: [], queries: ["summary"], mutations: [] },
  );
  // This deliberately test-only closure proves the port, not production server-module activation.
  const deployment = await host.compile(
    `export const typeDefs='scalar Json\\ntype Query {invoke:Json}';const factory=${compiled.factorySource};export default {Query:{invoke:async(_args,_principal,caps)=>factory({query:name=>{let rows=[];const accessor=()=>rows;accessor.ready=caps.invoke({resource:'registered',operation:'query',input:{values:{},only:[name.slice(1)]}}).then(answer=>{rows=answer.tables[name.slice(1)].rows});return accessor}})()}};`,
  );
  const source = await mkdtemp(join(tmpdir(), "query-host-")),
    object = await createDatasetMutationObjectStore(source).persist([
      { name: "visible" },
    ]);
  const { env } = await fixture({
    ...binding,
    backendVersion: deployment.version,
    tables: [{ ...binding.tables[0]!, object }],
  });
  const database = createSqlDatabase({
    pool: env.pool,
    initialize: async () => {},
    statementTimeoutMs: 15000,
  });
  const controller = createServer(
    createExecutionService({ secret: "q".repeat(32), host, datasetSql: sql }),
  );
  await new Promise<void>((resolve) =>
    controller.listen(0, "127.0.0.1", resolve),
  );
  const remote = remoteDatasetSqlExecutor({
    secret: "q".repeat(32),
    endpoint: `http://127.0.0.1:${(controller.address() as { port: number }).port}/v1/execute`,
  });
  try {
    const content = "canonical saved page",
      digest = createHash("sha256").update(content).digest("hex");
    await env.pool.query("UPDATE files SET source_digest=$1", [digest]);
    await env.pool.query(
      "INSERT INTO sources(file_id,revision,content,digest) VALUES('Pg0001','1',$1,$2)",
      [content, digest],
    );
    await env.pool.query("UPDATE af_backend_versions SET deployment=$1", [
      deployment,
    ]);
    await env.pool.query(
      "INSERT INTO sessions(token_hash,actor,file_id,generation,expires) VALUES('query-session','member',NULL,NULL,9999999999999)",
    );
    await database.transaction((client) =>
      registerSavedQueries(client, {
        sourceNamespace: "legacy",
        moduleSourceSha256: compiled.sourceSha256,
        plan: {
          registration: {
            backendId: context.backendId,
            backendVersion: deployment.version,
            pageId: context.pageId,
            pageVersion: 1,
            sourceSha256: digest,
          },
          queries: [
            {
              name: "summary",
              sql: "select name,$_me__id as who from sales.rows",
              dependencies: [],
            },
          ],
          scalars: {},
          tables: [],
          imports: [
            {
              schema: "sales",
              table: "rows",
              read: { binding: "sales", schema: "public", table: "rows" },
            },
          ],
        },
      }),
    );
    const runtime = createDatasetRuntime({
      database,
      sourceDirectory: source,
      now: () => 100,
    });
    const adapter = createSavedQueryHost({
      database,
      reads: runtime.reads,
      executor: remote,
      now: () => 100,
    });
    const principal = { tenant: context.pageId, subject: context.subject };
    const bound = await adapter.bind(
      {
        ...context,
        backendVersion: deployment.version,
        principal,
        tokenHash: "query-session",
      },
      new AbortController().signal,
    );
    const invoke = () =>
      host.invoke({
        deployment,
        principal,
        input: { field: "invoke", args: {} },
        env: {},
        reuse: { kind: "one-shot" },
        capabilityHandler: async (p, request, signal) => {
          assert.deepEqual(p, principal);
          if (
            request.kind !== "invoke" ||
            request.resource !== "registered" ||
            request.operation !== "query"
          )
            throw Error("refused");
          return (await bound.execute(request.input, signal)) as any;
        },
      });
    assert.deepEqual(await invoke(), [{ name: "visible", who: "old-member" }]);
    await assert.rejects(
      bound.execute({ values: {}, only: ["summary"], sql: "select secret" }),
    );
    await env.pool.query(
      "UPDATE files SET access=jsonb_set(access,'{shares}','{}')",
    );
    await assert.rejects(invoke());
  } finally {
    await host.close?.();
    await remote.close();
    await sql.close();
    await new Promise<void>((resolve, reject) =>
      controller.close((e) => (e ? reject(e) : resolve())),
    );
    await env.cleanup();
    await rm(source, { recursive: true, force: true });
  }
});
