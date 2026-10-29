import type { AccessActor } from '@/lib/accounts';
import type { DatasetCatalog } from '@/lib/datasets';
import type { DatasetPerson, DatasetSourceInfo, DatasetWriteRequest, DatasetWriteReceipt, HtmlDatasetLink, Scalar } from '@artifactbin/contracts';
export interface DatasetRowIdentitySidecar {objectKey:string;ids:readonly string[]}
/** Authorized, revision-specific data. Policy identity changes invalidate cursors. */
export interface DatasetSnapshot {
 id:string; revision:string; policyIdentity:string; catalog:DatasetCatalog;
 rowIds:Readonly<Record<string,readonly string[]>>;
 sources?:Readonly<Record<string,DatasetSourceInfo>>;
}
export interface DatasetStatement { sql:string; params:Record<string,Scalar> }
/** Narrow port to the retained dataset executor, ACL, object storage and mutation transaction. */
export interface DatasetGraphqlPort {
 /** Optional only for non-account local/test adapters; unavailable lookup must reject. */
 people?(actor:AccessActor,snapshot:DatasetSnapshot,ids:readonly string[],signal:AbortSignal):Promise<readonly DatasetPerson[]>;
 snapshot(actor:AccessActor,binding:HtmlDatasetLink,signal:AbortSignal):Promise<DatasetSnapshot>;
 execute(actor:AccessActor,snapshot:DatasetSnapshot,tableId:string,statement:DatasetStatement,window:{limit:number;offset:number},signal:AbortSignal):Promise<Record<string,unknown>[]>;
 commit(actor:AccessActor,binding:HtmlDatasetLink,snapshot:DatasetSnapshot,request:DatasetWriteRequest,statements:readonly DatasetStatement[],signal:AbortSignal):Promise<DatasetWriteReceipt>;
}
