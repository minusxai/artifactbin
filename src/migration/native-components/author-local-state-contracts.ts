import type {NativeJson} from './analyze-contracts.ts';
/** Viewer-local Apollo fields only. This port confers no backend/query/mutation authority. */
export interface NativeAuthorLocalField {name:string;type:'string'|'number'|'boolean'|'date';nullable:boolean;default:NativeJson}
export interface NativeAuthorLocalPlan {fields:readonly NativeAuthorLocalField[]}
export interface NativeAuthorLocalPort {
 signal(name:string):readonly [()=>NativeJson,(value:NativeJson)=>void];
 get(name:string):NativeJson;
 set(name:string,value:NativeJson):void;
 subscribe(listener:()=>void):()=>void;
 dispose():void;
}
export interface NativeAuthorLocalSource {source:string;plan:NativeAuthorLocalPlan;runtime:'page-signal'|'legacy-mx-params'}
