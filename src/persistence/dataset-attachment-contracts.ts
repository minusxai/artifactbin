import type { SqlDatabase, SqlClient } from "./sql-contracts.ts";
import type { DatasetAttachmentRegistration } from "../datasets/attachments/contracts.ts";
export interface DatasetAttachmentRepositoryOptions {
  database: SqlDatabase;
  now?: () => number;
  newId?: () => string;
}
export interface RegisterDatasetAttachments {
  client: SqlClient;
  registrations: readonly DatasetAttachmentRegistration[];
}

export interface RegisterInactiveDatasetAttachments extends RegisterDatasetAttachments {
 publication: import("./inactive-registration-contracts.ts").InactivePageRegistration;
}
