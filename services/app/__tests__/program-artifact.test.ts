import {expect,it} from 'vitest';
import {useAppHarness,request,mintAccountToken} from './harness';
import {POST as publish} from '@/app/api/artifacts/route';
useAppHarness();
it('refuses retired executable program authoring',async()=>{
 const token=await mintAccountToken('retired-program');
 for(const body of [{program:{version:1,command:['node','task.js']}},{format:'program',program:'{}'}]){
  const response=await publish(request('/api/artifacts',{method:'POST',token:token.token,json:body}));
  expect(response.status).toBe(400);
  expect((await response.json()).error).toBe('unsupported_format');
 }
});
