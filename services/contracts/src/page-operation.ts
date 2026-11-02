import type { DatasetRole } from './dataset-permissions';
import type { HtmlJson, HtmlJsonObject } from './html-page';
export type PageMutationOutcome = 'committed' | 'rejected' | 'unknown' | 'offline';
export interface PageOperationRequest { pageId: string; revision: string; query: string; variables?: HtmlJsonObject; operationName?: string }
export interface PageOperationResponse {
  data: HtmlJsonObject | null;
  errors?: { message: string; path?: (string|number)[]; extensions?: {code:string;detail?:string} }[];
  extensions?: {outcomes:Record<string,PageMutationOutcome>};
}
export interface PageOperations<A> {
  schema(actor:A,pageId:string,revision:string):Promise<string>;
  execute(actor:A,request:PageOperationRequest,signal:AbortSignal):Promise<PageOperationResponse>;
}
export interface PageResolverPrincipal { readonly tenant:string; readonly subject:string|null }
export interface PageResolverFieldCall {
  namespace:string; fileId:string; version:string; operation:'query'|'mutation';
  field:string; args:HtmlJsonObject; principal:PageResolverPrincipal; signal:AbortSignal;
  /** Trusted adapter receipt outcome; never serialized to author code or inferred from arbitrary result JSON. */
  reportOutcome?(outcome:Exclude<PageMutationOutcome,'offline'>):void;
}
export interface PageResolverInvoker { invoke(call:PageResolverFieldCall):Promise<HtmlJson> }
/** Schemas are composed with names private to each link, so duplicate backend type names are safe. */
export interface PageNamespaceSource { name:string; fileId:string; version:string; typeDefs:string }
/** `role` is the caller's page role (`datasetRoleFrom` over the page's sharing); null cannot read the page. */
export interface PageCaller { pageId:string; subject:string|null; role:DatasetRole|null }
export interface PageSchema { sdl:string; namespaces:readonly string[] }
export interface PageNamespaceExecutor {
  compose(sources:readonly PageNamespaceSource[]):PageSchema;
  execute(input:{schema:PageSchema;request:Pick<PageOperationRequest,'query'|'variables'|'operationName'>;caller:PageCaller;invoke:PageResolverInvoker['invoke'];signal:AbortSignal}):Promise<PageOperationResponse>;
}
