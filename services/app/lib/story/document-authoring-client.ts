import type {DocumentAssetWarning} from '@artifactbin/contracts';
/** Browser transport for authoring inputs; ordinary prose and attribute edits
 * do not call it. The document itself is committed only by /edits. */
import {prepareClientDocumentPublication,type ClientDocumentSnapshot,type ClientDocumentChange} from './document-update-client';
export async function prepareBrowserDocumentUpdate(id:string,base:ClientDocumentSnapshot,change:ClientDocumentChange,onWarnings?:(warnings:DocumentAssetWarning[])=>void){
 return prepareClientDocumentPublication(base,change,async source=>{
  const response=await fetch(`/api/my/artifacts/${encodeURIComponent(id)}/prepare`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({source})});
  if(response.ok)return response.json();
  const body=await response.json().catch(()=>({}));
  const message=body.details?.map((d:unknown)=>typeof d==='string'?d:(d as {message?:string})?.message).filter(Boolean).join('\n');
  throw new Error(message||body.error||'Unable to prepare document resources');
 },onWarnings);
}
