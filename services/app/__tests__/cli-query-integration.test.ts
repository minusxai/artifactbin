import {expect,it} from 'vitest';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {useAppHarness,request} from './harness';
import {POST as create} from '@/app/api/artifacts/route';
import {GET as read} from '@/app/api/artifacts/[id]/route';
import {POST as mutate} from '@/app/api/artifacts/[id]/mutate/route';
import {mintToken} from '@/lib/tokens';
import {runCli} from '../../cli/src/dispatch';
import {saveConnection} from '../../cli/src/config';
useAppHarness();
it('the real CLI recovers a committed dataset mutation after its response is lost',async()=>{
 const root=await mkdtemp(join(tmpdir(),'afbin-cli-query-handlers-'));
 try{
  const token=await mintToken('mxmx_test_cli_query_handler');
  const initial=await create(request('/api/artifacts',{method:'POST',token:token.token,json:{dataset:[{n:1}],access:'readwrite'}}));expect(initial.status).toBe(201);const doc=await initial.json();const context={params:Promise.resolve({id:doc.id})};
  await saveConnection({server:'http://localhost:3000',token:token.token},root);await writeFile(join(root,'change.sql'),'insert into public.rows (n) values (2)');
  let lose=true;const keys:string[]=[];
  const transport:typeof fetch=async(input,init)=>{
   const req=new Request(input,init);
   if(new URL(req.url).pathname.endsWith('/mutate')){keys.push(req.headers.get('Idempotency-Key')!);const response=await mutate(req,context);if(lose){lose=false;throw Error('simulated lost response after commit');}return response;}
   return read(req,context);
  };
  const invoke=async()=>{const out:string[]=[];const code=await runCli(['query',doc.id,'--write','--input','change.sql','--json'],{cwd:root,home:root,env:{},interactive:false,fetch:transport,stdout:s=>out.push(s),stderr:()=>{}});return {code,result:JSON.parse(out.join(''))};};
  expect((await invoke()).result.error.code).toBe('outcome_unknown');
  const recovered=await invoke();expect(recovered.code,JSON.stringify(recovered)).toBe(0);expect(recovered.result.affected).toBe(1);expect(keys).toEqual([keys[0],keys[0]]);
  const state=await read(request(`/api/artifacts/${doc.id}`,{token:token.token}),context);expect((await state.json()).rows).toEqual([{n:1},{n:2}]);
 }finally{await rm(root,{recursive:true,force:true});}
});
