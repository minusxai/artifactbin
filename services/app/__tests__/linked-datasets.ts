/**
 * Generated-API calls over linked datasets, as a page reader (the page audience rule, no page named unless given):
 * the lib-level oracle tests use in place of a page request. A dataset the caller can neither read nor write answers
 * `dataset_not_found`, as an unlinked one.
 */
import type {DatasetGraphqlReply,HtmlDatasetLink} from '@artifactbin/contracts';
import type {AccessActor} from '@/lib/accounts';
import {executeLinkedDatasetGraphql} from '@/lib/dataset-graphql';
export const liveLink=(datasetId:string,name='data'):HtmlDatasetLink=>({kind:'dataset',name,datasetId,mode:'live'});
export interface LinkedCall {variables?:Record<string,unknown>;pageId?:string;idempotencyKey?:string}
export function linkedGql(actor:AccessActor,link:HtmlDatasetLink|readonly HtmlDatasetLink[],query:string,call:LinkedCall={}):Promise<DatasetGraphqlReply>{
 const operation=/^\s*mutation\b/.test(query)?'mutation':'query';
 return executeLinkedDatasetGraphql(actor,Array.isArray(link)?link:[link as HtmlDatasetLink],{query,...(call.variables?{variables:call.variables}:{}),...(call.idempotencyKey?{idempotencyKey:call.idempotencyKey}:{})},
  {operation,resultBytes:1<<22,...(call.pageId?{pageId:call.pageId}:{})},new AbortController().signal);
}
/** The first error's code, or null when the reply has none. */
export const errorCode=(reply:DatasetGraphqlReply):string|null=>reply.errors?.[0]?.extensions?.code??null;
