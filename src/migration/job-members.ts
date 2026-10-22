import { readsLegacyMembers } from "./conversion/compiled/members-source.ts";
import { migrationBuiltinCatalogs } from "./job-builtin-catalogs.ts";
import type { MigrationJobSource } from "./job-contracts.ts";
import type { MigrationBackendPage } from "./backend-preparation-contracts.ts";
export async function readsMigrationMembers(
  source: MigrationJobSource,
  text: string,
  imports: MigrationBackendPage["revisions"][number]["imports"],
): Promise<boolean> {
  return readsLegacyMembers(
    text,
    await migrationBuiltinCatalogs(source, imports),
  );
}
