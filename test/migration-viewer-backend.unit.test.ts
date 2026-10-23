import test from "node:test";
import assert from "node:assert/strict";
import { graphql } from "graphql";
import { boundedBackendSchema } from "../src/graphql/execution-policy.ts";
import { generatedDatasetBackendSource } from "../src/migration/datasets/import-metadata.ts";
import { generatedViewerBackendSource } from "../src/migration/viewer-backend.ts";
import { generatedSourceQueryBackendSource } from "../src/migration/source-query-backend.ts";

for (const source of [
  generatedDatasetBackendSource,
  generatedSourceQueryBackendSource,
]) {
  test("generated viewer variant executes the actual reader query through trusted capability", async () => {
    const module = await import(
      "data:text/javascript;base64," +
        Buffer.from(generatedViewerBackendSource(source)).toString("base64")
    );
    const schema = boundedBackendSchema(module.typeDefs);
    let calls = 0;
    let result: unknown = { generation: "a".repeat(64), id: "original-reader" };
    const rootValue = {
      viewer: () =>
        module.default.Query.viewer({}, null, {
          dataset: {
            viewer: async () => {
              calls++;
              if (result instanceof Error) throw result;
              return result;
            },
          },
        }),
    };
    const query = "{viewer{generation id}}";
    const mapped = await graphql({ schema, source: query, rootValue });
    assert.equal(mapped.errors, undefined);
    assert.deepEqual(JSON.parse(JSON.stringify(mapped.data)), {
      viewer: result,
    });
    result = { generation: "b".repeat(64), id: null };
    assert.deepEqual(
      JSON.parse(
        JSON.stringify(
          (await graphql({ schema, source: query, rootValue })).data,
        ),
      ),
      { viewer: result },
    );
    result = new Error("Reader unavailable");
    assert.ok(
      (await graphql({ schema, source: query, rootValue })).errors?.length,
    );
    assert.equal(calls, 3);
  });
}
