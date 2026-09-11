import {expect,it} from 'vitest';
import {request,useAppHarness} from './harness';
import {POST as create} from '@/app/api/artifacts/route';
import {PUT as replace} from '@/app/api/artifacts/[id]/route';
import {POST as edit} from '@/app/api/artifacts/[id]/edits/route';
import {mintToken} from '@/lib/tokens';
import {getArtifactById} from '@/lib/artifacts';
import {artifactState} from '@/lib/artifact-state';
useAppHarness();

it.each([true,false])('atomic replacement retains node-scoped history (content changed: %s)',async contentChanged=>{
 const token=await mintToken('mxmx_test_cli_mixed');
 const created=await create(request('/api/artifacts',{method:'POST',token:token.token,json:{markup:'<div><p>First</p><p>Second</p></div>'}}));
 expect(created.status).toBe(201);const {id}=await created.json();const base=(await getArtifactById(id))!;
 const params={params:Promise.resolve({id})};
 const changed=await replace(request(`/api/artifacts/${id}`,{method:'PUT',token:token.token,json:{markup:contentChanged?base.source!.replace('First','Writer one'):base.source,title:'New title',expectedVersion:base.version,expectedState:artifactState(base)}}),params);
 expect(changed.status).toBe(200);
 const concurrent=await edit(request(`/api/artifacts/${id}/edits`,{method:'POST',token:token.token,json:{edit_id:base.edit_id,source:base.source!.replace('Second','Writer two')}}),params);
 expect(concurrent.status,await concurrent.clone().text()).toBe(200);
 const head=(await getArtifactById(id))!;
 expect(head.source).toContain(contentChanged?'Writer one':'First');expect(head.source).toContain('Writer two');expect(head.title).toBe('New title');
});
