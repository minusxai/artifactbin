/** Explicit fixture read → conditional write. Contract tests use request() directly to test missing guards. */
import {PATCH} from '@/app/api/artifacts/[id]/route';
import { getArtifactById, artifactState } from '@/lib/artifacts';
import {request,type RequestOptions} from './harness';
const SHARING_FIELDS=['visibility','linkRole','access','shares'];
export async function observedRequest(path:string,options:RequestOptions):Promise<Request>{
 const match=path.match(/^\/api\/(?:my\/)?artifacts\/([^/?]+)(?:\/revert)?(?:\?.*)?$/);
 if(!match||!options.json||typeof options.json!=='object'||Array.isArray(options.json))return request(path,options);
 const row=await getArtifactById(match[1]);
 return request(path,{...options,json:{
  ...(options.method!=='PATCH'?{expectedVersion:row?.version??1}:{}),
  expectedState:row?artifactState(row):'0'.repeat(64),
  // Access settings fence on the sharing revision the read observed (lib/artifact-wire parseSharingRevision).
  ...(SHARING_FIELDS.some(key=>key in (options.json as object))?{expectedSharingRevision:row?.sharing_revision??0}:{}),...options.json,
 }});
}

/** Metadata writes use the original conditional artifact API. */
export async function patchMetadata(token:string,id:string,body:Record<string,unknown>):Promise<Response>{
 return PATCH(await observedRequest(`/api/artifacts/${id}`,{method:'PATCH',token,json:body}),{params:Promise.resolve({id})});
}
