import type { Scalar } from './sql';

/** Hasura v2 permission entries; extensions live outside those entries. */
export type PolicyPredicate = { [field: string]: unknown };
/** A v3 entry handed to the engine may carry `backend_only: true`, which admits only a trusted program (`DatasetMutationPolicy.trusted`). */
export interface InsertPermission {
  backend_only?: boolean;
  columns?: '*' | string[];
  check: PolicyPredicate;
  set?: Record<string, Scalar>;
}
export interface UpdatePermission {
  backend_only?: boolean;
  columns: '*' | string[];
  filter: PolicyPredicate;
  check?: PolicyPredicate | null;
  set?: Record<string, Scalar>;
}
export interface DeletePermission {
  backend_only?: boolean;
  filter: PolicyPredicate;
}
interface PermissionEntry<P> {
  role: string;
  permission: P;
  comment?: string | null;
}
export type DatasetOperation = 'insert' | 'update' | 'delete';
export interface DatasetTablePolicy {
  table: { schema: string; name: string };
  insert_permissions?: PermissionEntry<InsertPermission>[];
  update_permissions?: PermissionEntry<UpdatePermission>[];
  delete_permissions?: PermissionEntry<DeletePermission>[];
}
/**
 * The retired version 1 policy shape. Nothing in this tree reads it; it stays exported (with `parseDatasetPolicy`)
 * only because the deployment repository still imports both (app/__tests__/downstream-exports.test.ts).
 */
export interface DatasetPolicy {
  version: 1;
  enforcement: 'enabled';
  tables: DatasetTablePolicy[];
  execution?: {
    functions?: { allow?: string[]; deny?: string[] };
    extensions?: Record<string,unknown>;
  };
}
/** Only the app constructs this context; clients cannot supply their role/session. */
export interface DatasetMutationPolicy {
  table: DatasetTablePolicy;
  role: string;
  session: Record<string, Scalar>;
  operations: DatasetOperation[];
  /** Function allow/deny lists the engine enforces. Nothing in this tree sets them (version 3 has no slot); the deployment's generation extension reads `extensions`. */
  execution?: DatasetPolicy['execution'];
  /**
   * A verified owner program (markup `<Mutation>` or a registered page mutation with its saved-document
   * proof, on a page whose owner holds owner or editor on the dataset). Only then do `backend_only` entries apply.
   */
  trusted?: boolean;
}
export interface DatasetPrincipal {
  groupId?: string | null;
  userId: string | null;
  tokenId: string | null;
}

/** Program trust for a write through a saved document. Constructed by the server; never request input. */
export interface DatasetGrantContext {
  caller: DatasetPrincipal;
  /** Server-authorized editor memberships only; viewers never satisfy owner writes. */
  callerEditorGroupIds?: string[];
  owner: DatasetPrincipal;
  artifact?: { id: string; owner: DatasetPrincipal };
}
export interface MutationAnalysis {
  operation: DatasetOperation;
  columns: string[];
  functions: string[];
}
