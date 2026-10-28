import type { PageCaller, PageSchema, PageOperationRequest, PageOperationResponse, PageResolverFieldCall, HtmlJson } from '@artifactbin/contracts';
/** Maximum serialized selected GraphQL data; independent of schema, variables and backend execution budgets. */
export const PAGE_OPERATION_RESULT_BYTES = 4 * 1024 * 1024;
export type RemoteError = NonNullable<PageOperationResponse['errors']>[number];
export interface ExecuteOptions { schema:PageSchema; request:Pick<PageOperationRequest,'query'|'variables'|'operationName'>; caller:PageCaller; invoke(call:PageResolverFieldCall):Promise<HtmlJson>; signal?:AbortSignal }
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
  constructor(code: string, detail?: string) {
    super(code);
    this.name = "FieldFailed";
    this.code = code;
    if (detail !== undefined) this.detail = detail;
  }
}

