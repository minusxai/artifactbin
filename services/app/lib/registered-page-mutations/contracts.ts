import type {Scalar} from '@artifactbin/contracts';
/** Server-only registration. SQL, dataset identity and parameters never enter the public descriptor. */
export interface MutationProgram {
 name:string;
 kind:'insert'|'update'|'delete';
 sql:string;
 target:{datasetId:string;schema:string;table:string};
 /** SQL parameter identifiers retain compiler underscores; public value and operation names keep their own grammar. */
 values:Record<string,{type:'string'|'number'|'boolean';nullable:boolean;parameter:string;default?:Scalar}>;
 builtins:readonly {name:'_me.id'|'_now'|'_tz';parameter:string}[];
 /** Source-declared exact affected count; absence preserves the source's unrestricted count. Never caller input. */
 expectedAffected?:number;
 reset:readonly string[];
}
interface MutationIdentity {pageId:string;pageVersion:number;sourceSha256:string;backendId:string;backendVersion:string}
export interface RegisteredMutationPlan extends MutationProgram {registration:MutationIdentity}
export interface MutationContext extends MutationIdentity {subject:string|null;callerKey:string}
export interface RegisteredMutationOutcome {requestId:string;outcome:'committed'|'rejected'|'unknown';revision:string|null;affected:number|null;reset:string[]}
/** Durable store owns canonical fingerprint collision/pending/unknown handling and committed replay. */
export interface RegisteredMutationPorts {
 authorize(context:MutationContext,plan:RegisteredMutationPlan,signal:AbortSignal):Promise<void>;
 durable(context:MutationContext,key:string,fingerprint:string,work:(receipt:unknown)=>Promise<RegisteredMutationOutcome>):Promise<RegisteredMutationOutcome>;
 platform(context:MutationContext):Promise<{userId:string|null;now:string;tz:string}>;
 /** Must use original policy-aware dataset transaction, expectedAffected rollback,
  * durable receipt completion and a page/source fence INSIDE the final CAS transaction. */
 commit(context:MutationContext,plan:RegisteredMutationPlan,params:Record<string,Scalar>,receipt:unknown,signal:AbortSignal):Promise<{outcome:'committed'|'rejected'|'unknown';revision:string|null;affected:number|null}>;
}
