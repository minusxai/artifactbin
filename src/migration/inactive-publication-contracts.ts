/** Migration-only evidence for an exact archived deleted HEAD. Never grants runtime access. */
export interface DeletedMigrationPublicationContext {
  kind: "deleted-migration-publication-v1";
  schema: string;
  sourceNamespace: string;
  archiveDigest: string;
  admissionSha256: string;
  legacyId: string;
  pageId: string;
  headVersion: number;
  deletedAt: string;
  artifactSha256: string;
}
export interface MigrationPublicationTuple {
  backendId: string;
  backendVersion: string;
  pageId: string;
  pageVersion: number;
  sourceNamespace: string;
}
