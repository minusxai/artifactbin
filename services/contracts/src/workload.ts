/** Host-only workload authority. No network credential or human identity is implied. */
export interface WorkloadBinding {
 readonly issuerId:string;
 readonly subjectId:string;
 readonly grantId:string;
 readonly groupId:string;
 readonly executionId:string;
 readonly environmentId:string;
 readonly intentHash:string;
 readonly epoch:number;
}
export interface WorkloadReadOperation {
 readonly kind:'artifact-read';
 readonly artifactId:string;
 readonly source:'canonical'|'versions'|'version'|'raw';
}
export type WorkloadAuthorization = {readonly allowed:false} | {
 readonly allowed:true;
 readonly principal:WorkloadBinding;
 readonly role:'viewer'|'editor';
 readonly readArtifactIds:readonly string[];
 readonly writeArtifactIds:readonly string[];
 readonly rootFolderId:string|null;
 readonly visibility:'private';
};
/** Later writes use final admission: revocation cannot retract already committed effects. */
export interface WorkloadAuthority {
 authorize(binding:WorkloadBinding,operation:WorkloadReadOperation,signal?:AbortSignal):Promise<WorkloadAuthorization>;
}
