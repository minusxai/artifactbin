import { sourceDigest } from "../src/server/page-ports.ts";
import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { fixture, binding, context } from "./dataset-runtime-fixture.ts";
import { createBackendHost } from "../src/backend/container-host.ts";
import { createBackendRoutes } from "../src/backend/af-files.ts";
import { createSqlDatabase } from "../src/persistence/sql.ts";
import { registerSavedQueries } from "../src/persistence/dataset-queries.ts";
import { createSavedProgramHost } from "../src/server/saved-program-host.ts";
import { createDatasetRuntime } from "../src/server/dataset-runtime.ts";
import { compileNativeProgramResolver } from "../src/migration/programs/native-compiler.ts";
import { generatedDatasetBackendSource } from "../src/migration/datasets/import-metadata.ts";
import { createPageCaller } from "../src/server/af-caller.ts";
import { hash } from "../src/server/text.ts";
test("native saved page execution requires its owner and rejects concurrent invocation across service instances", async () => {
  const host = createBackendHost({ sandboxNetwork: "none" });
  const deployment = await host.compile(generatedDatasetBackendSource);
  const native = await compileNativeProgramResolver(
    JSON.stringify({
      version: 1,
      command: [
        "node",
        "-e",
        "console.log(process.env.ARTIFACTBIN_INPUT);process.exit(137)",
      ],
      compute: { vcpu: 1, memoryMiB: 2048, ttlSeconds: 60 },
    }),
  );
  const { env } = await fixture({
    ...binding,
    backendVersion: deployment.version,
  });
  const database = createSqlDatabase({
    pool: env.pool,
    initialize: async () => {},
    statementTimeoutMs: 15000,
  });
  let enter: () => void = () => {},
    release: () => void = () => {};
  const entered = new Promise<void>((resolve) => (enter = resolve)),
    held = new Promise<void>((resolve) => (release = resolve));
  let pause = false;
  const intercepted = {
    compile: host.compile,
    invoke: async (request: Parameters<typeof host.invoke>[0]) => {
      if (pause) {
        enter();
        await held;
      }
      return host.invoke(request);
    },
  };
  try {
    const content = "canonical native page",
      digest = sourceDigest(content);
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
    for (const actor of ["member", "owner"])
      await env.pool.query(
        "INSERT INTO sessions(token_hash,actor,file_id,generation,expires) VALUES($1,$2,NULL,NULL,9999999999999)",
        [hash(actor + "-session"), actor],
      );
    const {
      resolver,
      originalSourceSha256,
      compute,
      authority,
      concurrency,
      computeCompatibility,
    } = native;
    await database.transaction((client) =>
      registerSavedQueries(client, {
        sourceNamespace: "legacy",
        moduleSourceSha256: resolver.scriptSha256,
        program: {
          resolver,
          manifest: { values: [], queries: [], mutations: [], defaults: {} },
          native: {
            originalSourceSha256,
            compute,
            authority,
            concurrency,
            computeCompatibility,
          },
        },
        plan: {
          registration: {
            backendId: context.backendId,
            backendVersion: deployment.version,
            pageId: context.pageId,
            pageVersion: 1,
            sourceSha256: digest,
          },
          queries: [],
          scalars: {},
          tables: [],
          imports: [],
        },
      }),
    );
    const reads = createDatasetRuntime({
      database,
      sourceDirectory: "unused",
      now: () => 100,
    }).reads;
    const route = () =>
      createBackendRoutes({
        database,
        host,
        caller: createPageCaller(() => 100),
        datasets: reads,
        programs: createSavedProgramHost({
          database,
          host: intercepted,
          reads,
          now: () => 100,
        }),
        log: () => {},
      });
    const first = route(),
      second = route();
    const request = (
      routes: ReturnType<typeof route>,
      actor: string,
      input: unknown,
    ) =>
      routes.handle({
        method: "POST",
        url: new URL("http://localhost/api/files/Pg0001/graphql"),
        credential: actor + "-session",
        body: {
          query: "mutation($input:String!){bridge{run(inputJson:$input)}}",
          variables: { input: JSON.stringify(input) },
        },
        signal: new AbortController().signal,
      });
    const denied = await request(first, "member", { x: 1 });
    assert.ok((denied?.body as any).errors?.length);
    pause = true;
    const running = request(first, "owner", { x: 1 });
    await entered;
    const concurrent = await request(second, "owner", { x: 2 });
    assert.ok((concurrent?.body as any).errors?.length);
    pause = false;
    release();
    const success = await running;
    assert.equal((success?.body as any).errors, undefined);
    assert.deepEqual(JSON.parse((success?.body as any).data.bridge.run), {
      stdout: '{"x":1}\n',
      stderr: "",
      exitCode: 137,
    });
    const large = { text: "x".repeat(8170) };
    const again = await request(second, "owner", large);
    assert.equal((again?.body as any).errors, undefined);
    assert.equal(
      JSON.parse((again?.body as any).data.bridge.run).stdout,
      JSON.stringify(large) + "\n",
    );
  } finally {
    release();
    await host.close?.();
    await env.cleanup();
  }
});
