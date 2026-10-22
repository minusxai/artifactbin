import test from "node:test";
import assert from "node:assert/strict";
import { serviceConfig } from "../src/config.js";
import { createDatasetRuntime } from "../src/server/dataset-runtime.ts";
import type { SqlDatabase } from "../src/persistence/sql.ts";
test("mutation composition requires readonly source and authenticated remote execution configuration", async () => {
  const base = {
    PAGEGI_DATASET_MUTATION_DIRECTORY: "/tmp/overlay",
    PAGEGI_DATASET_DIRECTORY: "/tmp/source",
  };
  for (const env of [
    base,
    { ...base, PAGEGI_BACKEND_EXECUTOR: "docker" },
    { ...base, PAGEGI_BACKEND_EXECUTOR: "remote" },
    {
      ...base,
      PAGEGI_BACKEND_EXECUTOR: "remote",
      PAGEGI_EXECUTION_ENDPOINT: "http://127.0.0.1:9000/v1/execute",
      PAGEGI_EXECUTION_SECRET: "s".repeat(32),
      PAGEGI_DATASET_DIRECTORY: "",
    },
  ])
    assert.throws(() => serviceConfig(env));
  const config = serviceConfig({
    ...base,
    PAGEGI_BACKEND_EXECUTOR: "remote",
    PAGEGI_EXECUTION_ENDPOINT: "http://127.0.0.1:9000/v1/execute",
    PAGEGI_EXECUTION_SECRET: "s".repeat(32),
  });
  assert.equal(
    config.datasetMutationDirectory,
    base.PAGEGI_DATASET_MUTATION_DIRECTORY,
  );
  assert.ok(config.datasetSqlExecutor);
  await config.datasetSqlExecutor.close();
  await config.backendHost?.close?.();
  let closed = 0;
  const executor = {
    execute: async () => {
      throw Error();
    },
    close: async () => {
      closed++;
    },
  };
  const database = {} as SqlDatabase;
  assert.throws(() =>
    createDatasetRuntime({ database, mutationDirectory: "/tmp/overlay" }),
  );
  const runtime = createDatasetRuntime({
    database,
    sourceDirectory: "/tmp/source",
    mutationDirectory: "/tmp/overlay",
    executor,
  });
  assert.ok(runtime.mutations);
  await Promise.all([runtime.close(), runtime.close()]);
  assert.equal(closed, 1);
});
