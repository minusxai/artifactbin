/** Publish the actual apps-reference query and exercise its membership boundary. */
import {readFileSync} from 'node:fs';
import path from 'node:path';
import {expect,it} from 'vitest';
import {POST as create} from '@/app/api/artifacts/route';
import {GET as query} from '@/app/a/[id]/query/route';
import {getArtifactById} from '@/lib/artifacts';
import {changeMembership} from '@/lib/membership';
import {mintToken} from '@/lib/tokens';
import {claimToken,createUser} from '@/lib/users';
import {request,useAppHarness} from './harness';
useAppHarness();
it('publishes the reference and exposes accepted members, never pending requests or custom join rows',async()=>{
 const owner=await createUser({email:'mxmx_test_example_owner@example.com'}),reader=await createUser({email:'mxmx_test_example_reader@example.com'});
 const token=await mintToken('apps-example');await claimToken(owner.id,token.token);
 const reference=readFileSync(path.resolve(process.cwd(),'skills/artifactbin/references/apps.md'),'utf8');
 const source=[...reference.matchAll(/```jsx\n([\s\S]*?)```/g)].map(m=>m[1]!).find(s=>s.includes('<Helmet>'))!;
 const res=await create(request('/api/artifacts',{method:'POST',token:token.token,json:{markup:source,visibility:'public'}}));
 expect(res.status,await res.clone().text()).toBe(201);const {id}=await res.json();
 const read=async()=>{const r=await query(request(`/a/${id}/query?q=%7B%7D`),{params:Promise.resolve({id})});expect(r.status).toBe(200);return (await r.json()).tables.members.rows.map((m:{user_id:string})=>m.user_id);};
 expect(await read()).toEqual([owner.id]);
 await changeMembership({userId:reader.id,tokenId:null},id,{action:'join'});
 expect(await read()).toEqual([owner.id]);
 await changeMembership({userId:owner.id,tokenId:token.id},id,{action:'approve',userId:reader.id});
 expect(await read()).toEqual([owner.id,reader.id]);
 await changeMembership({userId:reader.id,tokenId:null},id,{action:'leave'});
 expect(await read()).toEqual([owner.id]);
 expect((await getArtifactById(id))?.source).not.toContain('<Mutation');
});
