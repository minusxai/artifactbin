import type {
  DatasetMutationOperation,
  DatasetMutationPorts,
} from "./contracts.ts";
import type { SqlClient, SqlDatabase } from "../../persistence/sql.ts";
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
export interface DatasetMutationRepositoryOptions {
  database: SqlDatabase;
  /** The same immutable store used for persist; verifies committed bytes against actual engine rows. */
  objects: DatasetObjectStore;
  now?: () => number;
}
export interface DatasetMutationObjectStore extends DatasetObjectStore {
  persist(
    rows: readonly Record<string, unknown>[],
  ): Promise<DatasetTable["object"]>;
}
export type RegisterDatasetOperations = (
  client: SqlClient,
  registrations: readonly DatasetOperationRegistration[],
) => Promise<void>;
