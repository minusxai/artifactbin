import type { SqlClient, SqlDatabase } from "./sql-contracts.ts";
import type { DatasetObjectStore } from "../datasets/object-store-contracts.ts";
import type {
  DatasetMutationOperation,
  DatasetMutationHead,
} from "../datasets/mutation/contracts.ts";
import type { DatasetOperationRegistration } from "../datasets/mutation/repository-contracts.ts";
import type { MutationOutcome } from "../datasets/sql/engine/sql-contracts.ts";
export interface DatasetMutationRepositoryOptions {
  database: SqlDatabase;
  /** The same immutable store used for persist; verifies committed bytes against actual engine rows. */
  objects: DatasetObjectStore;
  now?: () => number;
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
  head: DatasetMutationHead,
  outcome: Extract<MutationOutcome, { affected: number }>,
  now: number,
) => Promise<void>;
