import type { NativeCatalogUserRemap } from "./catalog-user-remap-contracts";
import type {NativeExternalConnectionReceipt} from './external-credential-contracts';
import type { Queryable } from "@artifactbin/contracts";
import type { NativeImportRelations } from "./contracts";
/** Raw canonical-export receipt; no inference, row samples or synthesized objects. */
export interface NativeCatalogObject {
  objectKey: string;
  targetKey: string;
  status: "copied";
  sha256: string;
  bytes: number;
  contentType?: string;
}
export interface NativeCatalogVersion {
  version: number;
  sourceSha256: string;
  source: string | null;
  meta: Record<string, unknown>;
  title: string | null;
  description: string | null;
  createdAt: string;
  actorUserId: string | null;
  actorTokenId: string | null;
}
export interface NativeCatalogDataset {
  relationsSha256: string;
  policyAudit: readonly {
    revision: number;
    policy: unknown;
    actorUserId: string | null;
    actorTokenId: string | null;
    createdAt: string;
  }[];
  sourceId: string;
  targetId: string;
  sourceSha256: string;
  currentVersion: number;
  expectedVersions: readonly number[];
  versions: readonly NativeCatalogVersion[];
  authority: {
    tokenId: string;
    userId: string | null;
    groupId: string | null;
    creatorUserId: string | null;
    ancestorIds: readonly string[];
    visibility: "public" | "unlisted" | "private";
    linkRole: "viewer" | "commenter" | "editor";
    access: "read" | "readwrite";
    /** External PostgreSQL catalogs require exact null; stored datasets retain policy validation. */
    datasetPolicy: unknown;
    sharingRevision: number;
    policyRevision: number;
    editId: string;
    createdAt: string;
    updatedAt: string;
    deletedAt: string | null;
    shares: readonly {
      email: string;
      role: "viewer" | "commenter" | "editor";
    }[];
  };
}
export interface NativeCatalogIdentityMap {
  users: Readonly<Record<string, string>>;
  tokens: Readonly<Record<string, string>>;
  groups: Readonly<Record<string, string>>;
  artifacts: Readonly<Record<string, string>>;
}
/** @public Projection-builder import contract. */
export interface NativeCatalogImport {
  pageId: string;
  pageVersion: number;
  backendId: string;
  backendVersion: string;
  alias: string;
  datasetId: string;
  table: string;
}
export interface NativeCatalogProjection {
  /** Omission preserves complete-history admission. Latest selects only each exact
   * canonical head and its current policy-revision audit row, when present; raw
   * export/relation receipts remain complete and digest-bound. */
  revisionScope?: "all" | "latest";
  /** Root-reviewed identity plan; required when deriving typed user objects. */
  identityPlanSha256?: string;
  typedUserRemaps?: readonly NativeCatalogUserRemap[];
  externalConnections?: readonly NativeExternalConnectionReceipt[];
  imports: readonly NativeCatalogImport[];
  identities: NativeCatalogIdentityMap;
  sourceNamespace: string;
  selectionSha256: string;
  sourceManifestSha256: string;
  objectManifestSha256: string;
  datasets: readonly NativeCatalogDataset[];
  objects: readonly NativeCatalogObject[];
  sha256: string;
}
/** Conditional publication is mandatory. An ordinary overwriting ObjectStore.put is insufficient. */
export interface NativeImmutableObjectSink {
  get(key: string): Promise<Buffer>;
  putIfAbsent(
    key: string,
    bytes: Buffer,
    contentType?: string,
  ): Promise<"created" | "exists">;
}
export interface NativeCatalogObjectSource {
  objectManifestSha256: string;
  relations?(dataset: NativeCatalogDataset): Promise<Buffer>;
  read(object: NativeCatalogObject): Promise<Buffer>;
  /** Raw canonical head/archive export bytes, checked before any staging. */ dataset?(
    dataset: NativeCatalogDataset,
  ): Promise<Buffer>;
}
/** Opaque staged capability; construction follows raw hash/size verification. */
export interface NativeStagedCatalog extends NativeImportRelations {
  readonly projectionSha256: string;
  readonly staged: readonly NativeCatalogObject[];
  readonly derivedUserObjects: readonly NativeCatalogUserRemap[];
  verifyObject(key: string, sha256: string, bytes: number): Promise<void>;
  apply(tx: Queryable, pageId: string): Promise<void>;
  verify(tx: Queryable, pageId: string): Promise<void>;
}

/** Dataset row identity excludes page-specific import aliases and reachable catalog subsets. */
export interface NativeCatalogDatasetIdentity {
 sourceNamespace:string;sourceId:string;selectionSha256:string;sourceManifestSha256:string;objectManifestSha256:string;
 datasetProjectionSha256:string;datasetSourceSha256:string;versionSourceSha256:string;
}

/** Read-only equivalence proof. Both catalog-wide source manifests remain explicit;
 * no persisted row or imported history is rewritten by comparison. */
export interface NativeCatalogRowEquivalence {
 equal: boolean;
 provenance?: {storedSourceManifestSha256:string; incomingSourceManifestSha256:string; datasetProjectionSha256:string};
}
