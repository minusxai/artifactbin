import type { CompiledBackend, BackendHost } from "../backend/contracts.ts";
import type { DatasetImportBindingInput } from "./datasets/planner-contracts.ts";
import type { LegacyMutationDescriptor } from "./conversion/mutation-contracts.ts";
import type { DatasetOperationRegistration } from "../datasets/mutation/repository-contracts.ts";
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
}
export interface MigrationBackendPreparationPorts {
  host?: BackendHost;
}
export interface MigrationBackendRegistrar {
  (db: SqlReader, receipts: readonly MigrationBackendReceipt[]): Promise<void>;
}
