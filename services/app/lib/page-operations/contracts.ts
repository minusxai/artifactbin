import type { PageCaller, PageSchema, PageOperationRequest, PageOperationResponse, Scalar } from '@artifactbin/contracts';
/** Maximum serialized selected GraphQL data; independent of the schema and variables budgets. */
export const PAGE_OPERATION_RESULT_BYTES = 4 * 1024 * 1024;
export type RemoteError = NonNullable<PageOperationResponse['errors']>[number];
/**
 * The page's dataset links on the generated API (lib/graphql-compat `loadPageDatasets`), for this caller and request:
 * resolvers for their flat query roots, and the door a mutation naming only their roots goes through whole.
 */
export interface PageDatasetPort {
  queryRoots():Record<string,unknown>;
  mutate(request:Pick<PageOperationRequest,'query'|'variables'|'operationName'>):Promise<{data?:Record<string,unknown>|null;errors?:ReadonlyArray<{message:string;path?:readonly (string|number)[];extensions:{code:string}}>}>;
  /** The page's `_sql` (contracts `PAGE_SQL_ROOT`), arguments already checked: one read-only statement as the caller; failures are GraphQL errors with `extensions.code`. */
  sql(call:{sql:string;params:Readonly<Record<string,Scalar>>}):Promise<{columns:ReadonlyArray<{name:string;type:string}>;rows:ReadonlyArray<Record<string,unknown>>}>;
}
export interface ExecuteOptions {
  schema:PageSchema; request:Pick<PageOperationRequest,'query'|'variables'|'operationName'>; caller:PageCaller; signal?:AbortSignal; datasets?:PageDatasetPort;
  /** A signed-in caller's display name for the built-in viewer (lib/datasets `people`), read only when a query selects it. */
  viewerName?(subject:string):Promise<string|null>;
  /** May this caller edit the page (the live-region editor's check, lib/artifacts `editablePage`)? Read only when the built-in viewer's `canEdit` is selected. */
  canEdit?():Promise<boolean>;
}
/** The dataset error codes a page GraphQL answer passes on as `extensions.code`. */
export const FIELD_ERROR_CODE = /^[a-z][a-z_]{0,63}$/;
