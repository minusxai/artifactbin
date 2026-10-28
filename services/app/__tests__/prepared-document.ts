import {POST as revertRoute} from '@/app/api/artifacts/[id]/revert/route';
import {artifactState} from '@/lib/artifacts/state';
import { getArtifactById } from '@/lib/artifacts/rows';
import {request} from './harness';

/** Native restores retain the original artifact/version authority and CAS. */
export async function restoreDocument(token:string,id:string,version:number):Promise<Response>{
 const head=await getArtifactById(id);if(!head)throw new Error('Missing artifact');
 return revertRoute(request(`/api/artifacts/${id}/revert`,{method:'POST',token,json:{version,expectedVersion:head.version,expectedState:artifactState(head)}}),{params:Promise.resolve({id})});
}