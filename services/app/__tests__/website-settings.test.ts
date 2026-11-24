import {expect,it} from 'vitest';
import {useAppHarness,mintAccountToken,request} from './harness';
import {GET,PUT,DELETE} from '@/app/api/my/website/route';
import {setUsername} from '@/lib/accounts';
import {getDb} from '@/lib/platform';
import {seedArtifacts,setArtifact} from './rows';

useAppHarness();
it('saves only live personal folders for the current account, with a unique row per label',async()=>{
  const user=await mintAccountToken('mxmx_test_site'), other=await mintAccountToken('mxmx_test_other');
  const db=await getDb(),path='/api/my/website';
  const actor={credential:'session' as const,userId:user.userId!,email:user.email!,emailVerified:true};
  await setUsername(user.userId!,'site_owner');
  const put=(label:string,folder:string|null,expected_folder_id?:string|null)=>PUT(request(path,{actor,method:'PUT',origin:'same',json:{subdomain_label:label,folder_id:folder,expected_folder_id}}));
  await seedArtifacts(db,{id:'folder1',format:'folder',user_id:user.userId},{id:'folder2',format:'folder',user_id:other.userId});
  expect((await GET(request(path))).status).toBe(401);
  expect((await put('notes','folder2')).status).toBe(404);
  expect((await put('bad.name',null)).status).toBe(400);
  expect((await Promise.all([put('notes','folder1'),put('notes','folder1')])).map(r=>r.status).sort()).toEqual([200,409]);
  expect((await put('x'.repeat(52),null)).status).toBe(400);
  expect((await put('notes',null,null)).status).toBe(409);
  expect((await put('notes',null,'folder1')).status).toBe(200);
  const staleRemove = await DELETE(request(path,{actor,method:'DELETE',origin:'same',json:{
    subdomain_label:'notes',expected_folder_id:'folder1',
  }}));
  expect(staleRemove.status).toBe(409);
  await setArtifact(db,'folder1',{deleted_at:{sql:'now()'}});
  expect((await put('notes','folder1')).status).toBe(404);
  expect(await (await GET(request(path,{actor}))).json()).toEqual({folders:[],roots:[{subdomain_label:'notes',folder_id:null}]});
  expect((await DELETE(request(path,{actor,method:'DELETE',origin:'same',json:{subdomain_label:'notes'}}))).status).toBe(200);
  expect(await (await GET(request(path,{actor}))).json()).toEqual({folders:[],roots:[]});
});
