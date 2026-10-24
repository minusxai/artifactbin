import type { LegacyRow, MigrationMaps, PlannedPage } from "../contracts.ts";
import type { NativeSelectedPage } from "./contracts.ts";
import type {
  NativeV3AssemblyReceipt,
  NativeV3IdentityMaps,
  NativeV3HistoryImport,
  NativeV3PublicationHost,
} from "./v3-publication-contracts.ts";
export interface NativePublicationBytes {
  encoding: "base64";
  data: string;
  sha256: string;
}
/** Shared captured dataset inventory, not one handwritten projection per page. */
export interface NativePublicationCatalog {
  projection: {
    revisionScope: "latest";
    sourceNamespace: string;
    selectionSha256: string;
    identityPlanSha256: string;
    sourceManifestSha256: string;
    objectManifestSha256: string;
    identities: unknown;
    datasets: readonly {
      sourceId: string;
      targetId: string;
      currentVersion: number;
      expectedVersions: readonly number[];
      versions: readonly { version: number; meta: Record<string, unknown> }[];
      [key: string]: unknown;
    }[];
    objects: readonly { objectKey: string; [key: string]: unknown }[];
    typedUserRemaps?: readonly { sourceId: string; [key: string]: unknown }[];
    externalConnections?: readonly {
      datasetSourceId: string;
      [key: string]: unknown;
    }[];
    imports: readonly NativePublicationCatalogImport[];
    sha256: string;
  };
  root: string;
  ledgerPath: string;
  receipts: Readonly<
    Record<
      string,
      {
        path: string;
        sha256: string;
        relations: { path: string; sha256: string };
      }
    >
  >;
  sinkDirectory: string;
}
export interface NativePublicationCatalogImport {
  pageId: string;
  pageVersion: number;
  backendId: string;
  backendVersion: string;
  alias: string;
  datasetId: string;
  table: string;
}
export interface NativePublicationSharedInput {
  maps: MigrationMaps;
  targets: NativeV3IdentityMaps;
  identityGroups?: Readonly<Record<string, string>>;
  tokenOwners: readonly { id: string; user_id: string | null }[];
  identity: {
    plan: {
      sourceNamespace: string;
      sha256: string;
      targets: NativeV3IdentityMaps;
      artifactIds: Readonly<Record<string, string>>;
      [key: string]: unknown;
    };
    approvedPlanSha256: string;
    sourceInventory: unknown;
    targetInventory: unknown;
    revokedAt: string;
  };
  schemas: { appSchema: string; authSchema: string };
  catalog: NativePublicationCatalog;
  membership: {
    source: Readonly<Record<string, NativePublicationBytes>>;
    approved: Readonly<Record<string, string>>;
  };
}
export interface NativePublicationInput {
  selection: {
    sourceNamespace: string;
    manifestSha256: string;
    page: NativeSelectedPage;
  };
  assemblies: readonly NativeV3AssemblyReceipt[];
  /** Exact raw relation capture can contain other pages; planner/projector selects only this source. */
  relations: NativePublicationBytes;
  shared: NativePublicationSharedInput;
  exportedAt: string;
  coreUrl: string;
}
export interface NativePublicationCommentAnchor {
  version: number;
  sourceNamespace: string;
  sourceNodeId: string;
  quote: string;
}
export interface NativePublicationRelationProjection {
  history: NativeV3HistoryImport;
  bindings: readonly {
    version: number;
    htmlSha256: string;
    sourceNamespace: string;
    sourceNodeId: string;
    nodeId: string;
  }[];
  annotations: readonly (Record<string, unknown> & {
    anchor: NativePublicationCommentAnchor | null;
  })[];
  members: readonly [];
  images: readonly Record<string, unknown>[];
}
export interface NativeSerializedProductRecipe {
  revisionScope: "latest";
  history: NativeV3HistoryImport;
  relations: NativePublicationRelationProjection;
  identityGroups?: Readonly<Record<string, string>>;
  membership: {
    history: NativeV3HistoryImport;
    source: Readonly<Record<string, NativePublicationBytes>>;
    approved: Readonly<Record<string, string>>;
    identityPlan: NativePublicationSharedInput["identity"]["plan"];
  };
  identity: NativePublicationSharedInput["identity"];
  schemas: NativePublicationSharedInput["schemas"];
  catalog: NativePublicationCatalog;
}
export interface NativePublicationHost {
  /** Actual target runtime staging and canonical publication adapter; no destination database writes. */
  prepare(
    assemblies: readonly NativeV3AssemblyReceipt[],
    planned: PlannedPage,
  ): Promise<NativeV3PublicationHost>;
}
export interface NativePublicationResult {
  planned: PlannedPage;
  recipe: NativeSerializedProductRecipe;
  sha256: string;
}
