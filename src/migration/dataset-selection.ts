import type { DatasetImportMetadata } from "../datasets/import-contracts.ts";
/** Only globally admitted page bindings can activate imported dataset authority. Raw archives remain complete. */
export function selectMigrationDatasetMetadata(
  metadata: DatasetImportMetadata,
  ready: ReadonlySet<string>,
): DatasetImportMetadata {
  const bindings = metadata.bindings.filter((b) => ready.has(b.page.id));
  const datasets = new Set(bindings.map((b) => b.dataset.id));
  return {
    ...metadata,
    bindings,
    attachments: metadata.attachments?.filter((r) =>
      bindings.some(
        (b) =>
          b.backendId === r.binding.backendId &&
          b.backendVersion === r.binding.backendVersion &&
          b.page.id === r.binding.page.id &&
          b.page.version === r.binding.page.version &&
          b.name === r.binding.name,
      ),
    ),
    personBindings: metadata.personBindings?.filter((p) =>
      bindings.some(
        (b) =>
          b.backendId === p.backendId &&
          b.backendVersion === p.backendVersion &&
          b.page.id === p.pageId &&
          b.page.version === p.pageVersion &&
          b.name === p.bindingName,
      ),
    ),
    operations: metadata.operations?.filter((r) =>
      bindings.some(
        (b) =>
          b.backendId === r.operation.backendId &&
          b.backendVersion === r.operation.backendVersion &&
          b.page.id === r.operation.page.id &&
          b.page.version === r.operation.page.version &&
          b.name === r.bindingName,
      ),
    ),
    pages: metadata.pages.filter((p) => ready.has(p.pageId)),
    resources: metadata.resources.filter((r) => datasets.has(r.legacyId)),
    versions: metadata.versions.filter((v) => datasets.has(v.legacyId)),
    acceptedJoins: metadata.acceptedJoins.filter((j) => ready.has(j.pageId)),
  };
}
