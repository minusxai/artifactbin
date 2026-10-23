/** Retained native source/version lifecycle replaces obsolete compiled-graph
 * manifest tests. Whole-file CAS, metadata, fork and restore remain atomic. */
import {restoreDocument} from './prepared-document';
import {patchMetadata} from './conditional-request';
import {expect,it} from 'vitest';
import {useAppHarness,request,mintAccountToken} from './harness';
import {getArtifactById,artifactState} from '@/lib/artifacts';
import {POST as create} from '@/app/api/artifacts/route';
import {PUT as replace} from '@/app/api/artifacts/[id]/route';
import {POST as fork} from '@/app/api/artifacts/[id]/fork/route';
import {nativeHtml} from './native-html-fixture';
useAppHarness();const ctx=(id:string)=>({params:Promise.resolve({id})});
it('preserves native identities and immutable source across replace, metadata, fork and restore',async()=>{
 const token=await mintAccountToken('native-lifecycle');const made=await create(request('/api/artifacts',{method:'POST',token:token.token,json:{html:nativeHtml('<p data-af-id="paragraph">Before</p>')}}));expect(made.status).toBe(201);const {id}=await made.json();const first=(await getArtifactById(id))!;
 const changed=await replace(request(`/api/artifacts/${id}`,{method:'PUT',token:token.token,json:{html:first.source!.replace('Before','After'),expectedVersion:first.version,expectedState:artifactState(first)}}),ctx(id));expect(changed.status).toBe(200);const second=(await getArtifactById(id))!;
 const metadata=await patchMetadata(token.token,id,{title:'Renamed'});expect(metadata.status).toBe(200);const named=(await getArtifactById(id))!;expect(named.source).toBe(second.source);expect(named.title).toBe('Renamed');
 const copied=await fork(request(`/api/artifacts/${id}/fork`,{method:'POST',token:token.token,json:{}}),ctx(id));expect(copied.status).toBe(201);const copy=(await getArtifactById((await copied.json()).id))!;expect(copy.source).toBe(named.source);expect(copy.source).toContain('data-af-id="paragraph"');
 const restored=await restoreDocument(token.token,id,first.version);expect(restored.status).toBe(200);const head=(await getArtifactById(id))!;expect(head.source).toBe(first.source);expect(head.version).toBeGreaterThan(named.version);
});
