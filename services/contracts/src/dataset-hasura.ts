/**
 * THE GENERATED DATASET GRAPHQL API (Hasura v2 subset): one schema per dataset table and caller role, built from
 * the table's columns and the role's select, insert, update and delete rules. These are the contracts shared by the
 * server, the direct endpoint (`/api/artifacts/:id/graphql` on a dataset) and later the page composition and the skill.
 */
import type { DatasetRole } from './dataset-permissions';

export const DATASET_GRAPHQL_READ_LIMITS = {
  /** Rows a list field returns when the query names no `limit`. */
  defaultLimit: 100,
  /** Rows one list field returns at most; a select rule's `limit` lowers it. */
  maxLimit: 1000,
  /** Engine statements one request may run (each list or `_by_pk` root field is one). */
  statements: 32,
  /** Serialized `data` bytes one request may answer. */
  resultBytes: 4 * 1024 * 1024,
} as const;

export const DATASET_GRAPHQL_WRITE_LIMITS = {
  /** Rows one mutation operation may change in total (every field together); above it nothing is written. */
  rows: 100,
  /** Objects one `insert_<root>` takes. */
  objects: 100,
  /** Re-runs of the operation's statements on the new head after the version CAS loses a race. */
  casRetries: 3,
} as const;

/** Field names the generated API owns: a column never takes one (plus anything starting `__`). */
export const DATASET_GRAPHQL_RESERVED_FIELDS = ['_id', '_can', '_and', '_or', '_not', 'true', 'false', 'null'] as const;

/** `extensions.code` on every error the generated API answers. */
export type DatasetGraphqlErrorCode =
  | 'validation_failed'
  | 'permission_denied'
  | 'dataset_not_found'
  | 'dataset_changed'
  | 'result_too_large'
  | 'check_violation'
  | 'too_many_rows'
  | 'outcome_unknown'
  /** One mutation operation writes one dataset (the plan's atomic step): its fields named two. */
  | 'one_dataset_per_mutation'
  | 'unexpected';

export interface DatasetGraphqlError {
  message: string;
  path?: readonly (string | number)[];
  extensions: { code: DatasetGraphqlErrorCode };
}

/**
 * A GraphQL request to one dataset: a query, or a mutation (one atomic dataset write). `idempotencyKey` (the
 * `Idempotency-Key` header) names the write: the same key and request replay its first reply and write nothing
 * again. Without one the server generates a key, which gives no replay safety.
 */
export interface DatasetGraphqlRequest {
  query: string;
  variables?: Record<string, unknown>;
  operationName?: string;
  idempotencyKey?: string;
}

/** `{data}` and/or `{errors}`, as Hasura answers (HTTP 200 either way). */
export interface DatasetGraphqlReply {
  data?: Record<string, unknown> | null;
  errors?: DatasetGraphqlError[];
}

/** GET on a dataset's GraphQL path: the caller's own schema, the head revision and the role it was built for. */
export interface DatasetGraphqlSchemaReply {
  sdl: string;
  revision: string;
  role: DatasetRole;
}
