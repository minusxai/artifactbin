import test from "node:test";
import assert from "node:assert/strict";
import type { DatasetMutationOperation } from "../src/datasets/mutation/contracts.ts";
import type { SqlClient } from "../src/persistence/sql-contracts.ts";
import { registerDatasetMutationOperations } from "../src/persistence/dataset-mutations.ts";
const operation: DatasetMutationOperation = {
  name: "save",
  backendId: "Backend12",
  backendVersion: "a".repeat(64),
  page: { id: "Page12", version: 1, legacyId: "Legacy12", editId: "edit" },
  datasetId: "dataset",
  target: { schema: "public", table: "rows" },
  sql: "update data.rows set value=$cell__value",
  paramTypes: { cell__value: "number" },
  valueParam: { param: "cell__value", type: "number" },
  conflictMode: "refuse",
};
test("publication validates immutable cell metadata before accessing a binding or storing an operation", async () => {
  for (const valueParam of [
    { param: "cell__value", type: null },
    { param: "other", type: "number" },
    { param: "cell__value", type: "string" },
    { param: "cell__value", type: "number", extra: true },
  ]) {
    let queries = 0;
    const client = {
      query: async () => {
        queries++;
        throw Error("must not query");
      },
    } as unknown as SqlClient;
    await assert.rejects(
      registerDatasetMutationOperations(client, [
        {
          sourceNamespace: "test",
          bindingName: "data",
          operation: { ...operation, valueParam } as DatasetMutationOperation,
        },
      ]),
      /denied/,
    );
    assert.equal(queries, 0);
  }
  let queries = 0;
  const client = {
    query: async () => {
      queries++;
      return { rows: [] };
    },
  } as unknown as SqlClient;
  // Valid cell metadata still requires an existing, authorized source-pinned binding.
  await assert.rejects(
    registerDatasetMutationOperations(client, [
      { sourceNamespace: "test", bindingName: "data", operation },
    ]),
    /denied/,
  );
  assert.equal(queries, 1);
});
