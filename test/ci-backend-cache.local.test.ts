import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, renameSync, rmSync, mkdirSync, chmodSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { backendContextFingerprint } from "../scripts/ci/backend-cache.ts";
test("backend image cache tracks the complete context and execution platform", () => {
  const root = mkdtempSync(join(tmpdir(), "pagegi-ci-context-"));
  try {
    const options = { root, platform: "linux", architecture: "x64" };
    writeFileSync(join(root, "Dockerfile"), "FROM scratch\n");
    writeFileSync(join(root, "entry.mjs"), "export {};\n");
    const initial = backendContextFingerprint(options);
    assert.equal(backendContextFingerprint(options), initial);
    assert.notEqual(backendContextFingerprint({ ...options, architecture: "arm64" }), initial);
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
  } finally { rmSync(root, { recursive: true, force: true }); }
});
