/** Controls outside the live editor load an authoring snapshot, validate locally,
 * then submit one permission-scoped JSONB commit. Non-document metadata retains
 * its existing conditional protocol. */
import {artifactRequests} from './http';
import type {ArtifactBackend} from './types';
/** Listings, folders and the social preview: an online write whose caller reads the Response itself. */
export async function writeBrowserArtifact(id:string,change:Record<string,unknown>,editId?:string):Promise<Response>{
 const requests=artifactRequests(id);
 const observed=await requests.head();if(!observed.ok)return observed;
 const head=await observed.json() as {format?:string;state?:string;version:number;edit_id:string;markup?:string;html?:string;title?:string|null;description?:string|null;theme?:string|null;template?:string|null;colorMode?:string|null;sharing_revision?:number;ancestor_ids?:string[]};
 if(typeof head.state!=='string'||!Number.isSafeInteger(head.version))return Response.json({error:'invalid_response',details:[{message:'Refresh the artifact before saving.'}]},{status:502});
 const {source,annotationOps:_annotationOps,...fields}=change;
 if(head.format==='html'&&typeof source==='string'){
  if(head.edit_id!==editId)return Response.json({error:'doc_changed',edit_id:head.edit_id,version:head.version,source:head.html},{status:409});
  const response=await requests.htmlUpdate({...fields,html:source,expectedVersion:head.version,expectedState:head.state});
  if(response.status!==409)return response;
  // A race after the head read is a conflict, never an automatic replacement retry.
  const latest=await requests.head();if(!latest.ok)return response;
  const body=await latest.json() as {html?:string;edit_id?:string;version?:number};
  return Response.json({error:'doc_changed',edit_id:body.edit_id,version:body.version,source:body.html},{status:409});
 }

 if(source!==undefined)return Response.json({error:'not_editable'},{status:400});
 return requests.patch({...fields,expectedVersion:head.version,expectedState:head.state});
}

/** History keeps the same UX across format changes. Only document restores
 * compile a graph; restoring a native resource keeps its existing protocol.
 * Resolves with the NEW version the restore produced, or null when refused. */
export async function restoreBrowserArtifact(backend:ArtifactBackend,version:number):Promise<number|null>{
 const head=await backend.load();if(!head)return null;
 const target=await backend.version(version);if(!target)return null;
 const reverted=await backend.revert({version,expectedVersion:head.version,expectedState:head.state as string});
 return reverted.ok?reverted.body.version:null;
}
