import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  discoverAcceptanceTests,
  discoverTests,
} from "../scripts/testing/inventory.ts";
test("filesystem discovery includes new nested tests and refuses an unclassified addition", () => {
  const root = mkdtempSync(join(tmpdir(), "pagegi-test-discovery-"));
  try {
    mkdirSync(join(root, "test", "new-module"), { recursive: true });
    writeFileSync(join(root, "test", "new-module", "example.unit.test.ts"), "");
    assert.deepEqual(
      discoverTests(root).map((test) => test.file),
      ["test/new-module/example.unit.test.ts"],
    );
    writeFileSync(join(root, "test", "new-module", "forgotten.test.js"), "");
    assert.throws(
      () => discoverTests(root),
      /Declare a test capability.*forgotten/,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
test("v2 acceptance tests run in every stage and can be selected on their own", () => {
  const root = mkdtempSync(join(tmpdir(), "pagegi-test-discovery-"));
  try {
    mkdirSync(join(root, "test", "v2", "page"), { recursive: true });
    writeFileSync(join(root, "test", "current.unit.test.ts"), "");
    writeFileSync(join(root, "test", "v2", "page", "model.unit.test.ts"), "");
    assert.deepEqual(
      discoverTests(root).map((test) => test.file),
      ["test/current.unit.test.ts", "test/v2/page/model.unit.test.ts"],
    );
    assert.deepEqual(
      discoverAcceptanceTests(root).map((test) => test.file),
      ["test/v2/page/model.unit.test.ts"],
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
