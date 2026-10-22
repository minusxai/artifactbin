import type { SqlClient } from "./af-backend-contracts.ts";
/** Store state is shared by backend file across deployment versions. */
export interface BackendStoreInvalidation {
  backendId: string;
  storeVersion: number;
}
/** Called inside the store write transaction; a failed event rolls back the write. */
export type RecordBackendStoreInvalidation = (
  client: SqlClient,
  event: BackendStoreInvalidation,
  now?: number,
) => Promise<void>;
