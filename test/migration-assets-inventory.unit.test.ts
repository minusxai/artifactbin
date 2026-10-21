import test from "node:test";
import assert from "node:assert/strict";
import {
  inventoryAssets,
  type AssetArchiveRow,
} from "../src/migration/assets/inventory.ts";
const key = `image/${"a".repeat(32)}`;
async function* rows(input: AssetArchiveRow[]) {
  yield* input;
}
test("inventory maps actual head and archived schemas without retaining source", async () => {
  const result = await inventoryAssets(
    rows([
      {
        table: "artifacts",
        row: {
          id: "sample",
          version: 3,
          format: "image",
          source: "private ignored source",
          meta: { objectKey: key, bytes: 12, contentType: "image/webp" },
        },
      },
      {
        table: "artifact_versions",
        row: {
          artifact_id: "sample",
          version: 1,
          format: "image",
          meta: { objectKey: key, bytes: 12, contentType: "image/webp" },
        },
      },
      {
        table: "artifacts",
        row: {
          id: "doc",
          version: 1,
          format: "markup",
          source: "ref:external",
        },
      },
    ]),
  );
  assert.equal(result.summary.rowsScanned, 3);
  assert.equal(result.summary.assetHeads, 1);
  assert.equal(result.summary.assetVersions, 1);
  assert.equal(result.plan.objects.length, 1);
  assert.deepEqual(
    result.plan.objects[0]?.references.map((r) => r.version),
    [3, 1],
  );
  assert.equal(result.summary.knownBytes, 12);
  assert.equal(
    JSON.stringify(result).includes("private ignored source"),
    false,
  );
});
test("invalid snapshots produce bounded structured warnings while valid assets survive", async () => {
  const result = await inventoryAssets(
    rows([
      {
        table: "artifacts",
        row: {
          id: "external",
          version: 1,
          format: "image",
          meta: { url: "https://example.test/photo" },
        },
      },
      {
        table: "artifact_versions",
        row: {
          artifact_id: "bad",
          version: 0,
          format: "pdf",
          meta: { objectKey: `pdf/${"b".repeat(32)}` },
        },
      },
      {
        table: "artifacts",
        row: {
          id: "image",
          version: 1,
          format: "image",
          meta: { objectKey: "https://example.test/secret" },
        },
      },
      {
        table: "artifacts",
        row: {
          id: "good",
          version: 1,
          format: "image",
          meta: { objectKey: key, bytes: 12 },
        },
      },
    ]),
  );
  assert.equal(result.summary.acceptedSnapshots, 1);
  assert.equal(result.summary.warnings.missing_object_key, 1);
  assert.equal(result.summary.warnings.invalid_identity, 1);
  assert.equal(result.summary.warnings.invalid_asset_metadata, 1);
  assert.equal(result.plan.objects.length, 1);
  assert.equal(JSON.stringify(result.warnings).includes("https://"), false);
});
test("conflicting shared keys are withheld completely and every affected reference is reported", async () => {
  const result = await inventoryAssets(
    rows([
      {
        table: "artifacts",
        row: {
          id: "one",
          version: 1,
          format: "image",
          meta: { objectKey: key, bytes: 12 },
        },
      },
      {
        table: "artifact_versions",
        row: {
          artifact_id: "two",
          version: 2,
          format: "image",
          meta: { objectKey: key, bytes: 13 },
        },
      },
      {
        table: "artifact_versions",
        row: {
          artifact_id: "three",
          version: 1,
          format: "image",
          meta: { objectKey: key, bytes: 12 },
        },
      },
    ]),
  );
  assert.equal(result.plan.objects.length, 0);
  assert.equal(result.summary.warnings.conflicting_object_metadata, 3);
  assert.equal(result.warnings.length, 3);
});
