/**
 * THE GENERATED DATASET GRAPHQL API (Hasura v2 subset): one schema per dataset table and caller role, built from
 * the table's columns and the role's select rule. These are the read contracts shared by the server, the direct
 * endpoint (`/api/artifacts/:id/graphql` on a dataset) and later the page composition and the skill.
 */
import type { DatasetRole } from './dataset-permissions';

export const DATASET_GRAPHQL_READ_LIMITS = {
  /** Rows a list field returns when the query names no `limit`. */
  defaultLimit: 100,
  /** Rows one list field (or an aggregate's `nodes`) returns at most; a select rule's `limit` lowers it. */
  maxLimit: 1000,
  /** Engine statements one request may run (each root field and each aggregate leaf is one). */
  statements: 32,
  /** Serialized `data` bytes one request may answer. */
  resultBytes: 4 * 1024 * 1024,
} as const;

/** Field names the generated API owns: a column never takes one (plus anything starting `__`). */
export const DATASET_GRAPHQL_RESERVED_FIELDS = ['_id', '_and', '_or', '_not', 'true', 'false', 'null'] as const;

/** `extensions.code` on every error the generated API answers. */
export type DatasetGraphqlErrorCode =
  | 'validation_failed'
  | 'permission_denied'
  | 'dataset_not_found'
  | 'dataset_changed'
  | 'result_too_large'
  | 'unexpected';

export interface DatasetGraphqlError {
  message: string;
  path?: readonly (string | number)[];
  extensions: { code: DatasetGraphqlErrorCode };
}

/** A GraphQL request to one dataset. Mutations arrive with PR 5; this schema has a query root only. */
export interface DatasetGraphqlRequest {
  query: string;
  variables?: Record<string, unknown>;
  operationName?: string;
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
