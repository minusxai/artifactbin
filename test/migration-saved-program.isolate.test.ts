import { sourceDigest } from "../src/server/page-ports.ts";
import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fixture, binding, context } from "./dataset-runtime-fixture.ts";
import { createBackendHost } from "../src/backend/container-host.ts";
import { createBackendRoutes } from "../src/backend/af-files.ts";
import { createDatasetSqlExecutor } from "../src/backend/dataset-sql-executor.ts";
import { createSqlDatabase } from "../src/persistence/sql.ts";
import { registerSavedQueries } from "../src/persistence/dataset-queries.ts";
import { createDatasetRuntime } from "../src/server/dataset-runtime.ts";
import { createDatasetMutationObjectStore } from "../src/datasets/mutation/object-store.ts";
import { createSavedProgramHost } from "../src/server/saved-program-host.ts";
import { compileProgramResolver } from "../src/migration/programs/compiler.ts";
import { generatedDatasetBackendSource } from "../src/migration/datasets/import-metadata.ts";
import { createPageCaller } from "../src/server/af-caller.ts";
import { hash } from "../src/server/text.ts";
test("saved page GraphQL run executes its exact isolated handler with fresh SQL authority", async () => {
  const host = createBackendHost({ sandboxNetwork: "none" }),
    executor = createDatasetSqlExecutor({
      deploymentNamespace: "savedprogram",
    });
  const deployment = await host.compile(generatedDatasetBackendSource);
  const manifest = {
    values: ["region"],
    queries: ["summary"],
    mutations: [],
    defaults: { region: "initial" },
  };
  const resolver = await compileProgramResolver(
    `import {signal,query} from 'page';const [region,setRegion]=signal('$region');const summary=query('$summary');export default async input=>{setRegion(input.region);return {region:region(),rows:await summary.ready};}`,
    manifest,
  );
  const directory = await mkdtemp(join(tmpdir(), "saved-program-"));
  const object = await createDatasetMutationObjectStore(directory).persist([
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
  const credential = "synthetic-program-session";
  try {
    const content = "saved canonical page";
    const digest = sourceDigest(content);
    await env.pool.query(
      "INSERT INTO af_backend_pages(page_id,page_version) VALUES('Pg0001',1)",
    );
    await env.pool.query("UPDATE files SET source_digest=$1", [digest]);
    await env.pool.query(
      "INSERT INTO sources(file_id,revision,content,digest) VALUES('Pg0001','1',$1,$2)",
      [content, digest],
    );
    await env.pool.query(
      "UPDATE af_backend_versions SET deployment=$1,type_defs=$2",
      [deployment, deployment.typeDefs],
    );
    await env.pool.query(
      "INSERT INTO sessions(token_hash,actor,file_id,generation,expires) VALUES($1,'member',NULL,NULL,9999999999999)",
      [hash(credential)],
    );
    const runtime = createDatasetRuntime({
      database,
      sourceDirectory: directory,
      now: () => 100,
    });
    const programs = createSavedProgramHost({
      database,
      host,
      reads: runtime.reads,
      executor,
      now: () => 100,
    });
    const routes = createBackendRoutes({
      database,
      host,
      caller: createPageCaller(() => 100),
      datasets: runtime.reads,
      programs,
      log: () => {},
    });
    const request = (query: string) =>
      routes.handle({
        method: "POST",
        url: new URL("http://localhost/api/files/Pg0001/graphql"),
        credential,
        body: { query },
        signal: new AbortController().signal,
      });
    const query = `mutation {bridge {run(inputJson:${JSON.stringify(JSON.stringify({ region: "south" }))})}}`;
    const unavailable = await request(query);
    assert.ok((unavailable?.body as any).errors?.length);
    await database.transaction((client) =>
      registerSavedQueries(client, {
        sourceNamespace: "legacy",
        moduleSourceSha256: resolver.scriptSha256,
        program: { resolver, manifest },
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
              sql: "select name,$region as region,$_me__id as who from sales.rows",
              dependencies: [],
            },
          ],
          scalars: { region: { type: "string", default: "initial" } },
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
    const response = await request(query);
    assert.equal(response?.status, 200);
    const body = response?.body as any;
    assert.equal(body.errors, undefined);
    assert.deepEqual(JSON.parse(body.data.bridge.run), {
      region: "south",
      rows: [{ name: "visible", region: "south", who: "old-member" }],
    });
    const other = await request(
      'query {bridge {read(binding:"sales",schema:"public",table:"rows",offset:0,limit:10){rows}}}',
    );
    assert.deepEqual((other?.body as any).data.bridge.read.rows, [
      { name: "visible" },
    ]);
    const invalid = await request(
      'mutation {bridge {run(inputJson:"null",sql:"select secret")}}',
    );
    assert.ok((invalid?.body as any).errors?.length);
    await env.pool.query(
      "UPDATE files SET access=jsonb_set(access,'{shares}','{}')",
    );
    await assert.rejects(request(query));
  } finally {
    await host.close?.();
    await executor.close();
    await env.cleanup();
    await rm(directory, { recursive: true, force: true });
  }
});
