import type { PageCaller, PageSchema, PageOperationRequest, PageOperationResponse, PageResolverFieldCall, HtmlJson } from '@artifactbin/contracts';
/** Maximum serialized selected GraphQL data; independent of schema, variables and backend execution budgets. */
export const PAGE_OPERATION_RESULT_BYTES = 4 * 1024 * 1024;
export type RemoteError = NonNullable<PageOperationResponse['errors']>[number];
/**
 * The page's dataset links on the generated API (lib/dataset-graphql `loadPageDatasets`), for this caller and request:
 * resolvers for their flat query roots, and the door a mutation naming only their roots goes through whole.
 */
export interface PageDatasetPort {
  queryRoots():Record<string,unknown>;
  mutate(request:Pick<PageOperationRequest,'query'|'variables'|'operationName'>):Promise<{data?:Record<string,unknown>|null;errors?:ReadonlyArray<{message:string;path?:readonly (string|number)[];extensions:{code:string}}>}>;
}
export interface ExecuteOptions {
  schema:PageSchema; request:Pick<PageOperationRequest,'query'|'variables'|'operationName'>; caller:PageCaller; invoke(call:PageResolverFieldCall):Promise<HtmlJson>; signal?:AbortSignal; datasets?:PageDatasetPort;
  /** A signed-in caller's display name for the built-in viewer (lib/datasets `people`), read only when a query selects it. */
  viewerName?(subject:string):Promise<string|null>;
  /** May this caller edit the page (the live-region editor's check, lib/artifacts `editablePage`)? Read only when the built-in viewer's `canEdit` is selected. */
  canEdit?():Promise<boolean>;
}
export function boundedDetail(text:unknown):string|undefined { if(typeof text!=='string')return; return text.split(/\r?\n/,1)[0]!.replace(/\p{Cc}/gu,' ').trim().slice(0,200).trim()||undefined; }
export const FIELD_ERROR_CODE = /^[a-z][a-z_]{0,63}$/;

/** Thrown by an invoke port only with proof the resolver never ran. */
export class FieldNotExecuted extends Error {
  /** Becomes extensions.code when it matches FIELD_ERROR_CODE. */
  readonly code?: string;
  /** Becomes extensions.detail for the page owner only (bounded: one line, 200 characters). */
  readonly detail?: string;
  constructor(message = "not executed", code?: string, detail?: string) {
    super(message);
    this.name = "FieldNotExecuted";
    if (code !== undefined) this.code = code;
    if (detail !== undefined) this.detail = detail;
  }
}

/** Thrown by an invoke port when the resolver may have run and failed: outcome "unknown". */
export class FieldFailed extends Error {
  /** Becomes extensions.code when it matches FIELD_ERROR_CODE. */
  readonly code: string;
  /** What the backend said, e.g. the thrown error's message: extensions.detail for the page owner only. */
  readonly detail?: string;
  /** A message the resolver code itself threw, already redacted: the GraphQL error message for every caller. */
  readonly shown?: string;
  constructor(code: string, detail?: string, shown?: string) {
    super(code);
    this.name = "FieldFailed";
    this.code = code;
    if (detail !== undefined) this.detail = detail;
    if (shown !== undefined) this.shown = shown;
  }
}

