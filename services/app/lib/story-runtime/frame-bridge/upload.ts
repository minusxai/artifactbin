import {DEFAULT_UPLOAD_MAX_BYTES,ARTIFACT_ID_PATTERN} from '@artifactbin/contracts';
import type {FrameBridgeParentPayload,FrameBridgeFramePayload} from '../contract';
type FileUploadRequest=Extract<FrameBridgeFramePayload,{kind:'upload-file'}>;
/** Credential-free child requests can only reach this document's ordinary file door. Server rechecks linked provenance and live dataset insert authority. */
export function relayedFileUpload(documentId:string,editId:string,readOnly:boolean,input:unknown):{path:string;init:RequestInit}|null {
 if(readOnly||!editId||!input||typeof input!=='object')return null;
 const r=input as FileUploadRequest;
 if(typeof r.datasetId!=='string'||!ARTIFACT_ID_PATTERN.test(r.datasetId)||typeof r.requestId!=='string'||! /^[\w.-]{8,120}$/.test(r.requestId)||typeof r.filename!=='string'||!r.filename||r.filename.length>255||!r.filename.isWellFormed()||/[\x00-\x1f\x7f/\\]/.test(r.filename)||typeof r.contentType!=='string'||! /^[a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+-]+$/i.test(r.contentType)||!(r.bytes instanceof Uint8Array)||!r.bytes.byteLength||r.bytes.byteLength>DEFAULT_UPLOAD_MAX_BYTES)return null;
 return {path:`/a/${encodeURIComponent(documentId)}/datasets/${encodeURIComponent(r.datasetId)}/files`,init:{method:'POST',headers:{'Content-Type':r.contentType,'X-Filename':encodeURIComponent(r.filename),'X-Edit-Id':editId,'Idempotency-Key':r.requestId},body:new Uint8Array(r.bytes)}};
}

export interface FileUploadRelayPorts {
 documentId:string; editId:string; readOnly:boolean;
 input:FileUploadRequest; signal:AbortSignal;
 appFetch:(path:string,init:RequestInit)=>Promise<Response>;
 reply:(answer:FrameBridgeParentPayload)=>void;
}
/** Upload validation, body copying and transport load only for an actual admitted upload request. */
export async function relayFileUpload(ports:FileUploadRelayPorts):Promise<void>{
 const request=relayedFileUpload(ports.documentId,ports.editId,ports.readOnly,ports.input);
 if(!request){ports.reply({kind:'fetch-result',call:ports.input.call,status:403,headers:{'content-type':'application/json'},body:JSON.stringify({error:'Upload is not permitted in this reader'})});return;}
 const response=await ports.appFetch(request.path,{...request.init,signal:ports.signal});
 ports.reply({kind:'fetch-result',call:ports.input.call,status:response.status,headers:{'content-type':'application/json'},body:await response.text()});
}
