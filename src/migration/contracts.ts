/** Offline migration records contain private content. Never commit exported manifests. */
export type LegacyRow = Record<string, unknown>;
export interface LegacyArtifact extends LegacyRow {
  id: string;
  format: string;
  version: number;
  user_id: string | null;
  group_id: string | null;
  token_id: string;
  source: string | null;
  document: unknown;
  visibility: string;
  link_role: string | null;
}
export interface MigrationManifest {
  schemaVersion: 1;
  sourceNamespace: string;
  exportedAt: string;
  tables: Record<string, LegacyRow[]>;
  artifacts: LegacyArtifact[];
  /** Nonsecret token handles and ownership only; never credential hashes. */
  tokenOwners: { id: string; user_id: string | null }[];
}
export interface SqlReader {
  query(sql: string, values?: unknown[]): Promise<{ rows: LegacyRow[] }>;
}
export interface ConversionInput { resourceMap?:Readonly<Record<string,string>>; source: string; coreUrl: string; document?: unknown; meta?: Record<string,unknown> }
export interface ConversionOutput {
  classification: 'renderable' | 'functional' | 'manual-blocked';
  html: string | null;
  outputBytes?:number;
  issues: readonly unknown[];
  identities: Record<string, string>;
  strategy?: 'strict'|'archived-static'|'media-wrapper';
  provenance?: {compiler:string;build:string;mode:string};
}
export type Converter = (input: ConversionInput) => ConversionOutput | Promise<ConversionOutput>;
export interface MigrationMaps {
  pages: Record<string, string>;
  users: Record<string, string>;
  groups: Record<string, string>;
  tokens: Record<string, string>;
}
export interface PlannedRevision {
  version: number;
  original: LegacyRow;
  /** Redundant legacy archive row sharing the exact head content/version. */
  matchingArchives?: LegacyRow[];
  conversion: ConversionOutput;
}
export interface PlannedPage {
  legacyId: string;
  pageId: string;
  owner: { kind: 'user' | 'group' | 'token'; id: string } | null;
  disposition: 'ready' | 'blocked';
  issues: string[];
  revisions: PlannedRevision[];
  /** Full original ACL; destination adapter must implement its exact semantics. */
  access: { visibility: string; linkRole: string; shares: LegacyRow[] };
  original: LegacyArtifact;
  assets?: {revision:string;variant:'original'|'small';sha256:string;contentType:string;filename:string|null;bytes:number}[];
  comments: LegacyRow[];
  unavailableCommentContexts?: {commentId:string;status:'unavailable';originalRevision:string;reason:'not-retained'}[];
  identities: LegacyRow[];
}
export interface MigrationPlan {
  schemaVersion: 1;
  sourceNamespace: string;
  maps: MigrationMaps;
  pages: PlannedPage[];
  /** All source rows retained, including data, edits, memberships and deleted records. */
  archive: MigrationManifest;
}
export interface ImportDestination {
  /** Must transact content, all revisions, identities, comments and receipt atomically.
   * Same key+digest is a no-op; a changed digest must fail rather than overwrite. */
  importPage(key: string, digest: string, page: PlannedPage): Promise<'created' | 'unchanged'>;
  supportsExactAccess(page: PlannedPage): boolean;
}
