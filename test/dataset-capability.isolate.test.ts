import test from "node:test";
import assert from "node:assert/strict";
import { createBackendHost } from "../src/backend/container-host.ts";
import { datasetCapabilityHandler } from "../src/datasets/capability.ts";
import { generatedDatasetBackendSource } from "../src/migration/datasets/import-metadata.ts";
test("real backend isolate reads only explicit dataset capability bindings for its captured viewer", async () => {
  const host = createBackendHost({ sandboxNetwork: "none" });
  try {
    const deployment = await host.compile(generatedDatasetBackendSource);
    const args = {
      binding: "data",
      schema: "public",
      table: "rows",
      offset: 0,
      limit: 2,
    };
    const context = {
      backendId: "Back12",
      backendVersion: deployment.version,
      pageId: "Page12",
      subject: null,
    };
    let calls = 0;
    const capabilities = datasetCapabilityHandler(
      {
        async read(actual, input) {
          assert.deepEqual(actual, context);
          assert.deepEqual(input, args);
          calls++;
          return {
            version: 4,
            schema: "public",
            table: "rows",
            columns: [{ name: "value", type: "number" }],
            rows: [{ value: 7 }],
            offset: 0,
            nextOffset: null,
            totalRows: 1,
          };
        },
      },
      context,
      async () => {
        throw Error("denied");
      },
    );
    const result = await host.invoke({
      deployment,
      principal: { tenant: "Page12", subject: null },
      input: { field: "read", args },
      capabilityHandler: capabilities,
      env: {},
      reuse: { kind: "one-shot" },
    });
    assert.deepEqual(result, {
      version: 4,
      schema: "public",
      table: "rows",
      columns: [{ name: "value", type: "number" }],
      rows: [{ value: 7 }],
      offset: 0,
      nextOffset: null,
      totalRows: 1,
    });
    assert.equal(calls, 1);
  } finally {
    await host.close?.();
  }
});
