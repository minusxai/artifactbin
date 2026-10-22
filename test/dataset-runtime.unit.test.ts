import test from "node:test";
import { EventEmitter } from "node:events";
import { createServiceLifecycle } from "../src/server/service-lifecycle.ts";
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

test("attachment composition requires storage and processor together and closes the owned processor once", async () => {
  const database = {} as SqlDatabase;
  let closed = 0;
  const imageProcessor = {
    process: async () => {
      throw Error("unused");
    },
    close: async () => {
      closed++;
    },
  };
  assert.throws(() =>
    createDatasetRuntime({ database, attachmentDirectory: "/tmp/attachments" }),
  );
  assert.throws(() => createDatasetRuntime({ database, imageProcessor }));
  const runtime = createDatasetRuntime({
    database,
    attachmentDirectory: "/tmp/attachments",
    imageProcessor,
  });
  assert.ok(runtime.attachments);
  await Promise.all([runtime.close(), runtime.close()]);
  assert.equal(closed, 1);
});

test("configured attachment storage requires authenticated isolated image transport", async () => {
  assert.throws(() =>
    serviceConfig({ PAGEGI_DATASET_ATTACHMENT_DIRECTORY: "/tmp/attachments" }),
  );
  assert.throws(() =>
    serviceConfig({
      PAGEGI_DATASET_ATTACHMENT_DIRECTORY: "/tmp/attachments",
      PAGEGI_BACKEND_EXECUTOR: "docker",
    }),
  );
  const config = serviceConfig({
    PAGEGI_DATASET_ATTACHMENT_DIRECTORY: "/tmp/attachments",
    PAGEGI_BACKEND_EXECUTOR: "remote",
    PAGEGI_EXECUTION_ENDPOINT: "http://127.0.0.1:9000/v1/execute",
    PAGEGI_EXECUTION_SECRET: "s".repeat(32),
  });
  assert.equal(config.datasetAttachmentDirectory, "/tmp/attachments");
  assert.ok(config.datasetImageProcessor);
  await config.datasetImageProcessor.close();
  await config.backendHost?.close?.();
});

for (const failureMode of ["throw", "reject"] as const) {
  test(`dataset cleanup ${failureMode} waits for siblings before persistence closes`, async () => {
    const calls: string[] = [];
    const failure = Error("source pool cleanup failed");
    let release!: () => void;
    const pending = new Promise<void>((resolve) => {
      release = resolve;
    });
    const runtime = createDatasetRuntime({
      database: {} as SqlDatabase,
      sourceDirectory: "/tmp/source",
      mutationDirectory: "/tmp/overlay",
      sourceQueryResources: {
        pool: () => undefined,
        close: () => {
          calls.push("source");
          if (failureMode === "throw") throw failure;
          return Promise.reject(failure);
        },
      },
      executor: {
        execute: async () => {
          throw Error("unused");
        },
        close: async () => {
          calls.push("executor");
          await pending;
          calls.push("executor settled");
        },
      },
      attachmentDirectory: "/tmp/attachments",
      imageProcessor: {
        process: async () => {
          throw Error("unused");
        },
        close: async () => {
          calls.push("image");
          throw Error("secondary failure");
        },
      },
    });
    const first = runtime.close();
    assert.equal(runtime.close(), first);
    let settled = false;
    const rejected = assert
      .rejects(first, (error) => error === failure)
      .then(() => {
        settled = true;
      });
    const lifecycle = createServiceLifecycle({
      server: new EventEmitter(),
      invalidationReaders: [],
      live: { close() {}, changedAndWait() {} },
      runners: { close() {} },
      datasets: runtime,
      repository: {
        close() {
          calls.push("repository");
        },
      },
    });
    const outer = assert.rejects(
      lifecycle.close(),
      (error) => error === failure,
    );
    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.deepEqual(calls, ["source", "executor", "image"]);
    assert.equal(settled, false);
    release();
    await Promise.all([rejected, outer]);
    assert.deepEqual(calls, [
      "source",
      "executor",
      "image",
      "executor settled",
      "repository",
    ]);
    assert.equal(runtime.close(), first);
  });
}
