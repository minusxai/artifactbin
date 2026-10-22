import type {
  AuthorizationFacts,
  DatasetSnapshot,
  DocumentSnapshot,
} from "./policy/contracts.ts";
export type ColumnType =
  | "string"
  | "number"
  | "boolean"
  | "date"
  | "timestamp"
  | "user";
export interface DatasetColumn {
  name: string;
  type: ColumnType;
}
export type DatasetCell = string | number | boolean | null;
export interface DatasetTable {
  schema: string;
  name: string;
  columns: readonly DatasetColumn[];
  /** Server-only immutable storage identity. Never supplied by a page or returned. */
  object: { key: string; sha256: string; bytes: number };
}
export interface DatasetBinding {
  name: string;
  backendId: string;
  backendVersion: string;
  page: { id: string; version: number; legacyId: string; editId: string };
  dataset: { id: string; version: number; policyRevision: number };
  tables: readonly DatasetTable[];
}
/** Constructed by the backend host from the saved deployment and verified caller. */
export interface DatasetCallContext {
  backendId: string;
  backendVersion: string;
  pageId: string;
  subject: string | null;
}
export interface DatasetReadRequest {
  binding: string;
  schema: string;
  table: string;
  offset: number;
  limit: number;
}
export interface DatasetReadResult {
  version: number;
  schema: string;
  table: string;
  columns: readonly DatasetColumn[];
  rows: Readonly<Record<string, DatasetCell>>[];
  offset: number;
  nextOffset: number | null;
  totalRows: number;
}
export interface DatasetReadAuthority {
  page: DocumentSnapshot;
  pageVersion: number;
  dataset: DatasetSnapshot & { deleted: boolean };
  /** Includes the server-derived legacy user/token principal mapping; never page input. */
  facts: AuthorizationFacts;
}
export interface DatasetReadPorts {
  binding(
    context: DatasetCallContext,
    name: string,
  ): Promise<DatasetBinding | null>;
  /** Must freshly resolve current page/dataset ACL, identity and policy, including after I/O. */
  authority(
    context: DatasetCallContext,
    binding: DatasetBinding,
  ): Promise<DatasetReadAuthority | null>;
  read(key: string, signal?: AbortSignal): Promise<AsyncIterable<Uint8Array>>;
}
export interface DatasetReadService {
  read(
    context: DatasetCallContext,
    request: unknown,
    signal?: AbortSignal,
  ): Promise<DatasetReadResult>;
}
export const DATASET_RESULT_BYTES = 60 * 1024;
export const DATASET_OBJECT_BYTES = 32 * 1024 * 1024;
export class DatasetReadError extends Error {
  constructor(
    readonly code:
      | "denied"
      | "invalid_request"
      | "invalid_dataset"
      | "result_limit",
  ) {
    super(code);
    this.name = "DatasetReadError";
  }
}
