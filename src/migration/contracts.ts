import type { BoundValueColumnProof } from "./conversion/compiled/bound-value-contracts.ts";
import type { CompiledDatasetMutation } from "./conversion/compiled/dataset-mutations-contracts.ts";
import type { MigrationBackendReceipt } from "./backend-preparation-contracts.ts";
import type { DatasetBrowserBinding } from "./datasets/planner-contracts.ts";
/** Offline migration records contain private content. Never commit exported manifests. */
export type LegacyRow = Record<string, unknown>;
export interface LegacyArtifact extends LegacyRow {
  id: string;
  format: string;
  version: number;
  user_id: string | null;
  group_id: string | null;
  token_id: string | null;
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
export interface ConversionInput {
  /** Trusted offline catalog facts; included in cache provenance, never browser data. */
  boundValueColumns?: readonly BoundValueColumnProof[];
  personBindings?: readonly { valueName: string; backendNamespace: string }[];
  datasetAttachments?: readonly {
    backendNamespace: string;
    bindingName: string;
  }[];
  viewerBinding?: import("./conversion/compiled/viewer-contracts.ts").CompiledViewerBinding;
  membersBinding?: { backendNamespace: string; backendHref: string };
  datasetUnavailable?: { reason: "historical-binding-unavailable" };
  datasetMutations?: readonly CompiledDatasetMutation[];
  datasetBindings?: readonly DatasetBrowserBinding[];
  resourceMap?: Readonly<Record<string, string>>;
  source: string;
  coreUrl: string;
  document?: unknown;
  meta?: Record<string, unknown>;
}
export interface ConversionOutput {
  /** Exact offline conversion producer; retaining a prior successful compiler never changes this receipt. */
  receipt?: {
    compilerIdentity: string;
    inputSha256: string;
    outputSha256: string;
  };
  classification: "renderable" | "functional" | "manual-blocked";
  html: string | null;
  outputBytes?: number;
  issues: readonly unknown[];
  identities: Record<string, string>;
  strategy?:
    | "strict"
    | "archived-static"
    | "archived-functional"
    | "media-wrapper";
  provenance?: { compiler: string; build: string; mode: string };
}
export type Converter = (
  input: ConversionInput,
) => ConversionOutput | Promise<ConversionOutput>;
export interface MigrationMaps {
  /** Only NULL user/group and NULL or empty token; never missing referenced identities. */
  orphans?: Record<string, string>;
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
  serverQueries?: readonly import("./query-preparation-contracts.ts").MigrationQueryReceipt[];
  backendAllocation?: { sourceNamespace: string; inventorySha256: string };
  backends?: readonly MigrationBackendReceipt[];
  legacyId: string;
  pageId: string;
  owner: { kind: "user" | "group" | "token" | "orphan"; id: string } | null;
  disposition: "ready" | "blocked";
  issues: string[];
  revisions: PlannedRevision[];
  /** Full original ACL; destination adapter must implement its exact semantics. */
  access: { visibility: string; linkRole: string; shares: LegacyRow[] };
  original: LegacyArtifact;
  assetDependencies?: string[];
  assets?: {
    revision: string;
    variant: "original" | "small";
    sha256: string;
    contentType: string;
    filename: string | null;
    bytes: number;
  }[];
  commentAssets?: readonly import("./assets/projection-contracts.ts").MigrationCommentAsset[];
  comments: LegacyRow[];
  unavailableCommentContexts?: {
    commentId: string;
    status: "unavailable";
    originalRevision: string;
    reason: "not-retained";
  }[];
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
  importPage(
    key: string,
    digest: string,
    page: PlannedPage,
  ): Promise<"created" | "unchanged">;
  supportsExactAccess(page: PlannedPage): boolean;
}
