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
import {SERVICE_PAYLOAD_LIMIT} from './payload-limit';
export const ARTIFACT_WORKLOAD_PATH='/api/internal/identity/artifact-workload';
export const APP_ARTIFACT_WORKLOAD_PATH='/api/internal/artifact-workload';
export type PageEvidenceOperation={kind:'page-evidence-schema';pageId:string;revision:string}|{kind:'page-evidence-sql';pageId:string;revision:string;sql:string;params:Record<string,import('./sql').Scalar>};
export interface PageEvidenceSchema {pageId:string;revision:string;bindings:{name:string;datasetId:string;revision:string}[];tables:{schema:string;name:string;columns:{name:string;type:import('./sql').ColumnType}[]}[]}
export interface PageEvidenceSql {pageId:string;revision:string;bindings:PageEvidenceSchema['bindings'];columns:{name:string;type:import('./sql').ColumnType}[];rows:Record<string,import('./sql').Scalar>[]}
export interface PageDatasetSelect {pageId:string;revision:string;links:{name:string;datasetId:string;revision:string}[];role:'viewer'}
export type ArtifactWorkloadOperation=PageEvidenceOperation|{kind:'artifact-read';artifactId:string;source:'canonical'}|{kind:'artifact-create';title:string;html:string}|{kind:'artifact-outputs';credential:string;after:string|null};
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
 pageDatasetSelect?:PageDatasetSelect;
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
 if(isPageEvidenceOperation(value))return true;
 if(row.kind==='artifact-outputs')return Object.keys(row).length===3&&typeof row.credential==='string'&&/^[A-Za-z0-9_-]{32,128}$/.test(row.credential)&&(row.after===null||(typeof row.after==='string'&&/^[A-Za-z0-9_-]{1,128}$/.test(row.after)));
 if(row.kind==='artifact-read')return Object.keys(row).length===3&&typeof row.artifactId==='string'&&/^[A-Za-z0-9_-]{1,128}$/.test(row.artifactId)&&row.source==='canonical';
 return row.kind==='artifact-create'&&Object.keys(row).length===3&&typeof row.title==='string'&&row.title.trim().length>0&&row.title.length<=500&&typeof row.html==='string'&&row.html.trim().length>0&&row.html.length<=SERVICE_PAYLOAD_LIMIT;
}

/** SHA-256 this UTF-8 string for callback digest binding; the field order is part of the wire contract. */
export function artifactWorkloadOperationJson(operation:ArtifactWorkloadOperation):string {
 if(operation.kind==='page-evidence-schema')return JSON.stringify({kind:operation.kind,pageId:operation.pageId,revision:operation.revision});
 if(operation.kind==='page-evidence-sql')return JSON.stringify({kind:operation.kind,pageId:operation.pageId,revision:operation.revision,sql:operation.sql,params:operation.params});
 if(operation.kind==='artifact-outputs')return JSON.stringify({kind:operation.kind,credential:operation.credential,after:operation.after});
 return JSON.stringify(operation.kind==='artifact-read'?{kind:operation.kind,artifactId:operation.artifactId,source:operation.source}:{kind:operation.kind,title:operation.title,html:operation.html});
}

/** Exact evidence requests: no implicit revision or parameter defaults. SQL semantics belong to the canonical engine. */
export function isPageEvidenceOperation(value:unknown):value is PageEvidenceOperation {
 if(!value||typeof value!=='object'||Array.isArray(value))return false;
 const r=value as Record<string,unknown>;
 if(typeof r.pageId!=='string'||!/^[A-Za-z0-9_-]{1,128}$/.test(r.pageId)||typeof r.revision!=='string'||!/^[1-9]\d*$/.test(r.revision)||!Number.isSafeInteger(Number(r.revision)))return false;
 if(r.kind==='page-evidence-schema')return Object.keys(r).length===3;
 if(r.kind!=='page-evidence-sql'||Object.keys(r).length!==5||typeof r.sql!=='string'||!r.sql.trim()||!r.params||typeof r.params!=='object'||Array.isArray(r.params))return false;
 return Object.entries(r.params).every(([k,v])=>/^[A-Za-z_][A-Za-z0-9_]{0,63}$/.test(k)&&(v===null||typeof v==='string'||typeof v==='boolean'||typeof v==='number'&&Number.isFinite(v)));
}
/** Exact bounded host grant; canonical page tuples are checked separately at admission and delivery. */
export function isPageDatasetSelect(value:unknown):value is PageDatasetSelect {
 if(!value||typeof value!=='object'||Array.isArray(value))return false;
 const r=value as PageDatasetSelect;
 return Object.keys(r).length===4&&r.role==='viewer'&&isPageEvidenceOperation({kind:'page-evidence-schema',pageId:r.pageId,revision:r.revision})&&Array.isArray(r.links)&&r.links.length>0&&r.links.length<=128&&new Set(r.links.map(l=>l?.name)).size===r.links.length&&new Set(r.links.map(l=>l?.datasetId)).size===r.links.length&&r.links.every(l=>l&&Object.keys(l).length===3&&typeof l.name==='string'&&/^[A-Za-z_][A-Za-z0-9_]{0,63}$/.test(l.name)&&isPageEvidenceOperation({kind:'page-evidence-schema',pageId:l.datasetId,revision:l.revision}));
}
