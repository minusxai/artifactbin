import {expect,it} from 'vitest';
import {request,useAppHarness,mintAccountToken} from './harness';
import {POST as prepare} from '@/app/api/artifacts/[id]/prepare/route';
import {POST as browserPrepare} from '@/app/api/my/artifacts/[id]/prepare/route';
import {POST as edits} from '@/app/api/artifacts/[id]/edits/route';
import {POST as browserEdits} from '@/app/api/my/artifacts/[id]/edits/route';
import {POST as preview} from '@/app/a/[id]/draft-preview/route';
import {POST as create} from '@/app/api/artifacts/route';
import {POST as preflight} from '@/app/api/artifacts/preflight/route';
import {OPERATIONS} from '@/lib/operations/registry';
useAppHarness();
const context={params:Promise.resolve({id:'abc123'})};
it('retired JSX prepare, edit and draft-preview endpoints are absent for every auth mode',async()=>{
 for(const handler of [prepare,browserPrepare,edits,browserEdits,preview]){
  const response=await handler(request('/retired',{method:'POST',json:{source:'<p>old</p>',document_update:{}}}),context);expect(response.status).toBe(404);
 }
});
it('the product operation catalog no longer offers prepared document edits',()=>{
 expect(OPERATIONS.map(operation=>operation.name)).not.toContain('edit_artifact');
});
it('native publication preflight does not offer an obsolete client-compiled edit mode',async()=>{
 const actor=await mintAccountToken('native-preflight');const created=await (await create(request('/api/artifacts',{method:'POST',token:actor.token,json:{html:'<html><head><title>Native</title></head><body>Page</body></html>'}}))).json();
 const response=await preflight(request('/api/artifacts/preflight',{method:'POST',token:actor.token,json:{id:created.id,mode:'edit',input:{document_update:{}}}}));expect(response.status).toBe(400);expect((await response.json()).error).toBe('invalid_preflight_mode');
});
