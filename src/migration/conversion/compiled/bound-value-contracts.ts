import type { UserConstraints } from "../../../datasets/sql/engine/sql-contracts.ts";
/** Migration-time authority facts only. Never serialize this registry in page HTML. */
export interface BoundValueColumnProof {
  valueName: string;
  sourceRef: string;
  version: number;
  bindingName: string;
  schema: string;
  table: "rows";
  column: string;
  type: "user";
  constraints?: UserConstraints;
}
/** Immutable readable catalog snapshot selected by the migration importer. */
export interface BoundValueCatalog {
  bindingName: string;
  sourceRef: string;
  version: number;
  tables: readonly {
    schema: string;
    name: string;
    columns: readonly {
      name: string;
      type: string;
      constraints?: UserConstraints;
    }[];
  }[];
}
export type ReadBoundValueColumnProofs = (
  source: string,
  catalogs: readonly BoundValueCatalog[],
) => readonly BoundValueColumnProof[];
