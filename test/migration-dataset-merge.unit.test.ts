import test from "node:test";
import assert from "node:assert/strict";
import { mergeDatasetMetadata } from "../src/migration/dataset-metadata-merge.ts";
import type { DatasetImportMetadata } from "../src/datasets/import-contracts.ts";
const part = (): DatasetImportMetadata => ({
  sourceNamespace: "fixture",
  bindings: [],
  pages: [],
  resources: [],
  versions: [],
  principals: [
    {
      actor: "owner@example.test",
      kind: "user",
      legacyId: "original",
      identity: "user",
      expiresAt: null,
    },
  ],
  groups: [],
  acceptedJoins: [],
});
test("bounded dataset plans deduplicate identical authority and reject conflicting attribution independently of order", () => {
  const a = part(),
    b = part();
  assert.equal(mergeDatasetMetadata([a, b]).principals.length, 1);
  b.principals = [{ ...b.principals[0]!, actor: "other@example.test" }];
  assert.throws(() => mergeDatasetMetadata([a, b]), /Conflicting/);
  assert.throws(() => mergeDatasetMetadata([b, a]), /Conflicting/);
  assert.throws(
    () => mergeDatasetMetadata([a, { ...part(), sourceNamespace: "other" }]),
    /namespace/,
  );
});
