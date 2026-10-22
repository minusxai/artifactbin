import { test } from "node:test";
import assert from "node:assert/strict";
import {
  mkdtempSync,
  writeFileSync,
  renameSync,
  rmSync,
  mkdirSync,
  chmodSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  backendContextFingerprint,
  datasetSqlContextFingerprint,
  imageProcessorContextFingerprint,
} from "../scripts/ci/backend-cache.ts";
test("backend image cache tracks the complete context and execution platform", () => {
  const root = mkdtempSync(join(tmpdir(), "pagegi-ci-context-"));
  try {
    const options = { root, platform: "linux", architecture: "x64" };
    writeFileSync(join(root, "Dockerfile"), "FROM scratch\n");
    writeFileSync(join(root, "entry.mjs"), "export {};\n");
    const initial = backendContextFingerprint(options);
    assert.equal(backendContextFingerprint(options), initial);
    assert.notEqual(
      backendContextFingerprint({ ...options, architecture: "arm64" }),
      initial,
    );
    writeFileSync(join(root, "entry.mjs"), "export const value = 1;\n");
    const changed = backendContextFingerprint(options);
    assert.notEqual(changed, initial);
    renameSync(join(root, "entry.mjs"), join(root, "supervisor.mjs"));
    assert.notEqual(backendContextFingerprint(options), changed);
    const renamed = backendContextFingerprint(options);
    writeFileSync(join(root, ".dockerignore"), "excluded\n");
    assert.notEqual(backendContextFingerprint(options), renamed);
    const hidden = backendContextFingerprint(options);
    mkdirSync(join(root, "nested"));
    writeFileSync(join(root, "nested", "future.mjs"), "export {};\n");
    assert.notEqual(backendContextFingerprint(options), hidden);
    const nested = backendContextFingerprint(options);
    chmodSync(join(root, "nested", "future.mjs"), 0o755);
    assert.notEqual(backendContextFingerprint(options), nested);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("image processor cache changes with decoder sources, dependencies and platform", () => {
  const root = mkdtempSync(join(tmpdir(), "image-cache-"));
  try {
    mkdirSync(join(root, "src/media/image-processing/container"), {
      recursive: true,
    });
    writeFileSync(join(root, ".dockerignore"), "node_modules");
    const options = { root, platform: "linux", architecture: "x64" };
    let previous = imageProcessorContextFingerprint(options);
    for (const file of [
      "engine.ts",
      "contracts.ts",
      "container/entry.mjs",
      "container/package-lock.json",
      "container/Dockerfile",
    ]) {
      writeFileSync(join(root, "src/media/image-processing", file), "changed");
      const current = imageProcessorContextFingerprint(options);
      assert.notEqual(current, previous);
      previous = current;
    }
    assert.notEqual(
      imageProcessorContextFingerprint({ ...options, architecture: "arm64" }),
      previous,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("dataset SQL image cache follows each copied source dependency", () => {
  const root = mkdtempSync(join(tmpdir(), "dataset-sql-cache-"));
  try {
    mkdirSync(join(root, "src/datasets/sql/container"), { recursive: true });
    mkdirSync(join(root, "src/datasets/mutation"), { recursive: true });
    writeFileSync(join(root, ".dockerignore"), "node_modules");
    writeFileSync(
      join(root, "src/datasets/sql/container/Dockerfile"),
      "FROM node",
    );
    writeFileSync(
      join(root, "src/datasets/mutation/contracts.ts"),
      "contract-v1",
    );
    const options = { root, platform: "linux", architecture: "x64" };
    const initial = datasetSqlContextFingerprint(options);
    writeFileSync(
      join(root, "src/datasets/mutation/contracts.ts"),
      "contract-v2",
    );
    assert.notEqual(datasetSqlContextFingerprint(options), initial);
    const changed = datasetSqlContextFingerprint(options);
    writeFileSync(join(root, "src/datasets/sql/engine.ts"), "engine-v2");
    assert.notEqual(datasetSqlContextFingerprint(options), changed);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
