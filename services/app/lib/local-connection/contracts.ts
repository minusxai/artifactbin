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
export interface ConnectionGrant {capability:string;expires:number;role:string}
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
 revoke(capability:string):void;
}
export type ConnectionFailure='invalid_identity'|'signin_required'|'permission_required'|'unavailable'|'stale'|'revoked'|'capacity';
export class LocalConnectionError extends Error {
 constructor(readonly code:ConnectionFailure){super(code);}
}
export interface LocalConnection {
 retry():void;
 signIn():void;
 disconnect():void;
 dispose():void;
 request(operation:LocalOperation):Promise<unknown>;
}
/** Current readable remote head metadata. Observation grants no execution authority. */
export interface SourceObservation {remoteDigest:string;remoteRevision:string}
