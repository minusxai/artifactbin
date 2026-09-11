import {expect,it} from 'vitest';
import {mkdtemp,writeFile,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {useAppHarness,request} from './harness';
import {POST as create} from '@/app/api/artifacts/route';
import {GET as read,PUT as replace,PATCH as metadata} from '@/app/api/artifacts/[id]/route';
import {GET as content} from '@/app/api/artifacts/[id]/content/route';
import {POST as mutate} from '@/app/api/artifacts/[id]/mutate/route';
import {mintToken} from '@/lib/tokens';
import {runCli} from '../../cli/src/dispatch';
import {saveConnection} from '../../cli/src/config';
import {parseResourceFile} from '../../cli/src/resource-file';
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

it('native YAML dataset publication enables a subsequent real SQL write and preserves one local resource identity',async()=>{
 const root=await mkdtemp(join(tmpdir(),'afbin-cli-resource-handlers-'));
 try{
  const token=await mintToken('mxmx_test_cli_resource_handler');await saveConnection({server:'http://localhost:3000',token:token.token},root);
  await writeFile(join(root,'sales.csv'),'n\n1\n');await writeFile(join(root,'sales.yaml'),'type: dataset\nsource: ./sales.csv\naccess: readwrite\n');
  const transport:typeof fetch=async(input,init)=>{
   const req=new Request(input,init),path=new URL(req.url).pathname;
   if(path==='/api/artifacts')return create(req);
   const id=path.split('/')[3],context={params:Promise.resolve({id})};
   if(path.endsWith('/mutate'))return mutate(req,context);
   if(path.endsWith('/content'))return content(req,context);
   return req.method==='PUT'?replace(req,context):req.method==='PATCH'?metadata(req,context):read(req,context);
  };
  const invoke=async(args:string[])=>{const out:string[]=[];const code=await runCli([...args,'--json'],{cwd:root,home:root,env:{},interactive:false,fetch:transport,stdout:s=>out.push(s),stderr:()=>{}});return{code,result:JSON.parse(out.join(''))};};
  const published=await invoke(['push','sales.yaml']);expect(published.code,JSON.stringify(published)).toBe(0);
  const file=parseResourceFile(await readFile(join(root,'sales.yaml'),'utf8'));expect(file.type).toBe('dataset');expect(file.id).toBeTruthy();
  await writeFile(join(root,'change.sql'),'insert into public.rows (n) values (2)');
  const changed=await invoke(['query','sales.yaml','--write','--input','change.sql']);expect(changed.code,JSON.stringify(changed)).toBe(0);expect(changed.result.affected).toBe(1);
  const snapshot=await read(request(`/api/artifacts/${file.id}`,{token:token.token}),{params:Promise.resolve({id:file.id!})});expect((await snapshot.json()).rows).toEqual([{n:1},{n:2}]);
  const pulled=await invoke(['pull','sales.yaml']);expect(pulled.code,JSON.stringify(pulled)).toBe(0);expect(await readFile(join(root,'sales.csv'),'utf8')).toBe('n\n1\n2\n');
 }finally{await rm(root,{recursive:true,force:true});}
});
