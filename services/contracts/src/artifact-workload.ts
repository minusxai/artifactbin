/** Purpose-only service workload RPC; these are never general API credentials.
 * Host-only artifact-outputs takes exactly kind, credential, after (also its digest field order).
 * The short-lived observer capability is consumed only by the configured service callback; keep it out
 * of URLs, receipts, logs, returned metadata and sandboxes. Both phases require outputLookup:true,
 * viewer, empty readArtifactIds, null rootFolderId, private visibility and no writer capability.
 * Receipts must match all eight principal fields and current live group ownership. Return at most 50
 * distinct IDs in C order, with normal PUBLIC_BASE_URL /a/<id> links retaining current ACL checks.
 * Reread metadata after final admission and refuse changed pages; never refresh creation authority.
 */
import type {WorkloadBinding} from './workload';
export const ARTIFACT_WORKLOAD_PATH='/api/internal/identity/artifact-workload';
export const APP_ARTIFACT_WORKLOAD_PATH='/api/internal/artifact-workload';
export const ARTIFACT_WORKLOAD_LIMIT=200*1024;
export type ArtifactWorkloadOperation={kind:'artifact-read';artifactId:string;source:'canonical'}|{kind:'artifact-create';title:string;html:string}|{kind:'artifact-outputs';credential:string;after:string|null};
export interface ArtifactWorkloadOutputPage {
 items:{id:string;title:string;format:string;url:string}[];
 nextCursor:string|null;
 hasMore:boolean;
}
export interface ArtifactWorkloadScope {
 allowed:true;
 principal:WorkloadBinding;
 role:'viewer'|'editor';
 readArtifactIds:readonly string[];
 rootFolderId:string|null;
 visibility:'private';
 creationKey?:string;
 publication?:{maxArtifacts:number;maxBytes:number};
 expectedTitle?:string;
 outputLookup?:true;
}
const workloadBindingKeys=['issuerId','subjectId','grantId','groupId','executionId','environmentId','intentHash'] as const;
export function isWorkloadBinding(value:unknown):value is WorkloadBinding {
 if(!value||typeof value!=='object'||Array.isArray(value))return false;
 const row=value as Record<string,unknown>;
 return Object.keys(row).length===8&&workloadBindingKeys.every(key=>typeof row[key]==='string'&&(row[key] as string).length>0&&(row[key] as string).length<=256)&&Number.isSafeInteger(row.epoch)&&(row.epoch as number)>=0;
}
export function isArtifactWorkloadOperation(value:unknown):value is ArtifactWorkloadOperation {
 if(!value||typeof value!=='object'||Array.isArray(value))return false;
 const row=value as Record<string,unknown>;
 if(row.kind==='artifact-outputs')return Object.keys(row).length===3&&typeof row.credential==='string'&&/^[A-Za-z0-9_-]{32,128}$/.test(row.credential)&&(row.after===null||(typeof row.after==='string'&&/^[A-Za-z0-9_-]{1,128}$/.test(row.after)));
 if(row.kind==='artifact-read')return Object.keys(row).length===3&&typeof row.artifactId==='string'&&/^[A-Za-z0-9_-]{1,128}$/.test(row.artifactId)&&row.source==='canonical';
 return row.kind==='artifact-create'&&Object.keys(row).length===3&&typeof row.title==='string'&&row.title.trim().length>0&&row.title.length<=500&&typeof row.html==='string'&&row.html.trim().length>0&&row.html.length<=ARTIFACT_WORKLOAD_LIMIT;
}

/** SHA-256 this UTF-8 string for callback digest binding; the field order is part of the wire contract. */
export function artifactWorkloadOperationJson(operation:ArtifactWorkloadOperation):string {
 if(operation.kind==='artifact-outputs')return JSON.stringify({kind:operation.kind,credential:operation.credential,after:operation.after});
 return JSON.stringify(operation.kind==='artifact-read'?{kind:operation.kind,artifactId:operation.artifactId,source:operation.source}:{kind:operation.kind,title:operation.title,html:operation.html});
}
