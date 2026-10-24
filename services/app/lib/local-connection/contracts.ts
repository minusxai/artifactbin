/** Shared 44px platform bar plus 32px local status strip. */
export const LOCAL_CHROME_COLLAPSED_HEIGHT=76;
/** Matching iframe and embedded-root schemes keep the browser canvas transparent, independently of UI appearance. */
export const LOCAL_CHROME_CANVAS_SCHEME='light';
/** Portable provenance is public metadata, never an authentication credential. */
export interface LinkedDocument {
 platformOrigin:string;
 artifactId:string;
 baseRevision:string;
 sourceDigest:string;
}
export type LocalConnectionState='offline'|'connecting'|'connected'|'signin-required'|'permission-required'|'blocked'|'stale'|'unavailable'|'unknown-outcome';
export interface LocalOperation {query:string;variables?:Record<string,unknown>;operationName?:string;operation?:'query'|'mutation'}
export interface ConnectionAdmission {identity:LinkedDocument;actor:string;role:string;authenticated?:boolean}
export interface ConnectionGrant {readOnly:true;capability:string;expires:number;role:string;authenticated:boolean}
export interface ConnectionAuthority {
 /** Called at admission and before/after protected reads. Must consult current ACL and head. */
 inspect(identity:LinkedDocument,previous?:ConnectionAdmission):Promise<ConnectionAdmission>;
 now?:()=>number;
 random?:()=>string;
 ttl?:number;
 capacity?:number;
}
export interface ConnectionRegistry {
 grant(identity:LinkedDocument):Promise<ConnectionGrant>;
 authorize(capability:string,artifactId:string):Promise<ConnectionAdmission>;
 status(capability:string,artifactId:string):Promise<{admission:ConnectionAdmission;compatible:boolean}>;
 revoke(capability:string):void;
}
export type ConnectionFailure='invalid_identity'|'signin_required'|'permission_required'|'unavailable'|'stale'|'revoked'|'capacity';
export class LocalConnectionError extends Error {
 constructor(readonly code:ConnectionFailure){super(code);}
}
export interface LocalConnection {
 retry():void;
 disconnect():void;
 dispose():void;
 request(operation:LocalOperation):Promise<unknown>;
}
/** Current readable remote head metadata. Observation grants no execution authority. */
export interface SourceObservation {remoteDigest:string;remoteRevision:string}

export interface ConnectionStatus extends SourceObservation {compatible:boolean;role:string}
export interface ConnectionMonitorOptions {
 poll(signal:AbortSignal):Promise<ConnectionStatus>;
 onStatus(value:ConnectionStatus):void;
 onFailure(error:unknown):void;
 foreground():boolean;
 now?:()=>number;
 schedule?:(callback:()=>void,delay:number)=>unknown;
 cancel?:(handle:unknown)=>void;
 intervalMs?:number;
 timeoutMs?:number;
}

/** Advisory parent-observed source bytes; never authority, provenance or a write grant. */
export interface LocalSourceEvidence {kind:'local-source-evidence';localDigest:string}
export function validLocalSourceEvidence(value:unknown):value is LocalSourceEvidence {
 if(!value||typeof value!=='object')return false;const data=value as Record<string,unknown>;
 return Object.keys(data).length===2&&data.kind==='local-source-evidence'&&typeof data.localDigest==='string'&&/^[a-f0-9]{64}$/.test(data.localDigest);
}
