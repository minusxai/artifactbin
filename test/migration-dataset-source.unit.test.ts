import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readMigrationDatasetSource } from "../src/migration/dataset-source.ts";
import type { StreamManifest } from "../src/migration/stream-contracts.ts";
test("dataset source verifies independent supplemental provenance and actual receipt bytes", async () => {
  const directory = await mkdtemp(join(tmpdir(), "dataset-source-"));
  const sha = (value: string) =>
    createHash("sha256").update(value).digest("hex");
  try {
    const base: StreamManifest = {
      schemaVersion: 2,
      sourceNamespace: "fixture",
      schema: "legacy",
      exportedAt: "2026-10-21T00:00:00.000Z",
      parts: [],
    };
    const relation = {
      ...base,
      exportedAt: "2026-10-22T00:00:00.000Z",
      supplemental: true,
      consistency: "independent-repeatable-read-read-only",
      supplementsExportedAt: base.exportedAt,
    };
    await mkdir(join(directory, "base"));
    await writeFile(
      join(directory, "base", "manifest.json"),
      JSON.stringify(base),
    );
    await writeFile(join(directory, "manifest.json"), JSON.stringify(relation));
    await writeFile(join(directory, "object"), "[]");
    const receipt = {
      objectKey: "dataset/" + "a".repeat(32),
      path: join(directory, "object"),
      status: "copied",
      bytes: 2,
      sha256: sha("[]"),
    };
    await writeFile(
      join(directory, "receipts.json"),
      JSON.stringify([receipt]),
    );
    const options = {
      baseDirectory: join(directory, "base"),
      base,
      relationDirectory: directory,
      receiptsPath: join(directory, "receipts.json"),
    };
    const result = await readMigrationDatasetSource(options);
    assert.equal(result.verifiedObjects, 1);
    assert.equal(result.verifiedBytes, 2);
    assert.equal(result.provenance.relationExportedAt, relation.exportedAt);
    assert.equal("path" in result.receipts[0]!, false);
    await writeFile(join(directory, "object"), "{}");
    await assert.rejects(readMigrationDatasetSource(options), /digest differs/);
    await writeFile(
      join(directory, "manifest.json"),
      JSON.stringify({ ...relation, supplementsExportedAt: "unrelated" }),
    );
    await assert.rejects(readMigrationDatasetSource(options), /provenance/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
