import type {
  NativePublicationBytes,
  NativePublicationCatalog,
  NativePublicationSharedInput,
} from "./pipeline-publication-contracts.ts";
/** Immutable current source capture; every head is checked against both complete raw receipts. */
export interface NativeCurrentCatalogCapture {
  sourceId: string;
  version: number;
  headSha256: string;
  source: { path: string; bytes: NativePublicationBytes };
  relations: { path: string; bytes: NativePublicationBytes };
  catalogSha256: string;
  policySha256: string;
}
export interface NativeCatalogMetadataReceipt {
  sourceId: string;
  version: number;
  sourceRowSha256: string;
  sourceMetaSha256: string;
  targetMetaSha256: string;
  meta: Record<string, unknown>;
}
export interface NativeCatalogInventoryInput {
  sourceNamespace: string;
  selectionSha256: string;
  sourceManifestSha256: string;
  identityPlan: NativePublicationSharedInput["identity"]["plan"];
  identityGroups?: Readonly<Record<string, string>>;
  captures: readonly NativeCurrentCatalogCapture[];
  /** Actual canonical object-receipts file; includes source bytes only, never credentials. */
  objectLedger: NativePublicationBytes;
  typedUserRemaps: readonly {
    sourceId: string;
    version: number;
    identityPlanSha256: string;
    [key: string]: unknown;
  }[];
  metadata: readonly NativeCatalogMetadataReceipt[];
  externalConnections: readonly {
    datasetSourceId: string;
    sourceSecretSha256: string;
  }[];
  root: string;
  ledgerPath: string;
  sinkDirectory: string;
}
export type BuildNativeCatalogInventory = (
  input: NativeCatalogInventoryInput,
) => NativePublicationCatalog;
