import test from "node:test";
import assert from "node:assert/strict";
import { createBackendRoutes } from "../src/backend/af-files.ts";
import { createLegacyViewerCompatibility } from "../src/backend/legacy-viewer.ts";
import { generatedDatasetBackendSource } from "../src/migration/datasets/import-metadata.ts";
import { readBackendModule } from "../src/backend/af-module.ts";
import { boundedBackendSchema } from "../src/graphql/execution-policy.ts";
import { sealDeployment } from "../src/backend/deployment.ts";
import type { BackendHost } from "../src/backend/contracts.ts";
const info = await readBackendModule(generatedDatasetBackendSource);
const schema = boundedBackendSchema(info.typeDefs);
const deployment = sealDeployment(generatedDatasetBackendSource, "fixture", {
  typeDefs: info.typeDefs,
  fields: [
    ...Object.keys(schema.getQueryType()!.getFields()),
    ...Object.keys(schema.getMutationType()!.getFields()),
  ],
});
test("legacy generated backend exposes only registered native viewer, preserving every host receipt", async () => {
  let bound = true,
    denied = false,
    subject: string | null = "account",
    hostCalls = 0;
  const compatibility = createLegacyViewerCompatibility({
    current: async (context) => {
      assert.equal(context.backendVersion, deployment.version);
      return bound;
    },
  });
  const routes = createBackendRoutes({
    database: {
      transaction: async (work) =>
        work({
          query: async () => ({
            rows: [
              {
                name: "legacyData",
                file_id: "Back12",
                version: deployment.version,
                type_defs: info.typeDefs,
                deployment,
                owner: "owner",
              },
            ],
            rowCount: 1,
          }),
        }),
    },
    caller: async () => ({ pageId: "Page12", subject, role: "VIEWER" }),
    host: {
      compile: async () => deployment,
      invoke: async (input) => {
        hostCalls++;
        assert.equal(input.deployment, deployment);
        return { generation: "c".repeat(64), rows: [] };
      },
    } as BackendHost,
    datasetViewer: {
      viewer: async (context) => {
        assert.equal(context.backendVersion, deployment.version);
        assert.equal(context.subject, subject);
        if (denied) throw Error("denied");
        return {
          generation: "a".repeat(64),
          id: subject ? "original-reader" : null,
        };
      },
    },
    legacyViewer: compatibility,
    log: () => {},
  });
  async function request(query: string) {
    return routes.handle({
      url: new URL("https://example.test/api/files/Page12/graphql"),
      method: "POST",
      credential: "opaque",
      body: { query },
      signal: new AbortController().signal,
    });
  }
  let response = await request("{legacyData{viewer{generation id}}}");
  assert.deepEqual(JSON.parse(JSON.stringify((response!.body as any).data)), {
    legacyData: {
      viewer: { generation: "a".repeat(64), id: "original-reader" },
    },
  });
  subject = null;
  response = await request("{legacyData{viewer{generation id}}}");
  assert.equal((response!.body as any).data.legacyData.viewer.id, null);
  denied = true;
  assert.ok(
    ((await request("{legacyData{viewer{generation id}}}"))!.body as any).errors
      ?.length,
  );
  assert.equal(hostCalls, 0);
  await request("{legacyData{members{generation}}}");
  assert.equal(hostCalls, 1);
  const listing = await routes.handle({
    url: new URL("https://example.test/api/files/Page12/backends"),
    method: "GET",
    body: {},
    credential: "opaque",
    signal: new AbortController().signal,
  });
  assert.match(
    (listing!.body as any).backends[0].typeDefs,
    /viewer: DatasetViewer!/,
  );
  bound = false;
  assert.ok(
    ((await request("{legacyData{viewer{generation id}}}"))!.body as any).errors
      ?.length,
  );
  const unregistered = await routes.handle({
    url: new URL("https://example.test/api/files/Page12/backends"),
    method: "GET",
    body: {},
    credential: "opaque",
    signal: new AbortController().signal,
  });
  assert.equal((unregistered!.body as any).backends[0].typeDefs, info.typeDefs);
  assert.equal(deployment.typeDefs, info.typeDefs);
});
test("compatibility refuses altered sources, schemas, and versions before registry lookup", async () => {
  let calls = 0;
  const compatibility = createLegacyViewerCompatibility({
    current: async () => {
      calls++;
      return true;
    },
  });
  const input = {
    backendId: "Back12",
    backendVersion: deployment.version,
    pageId: "Page12",
    deployment,
    typeDefs: info.typeDefs,
  };
  for (const changed of [
    { typeDefs: info.typeDefs + " " },
    { deployment: { ...deployment, source: deployment.source + " " } },
    { backendVersion: "other" },
  ])
    assert.equal(
      await compatibility.schema(
        { ...input, ...changed },
        new AbortController().signal,
      ),
      null,
    );
  const unknown = sealDeployment(
    generatedDatasetBackendSource + "\n// authored change",
    "fixture",
    { typeDefs: info.typeDefs, fields: [...deployment.fields] },
  );
  assert.equal(
    await compatibility.schema(
      { ...input, deployment: unknown, backendVersion: unknown.version },
      new AbortController().signal,
    ),
    null,
  );
  assert.equal(calls, 0);
});
