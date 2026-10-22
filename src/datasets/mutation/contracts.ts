import type {
  DatasetMutationParameterType,
  DatasetMutationValueParameter,
  DatasetMutationRowParameters,
} from "./parameter-contracts.ts";
import type {
  DatasetCallContext,
  DatasetCell,
  DatasetTable,
} from "../contracts.ts";
import type { DatasetReadAuthority } from "../contracts.ts";
import type {
  DatasetMutationPolicy,
  MutationInput,
  MutationOutcome,
} from "../sql/engine/sql-contracts.ts";
/** Authored and validated on publication, never accepted in a browser mutation request. */
export interface DatasetMutationOperation {
  name: string;
  backendId: string;
  backendVersion: string;
  page: { id: string; version: number; legacyId: string; editId: string };
  datasetId: string;
  target: { schema: string; table: string };
  /** Trusted authored Import alias; canonical target remains the policy/CAS identity. */
  sqlSchema?: string;
  sql: string;
  /** Trusted publication-time SQLite authorizer result; absent means advisory unavailable. */
  analysis?: {operation: "insert" | "update" | "delete"; columns: string[]};
  paramTypes: Record<string, DatasetMutationParameterType>;
  rowParams?: DatasetMutationRowParameters;
  valueParam?: DatasetMutationValueParameter;
  /** Trusted registration may read only its current page accepted membership. */
  readsMembers?: true;
  expectedAffected?: number;
  /** Retries must be explicitly authored as fresh-row operations; never inferred from SQL text. */
  conflictMode: "refuse" | "rerun-fresh";
}
export interface DatasetMutationRequest {
  operation: string;
  requestId: string;
  params: Record<string, DatasetCell>;
}
export interface DatasetMutationHead {
  authority: DatasetReadAuthority;
  generation: number;
  version: number;
  policyRevision: number;
  writable: boolean;
  callerCanEdit: boolean;
  documentWriterCanRead: boolean;
  /** Server-only system bindings such as _me__id, _now and _tz; never copied from request params. */
  systemParams: Readonly<Record<string, DatasetCell>>;
  members?: import("../members-contracts.ts").DatasetMembersSnapshot;
  /** Preserve legacy user constraints for transaction-time validation of actual assignments. */
  tables: readonly (Omit<DatasetTable, "columns"> & {
    columns: readonly import("../sql/engine/sql-contracts.ts").DatasetColumn[];
  })[];
}
/** Fixed engine job sent only on the trusted execution-controller transport. */
export interface DatasetSqlJob {
  kind: "dataset-sql";
  engineVersion: "sqlite-3.53.4-effect-v1";
  input: MutationInput;
}
export interface DatasetMutationResult {
  affected: number;
  rowCount: number;
  version: number;
  generation: number;
}
export interface DatasetMutationService {
  mutate(
    context: DatasetCallContext,
    request: unknown,
    signal?: AbortSignal,
  ): Promise<DatasetMutationResult>;
}
export interface DatasetMutationLease {
  id: string;
  attempt: number;
}
export type DatasetMutationBegin =
  | { kind: "refused"; code: string }
  | { kind: "replay"; result: DatasetMutationResult }
  | { kind: "busy" }
  | { kind: "lease"; lease: DatasetMutationLease };
export interface DatasetMutationPorts {
  operation(
    context: DatasetCallContext,
    name: string,
  ): Promise<DatasetMutationOperation | null>;
  /** Durable inflight receipt keyed by caller, backend/version, page and requestId; fingerprint is immutable. */
  begin(
    context: DatasetCallContext,
    operation: DatasetMutationOperation,
    request: DatasetMutationRequest,
  ): Promise<DatasetMutationBegin>;
  head(
    context: DatasetCallContext,
    operation: DatasetMutationOperation,
  ): Promise<DatasetMutationHead | null>;
  read(table: DatasetTable): Promise<MutationInput["table"]["rows"]>;
  execute(job: DatasetSqlJob, signal?: AbortSignal): Promise<MutationOutcome>;
  persist(
    rows: MutationInput["table"]["rows"],
  ): Promise<DatasetTable["object"]>;
  /** Atomic fresh authority/userWrites validation + head CAS + immutable version + receipt + invalidation. */
  commit(input: {
    context: DatasetCallContext;
    operation: DatasetMutationOperation;
    lease: DatasetMutationLease;
    head: DatasetMutationHead;
    object: DatasetTable["object"];
    outcome: Extract<MutationOutcome, { affected: number }>;
  }): Promise<
    | { kind: "committed"; result: DatasetMutationResult }
    | { kind: "conflict" }
    | { kind: "denied" }
  >;
  /** Terminal refusal recorded durably. Never release an unknown/committed execution for replay. */
  refuse(lease: DatasetMutationLease, code: string): Promise<void>;
}
export interface DatasetPolicySelection {
  policy?: DatasetMutationPolicy;
  operations: readonly ("insert" | "update" | "delete")[];
}
export class DatasetMutationError extends Error {
  readonly code: string;
  readonly outcome: "rejected" | "unknown";
  constructor(code: string, outcome: "rejected" | "unknown" = "unknown") {
    super(code);
    this.code = code;
    this.name = "DatasetMutationError";
    this.outcome = outcome;
  }
}
export const DATASET_SQL_LIMITS = Object.freeze({
  inputBytes: 32 * 1024 * 1024,
  outputBytes: 32 * 1024 * 1024,
  maxRows: 10000,
  maxCells: 1000000,
  maxSqlBytes: 64000,
  /** Fixed caller budget leaves reserved space for trusted identity/time bindings. */
  maxCallerParams: 240,
  maxSystemParams: 16,
  maxParams: 256,
  timeoutMs: 5000,
  wallMs: 7000,
  memoryMiB: 256,
  cpu: 1,
  maxQueue: 0,
});
