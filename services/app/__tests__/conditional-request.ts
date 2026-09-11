/** Explicit fixture read → conditional write. Contract tests use request() directly to test missing guards. */
import {PATCH} from '@/app/api/artifacts/[id]/route';
import {getArtifactById} from '@/lib/artifacts';
import {artifactState} from '@/lib/artifact-state';
import {request,type RequestOptions} from './harness';
export async function observedRequest(path:string,options:RequestOptions):Promise<Request>{
 const match=path.match(/^\/api\/(?:my\/)?artifacts\/([^/?]+)(?:\/revert)?(?:\?.*)?$/);
 if(!match||!options.json||typeof options.json!=='object'||Array.isArray(options.json))return request(path,options);
 const row=await getArtifactById(match[1]);
 return request(path,{...options,json:{
  ...(options.method!=='PATCH'?{expectedVersion:row?.version??1}:{}),
  expectedState:row?artifactState(row):'0'.repeat(64),...options.json,
 }});
}

/** Metadata changes now use their own conditional, non-versioning route. */
export async function patchMetadata(token:string,id:string,body:Record<string,unknown>):Promise<Response>{
 return PATCH(await observedRequest(`/api/artifacts/${id}`,{method:'PATCH',token,json:body}),{params:Promise.resolve({id})});
}
