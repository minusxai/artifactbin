import type { CompiledBackend, BackendHost } from "../backend/contracts.ts";
import type { DatasetImportBindingInput } from "./datasets/planner-contracts.ts";
import type { LegacyMutationDescriptor } from "./conversion/mutation-contracts.ts";
import type { DatasetOperationRegistration } from "../datasets/mutation/repository-contracts.ts";
import type { CompiledDatasetMutation } from "./conversion/compiled/dataset-mutations-contracts.ts";
import type { SqlReader } from "./contracts.ts";
export interface MigrationBackendPage {
  legacyId: string;
  pageId: string;
  owner: { kind: "user" | "token" | "group"; id: string };
  revisions: readonly {
    version: number;
    /** Exact archived source identity; required for persistent mutation publication. */
    editId?: string;
    mutations?: readonly LegacyMutationDescriptor[];
    /** Canonical source-declared current-page accepted membership relation. */
    readsMembers?: true;
    /** Read-only original viewer identity, current saved head only. */
    readsViewer?: true;
    imports: readonly {
      name: string;
      legacyRef: string;
      datasetLegacyId: string;
      datasetVersion: number;
    }[];
  }[];
}
export interface MigrationBackendPreparationInput {
  sourceNamespace: string;
  origin: string;
  /** Source-planned page/reserved IDs and unrelated known IDs. Replay uses the same immutable allocation inventory; own generated backend IDs are not re-added as collisions. */
  allocatedIds: readonly string[];
  pages: readonly MigrationBackendPage[];
}
export interface MigrationBackendReceipt {
  pageLegacyId: string;
  pageId: string;
  pageVersion: number;
  /** False records an empty backend set when this revision removed all Imports. */
  linked: boolean;
  owner: string;
  /** Present only when this revision declared the trusted membership relation. */
  members?: { sourceNamespace: string };
  viewer?: { sourceNamespace: string };
  backendId: string;
  backendNamespace: "legacyData";
  backendHref: string;
  sourceSha256: string;
  bundleSha256: string;
  deployment: CompiledBackend;
}
export interface MigrationBackendPreparation {
  receipts: readonly MigrationBackendReceipt[];
  bindings: readonly DatasetImportBindingInput[];
  /** Saved atomically with dataset bindings after canonical backend registration. */
  operations: readonly DatasetOperationRegistration[];
  /** Browser-safe projection; full registry descriptors must never reach generated HTML. */
  browserMutations: readonly {
    pageLegacyId: string;
    pageVersion: number;
    mutation: CompiledDatasetMutation;
  }[];
}
export interface MigrationBackendPreparationPorts {
  host?: BackendHost;
}
export interface MigrationBackendRegistrar {
  (db: SqlReader, receipts: readonly MigrationBackendReceipt[]): Promise<void>;
}
