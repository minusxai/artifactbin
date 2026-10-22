import test from "node:test";
import assert from "node:assert/strict";
import {
  mkdtemp,
  writeFile,
  symlink,
  mkdir,
  rm,
  truncate,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createReadonlyDatasetObjectStore } from "../src/datasets/object-store.ts";
import { DATASET_OBJECT_BYTES } from "../src/datasets/contracts.ts";
test("dataset object mount admits only bounded regular full-SHA objects, never traversal or symlinks", async () => {
  const root = await mkdtemp(join(tmpdir(), "dataset-object-"));
  try {
    const key = "a".repeat(64),
      linked = "b".repeat(64),
      directory = "c".repeat(64),
      huge = "d".repeat(64);
    await writeFile(join(root, key), '[{"value":1}]');
    await symlink(join(root, key), join(root, linked));
    await mkdir(join(root, directory));
    await writeFile(join(root, huge), "");
    await truncate(join(root, huge), DATASET_OBJECT_BYTES + 1);
    const store = createReadonlyDatasetObjectStore(root);
    const chunks: Uint8Array[] = [];
    for await (const chunk of await store.read(key)) chunks.push(chunk);
    assert.equal(Buffer.concat(chunks).toString(), '[{"value":1}]');
    for (const invalid of [
      "../" + key,
      "/" + key,
      key + ".json",
      "e".repeat(64),
      linked,
      directory,
      huge,
    ])
      await assert.rejects(store.read(invalid), { code: "invalid_dataset" });
    const controller = new AbortController();
    controller.abort();
    await assert.rejects(store.read(key, controller.signal), {
      name: "AbortError",
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
