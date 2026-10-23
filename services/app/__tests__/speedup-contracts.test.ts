/** Native publication has no JSX compiler manifest: canonical source, identities
 * and viewer defaults are committed together through the original CAS door. */
import {expect,it} from 'vitest';
import {useAppHarness,request,mintAccountToken} from './harness';
import {POST as create} from '@/app/api/artifacts/route';
import {PUT as replace} from '@/app/api/artifacts/[id]/route';
import {getArtifactById,artifactState} from '@/lib/artifacts';
useAppHarness();
const html='<!doctype html><html><head><script type="application/json" data-af="state">{"choice":"one"}</script></head><body><p data-af-id="paragraph">Hello</p></body></html>';
it('commits exact native source and stable identities on create and guarded replacement',async()=>{
 const token=await mintAccountToken('native-contract');
 const made=await create(request('/api/artifacts',{method:'POST',token:token.token,json:{html}}));expect(made.status).toBe(201);const {id}=await made.json();
 const before=(await getArtifactById(id))!;expect(before.source).toContain('data-af-id="paragraph"');expect(before.source).toContain('{"choice":"one"}');
 const response=await replace(request(`/api/artifacts/${id}`,{method:'PUT',token:token.token,json:{html:before.source!.replace('Hello','Updated'),expectedVersion:before.version,expectedState:artifactState(before)}}),{params:Promise.resolve({id})});expect(response.status).toBe(200);
 const after=(await getArtifactById(id))!;expect(after.version).toBe(before.version+1);expect(after.source).toContain('data-af-id="paragraph">Updated');expect(after.source).toContain('{"choice":"one"}');
 expect(after.meta).not.toHaveProperty('parsedArtifact');
 const stale=await replace(request(`/api/artifacts/${id}`,{method:'PUT',token:token.token,json:{html,expectedVersion:before.version,expectedState:artifactState(before)}}),{params:Promise.resolve({id})});expect(stale.status).toBe(409);expect(await getArtifactById(id)).toEqual(after);
});
