import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, readdir, symlink, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createDatasetMutationObjectStore } from "../src/datasets/mutation/object-store.ts";
test("immutable mutation objects publish atomically, deduplicate, and reject non-scalar rows", async () => {
  const dir = await mkdtemp(join(tmpdir(), "dataset-write-"));
  try {
    const store = createDatasetMutationObjectStore(dir);
    const rows = [{ id: 1, name: "one", active: true, missing: null }];
    const [a, b] = await Promise.all([
      store.persist(rows),
      store.persist(rows),
    ]);
    assert.deepEqual(a, b);
    assert.equal(a.key, a.sha256);
    assert.deepEqual(
      JSON.parse(await readFile(join(dir, a.key), "utf8")),
      rows,
    );
    assert.deepEqual(await readdir(dir), [a.key]);
    await assert.rejects(store.persist([{ bad: { nested: true } }]));
    await assert.rejects(store.persist([{ bad: Number.NaN }]));
    await assert.rejects(
      store.persist(Array.from({ length: 10001 }, () => ({}))),
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
test("mutation writes reject symlink object roots and never follow an existing object symlink", async () => {
  const dir = await mkdtemp(join(tmpdir(), "dataset-write-"));
  try {
    const store = createDatasetMutationObjectStore(dir),
      object = await store.persist([]);
    await rm(join(dir, object.key));
    await symlink("/etc/hosts", join(dir, object.key));
    await assert.rejects(store.persist([]));
    await symlink(dir, join(dir, "root-link"));
    await assert.rejects(
      createDatasetMutationObjectStore(join(dir, "root-link")).persist([]),
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
