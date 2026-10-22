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

/** Loads current original-user and document-membership facts under the caller's
 * commit transaction, then validates actual assigned user fields. */
export type ValidateDatasetUserWrites = (
  client: SqlClient,
  context: { namespace: string; operation: DatasetMutationOperation },
  head: import("./contracts.ts").DatasetMutationHead,
  outcome: Extract<
    import("../sql/engine/sql-contracts.ts").MutationOutcome,
    { affected: number }
  >,
  now: number,
) => Promise<void>;
