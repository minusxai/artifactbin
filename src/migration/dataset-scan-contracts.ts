import type { MigrationBackendPage } from "./backend-preparation-contracts.ts";
export interface MigrationDatasetImportScan {
  pages: readonly MigrationBackendPage[];
  /** Private diagnostic keys use original identity; report only aggregates outside private files. */
  heads: ReadonlyMap<string, number>;
  historicalImportVersions: ReadonlyMap<string, readonly number[]>;
  issues: ReadonlyMap<string, readonly string[]>;
  statistics: {
    pagesWithImports: number;
    pagesWithMembers: number;
    headImports: number;
    historicalImports: number;
    groupOwnedPages: number;
    unresolvedPages: number;
  };
}
