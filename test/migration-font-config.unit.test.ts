import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";

test("migration CLI rejects either incomplete explicit font bundle pair before opening source or destination", () => {
  for (const supplied of [
    "MIGRATION_FONT_BUNDLE_DIRECTORY",
    "MIGRATION_FONT_BUNDLE_MANIFEST_SHA256",
  ]) {
    const env = { ...process.env };
    delete env.MIGRATION_FONT_BUNDLE_DIRECTORY;
    delete env.MIGRATION_FONT_BUNDLE_MANIFEST_SHA256;
    env[supplied] = supplied.endsWith("DIRECTORY")
      ? "/nonexistent-font-bundle"
      : "a".repeat(64);
    const result = spawnSync(
      process.execPath,
      [
        "--experimental-strip-types",
        "scripts/migration/import-stream.ts",
        "/nonexistent-source",
        "/nonexistent-index",
        "migration_test",
        "/nonexistent-report",
      ],
      { env, encoding: "utf8" },
    );
    assert.notEqual(result.status, 0);
    assert.match(
      result.stderr,
      /Font bundle directory and manifest digest must be supplied together/,
    );
    assert.doesNotMatch(result.stderr, /ENOENT/);
  }
});
