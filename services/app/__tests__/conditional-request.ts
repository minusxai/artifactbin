/** Explicit fixture read → conditional write. Contract tests use request() directly to test missing guards. */
import {documentPublicationBody} from './prepared-document';
import {POST as editRoute} from '@/app/api/artifacts/[id]/edits/route';
import {PATCH} from '@/app/api/artifacts/[id]/route';
import {getArtifactById} from '@/lib/artifacts';
import {artifactState} from '@/lib/artifact-state';
import {request,type RequestOptions} from './harness';
export async function observedRequest(path:string,options:RequestOptions):Promise<Request>{
 const match=path.match(/^\/api\/(?:my\/)?artifacts\/([^/?]+)(?:\/revert)?(?:\?.*)?$/);
 if(!match||!options.json||typeof options.json!=='object'||Array.isArray(options.json))return request(path,options);
 const row=await getArtifactById(match[1]);
 if(row?.format==='markup'&&options.method==='PUT'&&(Object.hasOwn(options.json,'markup')||!Object.keys(options.json).some(key=>['dataset','viz','image','pdf'].includes(key))))return request(path,{...options,json:documentPublicationBody(row,options.json as Record<string,unknown>,true)});
 return request(path,{...options,json:{
  ...(options.method!=='PATCH'?{expectedVersion:row?.version??1}:{}),
  expectedState:row?artifactState(row):'0'.repeat(64),...options.json,
 }});
}

/** Documents use prepared operations; other formats keep conditional metadata. */
export async function patchMetadata(token:string,id:string,body:Record<string,unknown>):Promise<Response>{
 const row=await getArtifactById(id);
 if(row?.format==='markup')return editRoute(request(`/api/artifacts/${id}/edits`,{method:'POST',token,json:documentPublicationBody(row,body)}),{params:Promise.resolve({id})});
 return PATCH(await observedRequest(`/api/artifacts/${id}`,{method:'PATCH',token,json:body}),{params:Promise.resolve({id})});
}
