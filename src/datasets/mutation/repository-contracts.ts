import type {
  DatasetMutationOperation,
  DatasetMutationPorts,
} from "./contracts.ts";
import type { DatasetObjectStore } from "../object-store-contracts.ts";
import type { DatasetTable } from "../contracts.ts";
/** Registration is a trusted publication transaction, never a runtime request. */
export interface DatasetOperationRegistration {
  sourceNamespace: string;
  bindingName: string;
  operation: DatasetMutationOperation;
}
export type DatasetMutationRepository = Pick<
  DatasetMutationPorts,
  "operation" | "begin" | "head" | "commit" | "refuse"
>;
export interface DatasetMutationObjectStore extends DatasetObjectStore {
  persist(
    rows: readonly Record<string, unknown>[],
  ): Promise<DatasetTable["object"]>;
}
