import test from "node:test";
import assert from "node:assert/strict";
import { projectMigrationAttachmentBindings } from "../src/migration/attachment-bindings.ts";
import type { DatasetBinding } from "../src/datasets/contracts.ts";
const binding: DatasetBinding = {
  mode: "live",
  name: "images",
  backendId: "Back12",
  backendVersion: "a".repeat(64),
  page: { id: "Page12", version: 1, legacyId: "Legacy12", editId: "edit" },
  dataset: { id: "Data12", version: 1, policyRevision: 1 },
  tables: [],
};
const source =
  '<Helmet><Import name="images" src="ref:Data12"/></Helmet><Value name="files" type="string"/><FileUpload dataset="images" value="$files" accept="image/png"/><FileUpload dataset="images" value="$files" accept="image/jpeg"/>';
const input = {
  source,
  sourceNamespace: "original",
  pageId: "Page12",
  pageVersion: 1,
  bindings: [binding],
};
test("source-proven controls share one exact Import capability with union of declared MIME types", () => {
  const out = projectMigrationAttachmentBindings(input);
  assert.equal(out.length, 1);
  assert.deepEqual(out[0]!.acceptedTypes, ["image/jpeg", "image/png"]);
  assert.equal(out[0]!.binding, binding);
});
test("history, changed dataset identity or missing registration cannot gain upload authority", () => {
  for (const b of [
    { ...binding, mode: "pinned" as const },
    { ...binding, page: { ...binding.page, version: 2 } },
    { ...binding, dataset: { ...binding.dataset, id: "Other1" } },
  ])
    assert.throws(() =>
      projectMigrationAttachmentBindings({ ...input, bindings: [b] }),
    );
  assert.throws(() =>
    projectMigrationAttachmentBindings({ ...input, bindings: [] }),
  );
});
import { createDatasetMetadataAccumulator } from "../src/migration/dataset-metadata-merge.ts";
import { selectMigrationDatasetMetadata } from "../src/migration/dataset-selection.ts";
import { migrationDatasetTablePlans } from "../src/migration/dataset-table-plans.ts";
test("attachment registry participates in exact metadata union, admission selection and independent table verification", () => {
  const attachments = projectMigrationAttachmentBindings(input),
    accumulator = createDatasetMetadataAccumulator("original");
  const empty = accumulator.finish();
  accumulator.add({ ...empty, bindings: [binding], attachments });
  const metadata = accumulator.finish();
  assert.equal(metadata.attachments?.length, 1);
  assert.deepEqual(
    selectMigrationDatasetMetadata(metadata, new Set()).attachments,
    [],
  );
  const plans = migrationDatasetTablePlans({
    metadata,
    baseManifestSha256: "a".repeat(64),
    relationManifestSha256: "b".repeat(64),
    relationExportedAt: "2020-01-01T00:00:00.000Z",
  });
  assert.equal(
    plans.find((p) => p.table === "dataset_attachment_bindings")?.rows.length,
    1,
  );
});
