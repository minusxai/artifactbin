import {it,expect,vi} from 'vitest';
vi.mock('@/lib/config',async original=>({...await original<typeof import('@/lib/config')>(),ASSETS_ORIGIN:'https://assets.example.test'}));
import {useAppHarness,request} from './harness';
import {POST as create} from '@/app/api/artifacts/route';
import {GET as resolve} from '@/app/a/[id]/assets/route';
import {GET as bytes} from '@/app/assets/ref/[id]/route';
import {mintToken} from '@/lib/tokens';
import {createUser} from '@/lib/users';
import {getDb} from '@/lib/db';
useAppHarness();
const params=(id:string)=>({params:Promise.resolve({id})});
it('serves anonymous-readable refs without cache copying and rechecks visibility for GET/HEAD',async()=>{
 const token=await mintToken('ref');
 const made=await create(request('/api/artifacts',{method:'POST',token:token.token,json:{file:{filename:'model.glb',contentType:'model/gltf-binary',base64:Buffer.from('model').toString('base64')}}}));
 expect(made.status).toBe(201);const id=(await made.json()).id;
 const source=await create(request('/api/artifacts',{method:'POST',token:token.token,json:{markup:'<p>Source</p>'}}));const sourceId=(await source.json()).id;
 const resolved=await resolve(request(`/a/${sourceId}/assets?kind=binary&u=ref:${id}`,{headers:{accept:'application/json'}}),params(sourceId));
 expect(resolved.status).toBe(200);expect(await resolved.json()).toEqual({url:'https://assets.example.test/assets/ref/'+id});
 const first=await bytes(new Request('https://assets.example.test/assets/ref/'+id),params(id));expect(first.status).toBe(200);expect(await first.text()).toBe('model');expect(first.headers.get('cache-control')).toBe('no-store');expect(first.headers.get('access-control-allow-origin')).toBe('*');
 await(await getDb()).query("update artifacts set visibility='unlisted' where id=$1",[id]);expect((await bytes(new Request('https://assets.example.test/assets/ref/'+id),params(id))).status).toBe(200);
 await(await getDb()).query("update artifacts set visibility='private' where id=$1",[id]);
 for(const method of ['GET','HEAD'])expect((await bytes(new Request('https://assets.example.test/assets/ref/'+id,{method,headers:{authorization:'Bearer '+token.token,cookie:'session=owner'}}),params(id))).status).toBe(404);
 expect((await(await getDb()).query('select * from web_assets')).rows).toEqual([]);
});
it('parent resolution refuses private targets even to their owner and unreadable source documents',async()=>{
 const user=await createUser({email:'ref-owner@example.test'}),token=await mintToken('ref-owner',user.id);
 const made=await create(request('/api/artifacts',{method:'POST',token:token.token,json:{file:{filename:'model.glb',contentType:'model/gltf-binary',base64:Buffer.from('private').toString('base64')}}}));const id=(await made.json()).id;
 const source=await create(request('/api/artifacts',{method:'POST',token:token.token,json:{markup:'<p>Private source</p>'}}));const sourceId=(await source.json()).id;
 for(const auth of [undefined,token.token]){
  const res=await resolve(request(`/a/${sourceId}/assets?kind=binary&u=ref:${id}`,{token:auth,headers:{accept:'application/json'}}),params(sourceId));expect(res.status).toBe(404);
 }
});
