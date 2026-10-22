import { readsLegacyMembers } from "./conversion/compiled/members-source.ts";
import { catalogVersion, receiptMap } from "./datasets/catalog.ts";
import type { MigrationJobSource } from "./job-contracts.ts";
import type { MigrationBackendPage } from "./backend-preparation-contracts.ts";
/** Metadata-only preparation; the SQL authorizer detects actual physical relation reads. */
export async function readsMigrationMembers(
  source: MigrationJobSource,
  text: string,
  imports: MigrationBackendPage["revisions"][number]["imports"],
): Promise<boolean> {
  const catalogs = [];
  if (source.datasets) {
    const receipts = receiptMap(source.datasets.receipts);
    for (const binding of imports) {
      const row = (await source.readArtifact(binding.datasetLegacyId))
        .artifacts[0]!;
      if (row.version !== binding.datasetVersion)
        throw Error("Dataset head changed during members preparation");
      catalogs.push({
        name: binding.name,
        datasetLegacyId: row.id,
        tables: catalogVersion(row, row.id, receipts).tables,
      });
    }
  }
  return readsLegacyMembers(text, catalogs);
}
