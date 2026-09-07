/** Private cache regression and explicit measurements of migration gaps. */
import {expect,it} from 'vitest';
import {samplePdfDataUrl} from '../../../scripts/lib/sample-pdf.mjs';
import {GET as raw} from '@/app/a/[id]/raw/route';
import {POST as create} from '@/app/api/artifacts/route';
import {mintToken} from '@/lib/tokens';
import {createUser} from '@/lib/users';
import {parseCookie} from '@/lib/http';
import {agentCookie,request,useAppHarness} from './harness';
useAppHarness();
it.each(['pdf','image'])('private %s is no-store even at versioned addresses',async(format)=>{
 const user=await createUser({email:'mxmx_test_boundary@example.com'});
 const owner=await mintToken('boundary',user.id);
 const content=format==='pdf' ? {pdf:samplePdfDataUrl(1)} : {image:'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAADAAAAAgCAIAAADbtmxLAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAASUlEQVRYhe2WAQkAQAwCF8dMpruoH2PPOFgAET03KV/drCuIgtChmqHYMtbxE8GIDtUMxZaxDqH4oKFDNUOxZcghBGOdjhwe1weeF8xbShDdKgAAAABJRU5ErkJggg=='};
 const result=await create(request('/api/artifacts',{method:'POST',token:owner.token,json:{...content,visibility:'private'}}));
 expect(result.status).toBe(201); const {id}=await result.json();
 const ctx={params:Promise.resolve({id})};
 const cookie=await agentCookie([owner.id]);
 for(const suffix of ['', '?v=1']){
  const res=await raw(request(`/a/${id}/raw${suffix}`,{cookie}),ctx);
  expect(res.status).toBe(200);
  expect(res.headers.get('cache-control')).toBe('no-store');
  await res.arrayBuffer();
 }
 expect((await raw(request(`/a/${id}/raw?v=1`),ctx)).status).toBe(404);
});
it('MEASURED: existing cookie parser chooses the first duplicate; new read credential needs strict parsing',()=>{
 expect(parseCookie('plan-read=first; plan-read=second','plan-read')).toBe('first');
 console.log('MEASURED duplicate cookie: first wins (not safe for new read-credential contract)');
});
