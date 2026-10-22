import test from "node:test";
import assert from "node:assert/strict";
import { datasetSqlDockerArguments } from "../src/backend/dataset-sql-executor.ts";
test("fixed SQL container has hard resource limits and no writable credentials, mounts or network", () => {
  const args = datasetSqlDockerArguments(
    "name",
    "sha256:" + "a".repeat(64),
    "example.backend=1",
  );
  assert.ok(args.includes("--network=none"));
  assert.ok(args.includes("--memory=256m"));
  assert.ok(args.includes("--memory-swap=256m"));
  assert.ok(args.includes("--cpus=1"));
  assert.ok(args.includes("--read-only"));
  assert.ok(args.includes("--cap-drop=ALL"));
  assert.equal(
    args.some(
      (v) => v === "-v" || v === "--mount" || v === "--env" || v === "-e",
    ),
    false,
  );
});
