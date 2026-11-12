/** SQL oracle for dataset-link policies, pinned revisions and stable identities. */
import type {HtmlDatasetLink} from '@artifactbin/contracts';
import type {AccessActor} from '@/lib/accounts';
import {executePageSql} from '@/lib/dataset-access';
export const liveLink=(datasetId:string,name='data'):HtmlDatasetLink=>({kind:'dataset',name,datasetId,mode:'live'});
export interface LinkedCall {variables?:Record<string,unknown>;pageId?:string;idempotencyKey?:string}
export async function linkedSql(actor:AccessActor,link:HtmlDatasetLink|readonly HtmlDatasetLink[],sql:string,call:LinkedCall={}){
 const reply=await executePageSql(actor,Array.isArray(link)?link:[link as HtmlDatasetLink],{sql,params:call.variables??{}},{pageId:call.pageId??'mxmx_test_page',...(call.idempotencyKey?{idempotencyKey:call.idempotencyKey}:{})},new AbortController().signal);
 return reply.body as {rows?:Array<Record<string,any>>;affected?:number;returning?:Array<Record<string,any>>;error?:string};
}
export const errorCode=(reply:{error?:string}):string|null=>reply.error??null;
