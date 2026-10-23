import type {ArtifactRow} from '@/lib/artifacts/table';
import {artifactState} from '@/lib/artifacts/state';
/** Explicit native source fixture; credentials and request creation stay in the app harness. */
export function nativeSource(content:string):string{return /^\s*<!doctype html>/i.test(content)?content:`<!doctype html><html><head><title>Fixture</title></head><body>${content}</body></html>`;}
export function nativePublicationBody(row:ArtifactRow,body:Record<string,unknown>,_whole?:boolean){
 const {html,source,...metadata}=body;
 return {...metadata,html:nativeSource(String(html??source??row.source??'')),expectedVersion:body.expectedVersion??row.version,expectedState:body.expectedState??artifactState(row)};
}
