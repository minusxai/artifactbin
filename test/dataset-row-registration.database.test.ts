import test from "node:test";
import assert from "node:assert/strict";
import { fixture, binding, context } from "./dataset-runtime-fixture.ts";
import { createSqlDatabase } from "../src/persistence/sql.ts";
import { registerDatasetMutationOperations } from "../src/persistence/dataset-mutations.ts";
import type { DatasetMutationOperation } from "../src/datasets/mutation/contracts.ts";
test("registry preserves nullable row bindings exactly and refuses mismatched or authority-bound maps", async () => {
  const { env } = await fixture();
  try {
    const database = createSqlDatabase({
      pool: env.pool,
      initialize: async () => {},
      statementTimeoutMs: 15000,
    });
    const operation: DatasetMutationOperation = {
      name: "save",
      backendId: context.backendId,
      backendVersion: context.backendVersion,
      page: binding.page,
      datasetId: binding.dataset.id,
      target: { schema: "public", table: "rows" },
      sql: "UPDATE rows SET name=$row__name",
      paramTypes: { row__name: null },
      rowParams: { name: { param: "row__name", type: null } },
      conflictMode: "refuse",
    };
    const register = (value: DatasetMutationOperation) =>
      database.transaction((client) =>
        registerDatasetMutationOperations(client, [
          { sourceNamespace: "legacy", bindingName: "sales", operation: value },
        ]),
      );
    await register(operation);
    const stored = (
      await env.pool.query(
        "SELECT operation FROM dataset_mutation_operations WHERE name=$1",
        ["save"],
      )
    ).rows[0].operation;
    assert.deepEqual(stored.paramTypes, { row__name: null });
    assert.deepEqual(stored.rowParams, operation.rowParams);
    await assert.rejects(
      register({
        ...operation,
        name: "badType",
        rowParams: { name: { param: "row__name", type: "string" } },
      }),
    );
    await assert.rejects(
      register({
        ...operation,
        name: "badAuthority",
        paramTypes: { _me__userId: null },
        rowParams: { name: { param: "_me__userId", type: null } },
      }),
    );
  } finally {
    await env.cleanup();
  }
});
