import type { Scalar } from './sql';

/**
 * Version 3 dataset permissions: Hasura's own metadata shape (`tables[].select/insert/update/
 * delete_permissions`), limited to the subset the generated dataset API serves. The parser,
 * validator, plain-language read-back and templates live in `@artifactbin/utils/dataset-permissions`.
 */

/**
 * Every role a dataset request can have, weakest first. Dataset rules match exactly one role per
 * request, as in Hasura (a `signed_in` rule does not cover viewers). Resolver `@auth(role:…)` reads
 * this order as "at least".
 */
export const DATASET_ROLES = [
  'anonymous',
  'signed_in',
  'viewer',
  'editor',
  'owner',
] as const;
export type DatasetRole = (typeof DATASET_ROLES)[number];

/** The roles a rule may name, in the order the read-back lists them. */
export const DATASET_RULE_ROLES = ['viewer', 'signed_in', 'anonymous'] as const;
export type DatasetRuleRole = (typeof DATASET_RULE_ROLES)[number];

/** Admin-equivalent: always full access, so a rule naming them is refused. */
export const DATASET_ADMIN_ROLES = ['owner', 'editor'] as const;

/** True when `role` is `minimum` or stronger (the resolver `@auth` reading). */
export function datasetRoleAtLeast(
  role: DatasetRole,
  minimum: DatasetRole,
): boolean {
  return DATASET_ROLES.indexOf(role) >= DATASET_ROLES.indexOf(minimum);
}

/**
 * Session values a rule may reference, matched case-insensitively and stored verbatim. Any other
 * `X-Hasura-*` value is refused. A value the request lacks makes the rule deny.
 */
export const DATASET_SESSION_VARIABLES = [
  'X-Hasura-User-Id',
  'X-Hasura-Page-Id',
  'X-Hasura-Role',
] as const;
export type DatasetSessionVariable = (typeof DATASET_SESSION_VARIABLES)[number];

/** Column comparison operators (the query `where` grammar). `_id` takes only the ID subset. */
export const DATASET_COLUMN_OPERATORS = [
  '_eq',
  '_neq',
  '_gt',
  '_gte',
  '_lt',
  '_lte',
  '_in',
  '_nin',
  '_is_null',
  '_like',
  '_nlike',
  '_ilike',
  '_nilike',
] as const;
export type DatasetColumnOperator = (typeof DATASET_COLUMN_OPERATORS)[number];
export const DATASET_ID_OPERATORS = ['_eq', '_neq', '_in', '_nin'] as const;

/** The stable platform row ID: predicates may use it; columns and presets may not. */
export const DATASET_ROW_ID = '_id';

export const DATASET_PERMISSION_LIMITS = {
  bytes: 64_000,
  tables: 64,
  depth: 12,
  predicates: 64,
  inValues: 100,
  selectLimit: 1000,
} as const;

export type DatasetColumnComparison = {
  [operator in DatasetColumnOperator]?: Scalar | Scalar[] | boolean;
};
/** `{}` is true; `_and`/`_or`/`_not` combine; any other key is a source column name. */
export interface DatasetBoolExp {
  _and?: DatasetBoolExp[];
  _or?: DatasetBoolExp[];
  _not?: DatasetBoolExp;
  [column: string]: DatasetColumnComparison | DatasetBoolExp | DatasetBoolExp[] | undefined;
}

/** Column presets: a static value or a session variable name. */
export type DatasetColumnPresets = Record<string, Scalar>;

export interface DatasetSelectPermission {
  columns: '*' | string[];
  filter: DatasetBoolExp;
  /** At most `DATASET_PERMISSION_LIMITS.selectLimit`. */
  limit?: number;
  allow_aggregations?: boolean;
}
export interface DatasetInsertPermission {
  columns?: '*' | string[];
  check: DatasetBoolExp;
  set?: DatasetColumnPresets;
  backend_only?: boolean;
}
export interface DatasetUpdatePermission {
  columns: '*' | string[];
  filter: DatasetBoolExp;
  check?: DatasetBoolExp | null;
  set?: DatasetColumnPresets;
  backend_only?: boolean;
}
export interface DatasetDeletePermission {
  filter: DatasetBoolExp;
  backend_only?: boolean;
}

export interface DatasetPermissionEntry<P> {
  role: DatasetRuleRole;
  permission: P;
  comment?: string | null;
}

export interface DatasetTableName {
  schema: string;
  name: string;
}

/** Server-owned GraphQL naming: a policy write must omit it or send it unchanged. */
export interface DatasetTableConfiguration {
  custom_name?: string;
  custom_column_names?: Record<string, string>;
}

export interface DatasetTablePermissions {
  table: DatasetTableName;
  configuration?: DatasetTableConfiguration;
  select_permissions?: DatasetPermissionEntry<DatasetSelectPermission>[];
  insert_permissions?: DatasetPermissionEntry<DatasetInsertPermission>[];
  update_permissions?: DatasetPermissionEntry<DatasetUpdatePermission>[];
  delete_permissions?: DatasetPermissionEntry<DatasetDeletePermission>[];
}

/** No entry for a role, operation and table means deny. */
export interface DatasetPermissions {
  version: 3;
  tables: DatasetTablePermissions[];
}

export const DATASET_PERMISSION_OPERATIONS = [
  'select',
  'insert',
  'update',
  'delete',
] as const;
export type DatasetPermissionOperation =
  (typeof DATASET_PERMISSION_OPERATIONS)[number];

/** The dataset's tables and source column names, the validator's input for unknown names. */
export interface DatasetPermissionsShape {
  tables: { table: DatasetTableName; columns: readonly string[] }[];
}

/** One problem, addressed by JSON path (`tables[0].update_permissions[1].role`). */
export interface DatasetPermissionsIssue {
  path: string;
  message: string;
}
export type DatasetPermissionsResult =
  | { ok: true; policy: DatasetPermissions }
  | { ok: false; errors: DatasetPermissionsIssue[] };

export const DATASET_PERMISSION_TEMPLATES = [
  'read-only',
  'own-rows',
  'editors-only',
] as const;
export type DatasetPermissionTemplate =
  (typeof DATASET_PERMISSION_TEMPLATES)[number];

export type DatasetPermissionWarningCode =
  | 'anonymous_write'
  | 'page_id_direct_denied'
  | 'update_without_check'
  | 'private_dataset';
export interface DatasetPermissionWarning {
  code: DatasetPermissionWarningCode;
  message: string;
}

/** The one plain-language description the script, HTTP API and app all show. */
export interface DatasetPermissionsReadBack {
  tables: { title: string; lines: string[] }[];
  warnings: DatasetPermissionWarning[];
  text: string;
}
