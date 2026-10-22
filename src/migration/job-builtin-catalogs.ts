import { catalogVersion, receiptMap } from "./datasets/catalog.ts";
import type { MigrationJobSource } from "./job-contracts.ts";
import type { MigrationBackendPage } from "./backend-preparation-contracts.ts";
import type { LegacyMutationImportCatalog } from "./conversion/mutation-contracts.ts";

/** Current immutable catalog metadata shared by parsed protected-service detection. */
export async function migrationBuiltinCatalogs(
  source: MigrationJobSource,
  imports: MigrationBackendPage["revisions"][number]["imports"],
): Promise<LegacyMutationImportCatalog[]> {
  const catalogs: LegacyMutationImportCatalog[] = [];
  if (source.datasets) {
    const receipts = receiptMap(source.datasets.receipts);
    for (const binding of imports) {
      const row = (await source.readArtifact(binding.datasetLegacyId))
        .artifacts[0]!;
      if (row.version !== binding.datasetVersion)
        throw Error("Dataset head changed during built-in service preparation");
      catalogs.push({
        name: binding.name,
        datasetLegacyId: row.id,
        tables: catalogVersion(row, row.id, receipts).tables,
      });
    }
  }
  return catalogs;
}
