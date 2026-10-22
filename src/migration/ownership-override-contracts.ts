/** Trusted operator input, never accepted from imported page content. */
export interface MigrationOwnershipOverride {
  schemaVersion: 1;
  sourceNamespace: string;
  targetEmail: string;
  entries: readonly { legacyId: string; sourceSha256: string }[];
  datasetWriteGrants?: readonly import("./ownership-dataset-grants-contracts.ts").MigrationOwnershipDatasetWriteGrant[];
  scopeSha256: string;
}
export interface MigrationOwnershipAssignment {
  sourceNamespace: string;
  legacyId: string;
  sourceSha256: string;
  scopeSha256: string;
  originalOwner: { kind: "user" | "group" | "token" | "orphan"; id: string };
  assignedOwner: { kind: "user"; id: string };
}
