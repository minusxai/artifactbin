import type { Scalar } from './sql';

/** Hasura v2 permission entries; extensions live outside those entries. */
export type PolicyPredicate = { [field: string]: unknown };
export interface InsertPermission {
  backend_only?: false;
  columns?: '*' | string[];
  check: PolicyPredicate;
  set?: Record<string, Scalar>;
}
export interface UpdatePermission {
  backend_only?: false;
  columns: '*' | string[];
  filter: PolicyPredicate;
  check?: PolicyPredicate | null;
  set?: Record<string, Scalar>;
}
export interface DeletePermission {
  backend_only?: false;
  filter: PolicyPredicate;
}
export interface PermissionEntry<P> {
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
export interface DatasetPolicy {
  version: 1;
  enforcement: 'enabled';
  tables: DatasetTablePolicy[];
  delegated_mutations?: {
    audience: 'anyone';
    operations: DatasetOperation[];
    via: 'declared_mutation';
  };
  execution?: {
    functions?: { allow?: string[]; deny?: string[] };
    generation?: {
      models: string[];
      max_calls: number;
      max_tokens: number;
      documents?: string[];
    };
  };
}
/** Only the app constructs this context; clients cannot supply their role/session. */
export interface DatasetMutationPolicy {
  table: DatasetTablePolicy;
  role: 'editor' | 'visitor';
  session: Record<string, Scalar>;
  operations: DatasetOperation[];
  execution?: DatasetPolicy['execution'];
}
export interface MutationAnalysis {
  operation: DatasetOperation;
  columns: string[];
  functions: string[];
}
