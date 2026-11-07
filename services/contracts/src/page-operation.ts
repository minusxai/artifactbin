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
/** `role` is the caller's page role, decided by the app before the resolver ran (never by resolver input). */
interface PageResolverPrincipal { readonly tenant:string; readonly subject:string|null; readonly role:DatasetRole }
export interface PageResolverFieldCall {
  namespace:string; fileId:string; version:string; operation:'query'|'mutation';
  field:string; args:HtmlJsonObject; principal:PageResolverPrincipal; signal:AbortSignal;
  /** Trusted adapter receipt outcome; never serialized to author code or inferred from arbitrary result JSON. */
  reportOutcome?(outcome:Exclude<PageMutationOutcome,'offline'>):void;
}
export interface PageResolverInvoker { invoke(call:PageResolverFieldCall):Promise<HtmlJson> }
/**
 * Schemas are composed with names private to each link, so duplicate backend type names are safe. A
 * `dataset-hasura` source (a dataset link on the generated API) is the role's generated SDL instead: its roots
 * mount flat on Query/Mutation with `@dataset`, its types keep their names (the shared prelude once).
 */
export interface PageNamespaceSource {
  name:string; fileId:string; version:string; typeDefs:string;
  kind?:'dataset-hasura';
  /** dataset-hasura: root field → the table root it serves and its kind. */
  roots?:Readonly<Record<string,{table:string;field:string}>>;
}
/**
 * THE BUILT-IN VIEWER QUERY every page answers with no link: `{ viewer { signedIn id name } }`. Its root and type
 * names are reserved: no link may be named, or generate, either. Signed in means the caller's page role is at
 * least `signed_in` (`@auth(signedIn: true)` admits them); then `id` is the resolver's `principal.subject` and
 * `name` the person card's display name. Anyone else reads `{signedIn:false,id:null,name:null}`, never an error.
 * Nothing else about the reader (no email, no token) is in it.
 */
export const PAGE_VIEWER_ROOT = 'viewer';
export const PAGE_VIEWER_TYPE = 'Viewer';
/**
 * THE PAGE'S READ-ONLY SQL DOOR on every page that links a dataset: `{ _sql(sql: "select …", params: {…}) { columns
 * { name type } rows } }`, one statement over the linked datasets as the reader (each table the reader's rule shows;
 * a rule without `allow_aggregations` refuses it). Its root and type names are reserved like the viewer's.
 */
export const PAGE_SQL_ROOT = '_sql';
export const PAGE_SQL_TYPES = Object.freeze(['SqlResult', 'SqlColumn', 'JSON'] as const);
/** `role` is the caller's page role (`datasetRoleFrom` over the page's sharing); null cannot read the page. */
export interface PageCaller { pageId:string; subject:string|null; role:DatasetRole|null }
export interface PageSchema { sdl:string; namespaces:readonly string[] }
