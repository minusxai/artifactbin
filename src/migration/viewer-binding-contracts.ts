/** Immutable provenance for one current page revision's read-only viewer capability. */
export interface MigrationViewerBinding {
  backendId: string;
  backendVersion: string;
  pageId: string;
  pageVersion: number;
  sourceNamespace: string;
}
