import { readsLegacyViewer } from "./conversion/compiled/viewer-source.ts";
import { migrationBuiltinCatalogs } from "./job-builtin-catalogs.ts";
import type { MigrationJobSource } from "./job-contracts.ts";
import type { MigrationBackendPage } from "./backend-preparation-contracts.ts";
/** Detects original viewer identity reads without granting browser-selected subjects. */
export async function readsMigrationViewer(
  source: MigrationJobSource,
  text: string,
  imports: MigrationBackendPage["revisions"][number]["imports"],
): Promise<boolean> {
  return readsLegacyViewer(
    text,
    await migrationBuiltinCatalogs(source, imports),
  );
}
