/** Offline-only native migration analysis. These contracts grant no destination or runtime authority. */
export interface NativeRevisionKey { sourceNamespace: string; sourceId: string; version: number }
export interface NativeCompilerIdentity {
  converterSha256: string;
  recoveryCompilerSha256: string;
  nativeModuleManifestSha256: string;
  graphqlContractSha256: string;
  expressionPolicySha256: string;
}
export interface NativeCanonicalReceipt {
  path: string; bytes: number; sha256: string; id: string;
  expectedVersion: number; distinctRevisions: number; archivedRows: number;
}
export interface NativeCanonicalManifest {
  createdAt: string;
  receipts: readonly NativeCanonicalReceipt[];
  failures: readonly unknown[];
}
export interface NativeSourceRow {
  id?: unknown; artifact_id?: unknown; version: number; document: unknown;
  [field: string]: unknown;
}
export interface NativeCanonicalPage {
  snapshot: unknown;
  heads: readonly NativeSourceRow[];
  versions: readonly NativeSourceRow[];
}
export interface NativeSelectedRevision {
  key: NativeRevisionKey;
  documentSha256: string;
  rowSha256: string;
  original: NativeSourceRow;
  matchingArchives: readonly NativeSourceRow[];
}
export interface NativeSelectedPage {
  sourceId: string; headVersion: number;
  sourceFile: NativeCanonicalReceipt;
  revisions: readonly NativeSelectedRevision[];
}
export interface NativeSelectionIndex {
  sourceNamespace: string; manifestSha256: string;
  pages: readonly NativeSelectedPage[];
  headCount: number; revisionCount: number;
}
/** Raw bytes permit independent hash validation before parsing any canonical page. */
export type NativeReadCanonicalFile = (relativePath: string) => Promise<Uint8Array>;
export interface NativeSelectionRequest {
  sourceNamespace: string;
  manifestBytes: Uint8Array;
  sourceIds: readonly string[];
  expectedHeads: number;
  expectedRevisions: number;
  readFile: NativeReadCanonicalFile;
}
export interface NativeGraphIdentity {
  /** Retained graph key, not an inferred DOM id or data-af-id. */
  sourceNode: string;
  parent: string | null;
  children: readonly string[];
  astSha256: string;
  nodeSha256: string;
  sourceStart: number;
  sourceEnd: number;
}
export interface NativeGraphAnalysis {
  key: NativeRevisionKey;
  documentSha256: string;
  sourceSha256: string;
  source: string;
  /** All graph nodes, including $root; no silently dropped disconnected nodes. */
  identities: readonly NativeGraphIdentity[];
  /** Reservations retained exactly; not interpreted as a node-to-DOM mapping. */
  claimedIds: Readonly<Record<string, unknown>>;
  components: Readonly<Record<string, number>>;
  recovery: { kind: 'exact' | 'proved-empty-separators'; repairedNodes: number };
}
export interface NativeRecoveryOptions {
  /** Optional independent canonical witness; never evaluate authored source. */
  oracle?: import('../conversion/document-recovery-contracts.ts').LegacyDocumentRecoveryOracle;
}
export type AnalyzeNativeRevision = (revision: NativeSelectedRevision, options?: NativeRecoveryOptions) => NativeGraphAnalysis;
