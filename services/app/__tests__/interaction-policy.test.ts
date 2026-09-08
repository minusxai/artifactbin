import {expect,it,vi} from 'vitest';
const policy=vi.hoisted(()=>({anonymousLive:false}));
vi.mock('@/lib/config',async original=>({...await original<object>(),get PUBLIC_BASE_URL(){return 'http://localhost:3000';},get LIVE_UPDATES_ANON_ENABLED(){return policy.anonymousLive;}}));
import {attachActor} from '@artifactbin/utils';
import {POST as create} from '@/app/api/artifacts/route';
import {POST as mutate} from '@/app/a/[id]/mutate/route';
import {GET as events} from '@/app/a/[id]/events/route';
import {GET as frame} from '@/app/a/[id]/events/frame/route';
import {GET as authorize} from '@/app/a/[id]/events/authorize/route';
import {GET as page} from '@/app/api/page/artifact/[id]/route';
import {GET as raw} from '@/app/a/[id]/raw/route';
import {getArtifactById,updateSharingFor} from '@/lib/artifacts';
import {mintToken} from '@/lib/tokens';
import {createUser} from '@/lib/users';
import {request,useAppHarness} from './harness';
useAppHarness();
const trusted='http://localhost:3000';
it('commits a permitted non-owner dataset write immediately without consent',async()=>{
  const owner=await mintToken('owner');
  const viewer=await createUser({email:'mxmx_test_immediate_viewer@example.com'});
  const publish=async(body:object)=>{
    const response=await create(request('/api/artifacts',{method:'POST',token:owner.token,json:body}));
    expect(response.status).toBe(201);return (await response.json()).id as string;
  };
  const dataset=await publish({dataset:[{n:1}],access:'readwrite'});
  const document=await publish({markup:`<Helmet><Mutation name="add">{\`insert into ref_${dataset} values (2)\`}</Mutation></Helmet><Button run="$add">Add</Button>`});
  await updateSharingFor({tokenId:owner.id,userId:null},dataset,{shares:[{email:viewer.email,role:'editor'}]});
  const req=attachActor(new Request(`${trusted}/a/${document}/mutate`,{method:'POST',headers:{origin:trusted,'x-artifactbin-csrf':'1','content-type':'application/json'},body:JSON.stringify({mutation:'add'})}),{credential:'session',userId:viewer.id,email:viewer.email,sessionId:'session-one'});
  const response=await mutate(req,{params:Promise.resolve({id:document})});
  expect(response.status).toBe(200);
  expect(await response.json()).not.toHaveProperty('consentUrl');
  expect((await getArtifactById(dataset))?.version).toBe(2);
  const readOnly=attachActor(new Request(`${trusted}/a/${document}/mutate`,{method:'POST',headers:{origin:trusted,'x-artifactbin-csrf':'1','content-type':'application/json'},body:JSON.stringify({mutation:'add'})}),{credential:'read-session',userId:viewer.id,email:viewer.email});
  expect((await mutate(readOnly,{params:Promise.resolve({id:document})})).status).toBe(403);
  const write=(origin=trusted)=>mutate(attachActor(new Request(`${trusted}/a/${document}/mutate`,{method:'POST',headers:{origin,'x-artifactbin-csrf':'1','content-type':'application/json'},body:JSON.stringify({mutation:'add'})}),{credential:'session',userId:viewer.id,email:viewer.email}),{params:Promise.resolve({id:document})});
  // Cross-site guard here; the stricter main-vs-controls boundary is proxy-owned.
  expect((await write('https://evil.example')).status).toBe(403);
  await updateSharingFor({tokenId:owner.id,userId:null},dataset,{shares:[]});
  expect((await write()).status).toBe(403);
  const anonymous=request(`/a/${document}/mutate`,{method:'POST',json:{mutation:'add'}});
  expect((await mutate(anonymous,{params:Promise.resolve({id:document})})).status).toBe(403);
  expect((await getArtifactById(dataset))?.version).toBe(2);
});
it('does not allocate a live stream for an anonymous viewer when disabled',async()=>{
  const owner=await mintToken('owner');
  const created=await create(request('/api/artifacts',{method:'POST',token:owner.token,json:{markup:'<p>Public snapshot</p>'}}));
  const document=await created.json();
  const response=await events(request(`/a/${document.id}/events`),{params:Promise.resolve({id:document.id})});
  // 204 is EventSource’s explicit stop-reconnecting response.
  const status=response.status;
  if(response.body) await response.body.cancel();
  expect(status).toBe(204);
  expect(response.headers.get('cache-control')).toContain('no-store');
  const ctx={params:Promise.resolve({id:document.id})};
  expect((await frame(request(`/a/${document.id}/events/frame`),ctx)).status).toBe(204);
  expect((await authorize(request(`/a/${document.id}/events/authorize`),ctx)).status).toBe(204);
  expect((await (await page(request(`/api/page/artifact/${document.id}`),ctx)).json()).surface.liveEnabled).toBe(false);
  const rendered=await raw(request(`/a/${document.id}/raw`),ctx);
  expect(rendered.headers.get('cache-control')).toContain('no-store');
  expect(await rendered.text()).not.toContain('data-mx-live-id=');
});
it('preserves live eligibility for resolved identities and the default anonymous policy',async()=>{
  const owner=await mintToken('owner');
  const created=await create(request('/api/artifacts',{method:'POST',token:owner.token,json:{markup:'<p>Live</p>'}}));
  const {id}=await created.json();
  const ctx={params:Promise.resolve({id})};
  for(const credential of ['session','agent-cookie','bearer','read-session'] as const){
    const req=attachActor(request(`/api/page/artifact/${id}`),credential==='agent-cookie'||credential==='bearer'?{credential,tokenId:owner.id}:{credential,userId:(await createUser({email:`mxmx_test_${credential}@example.com`})).id});
    expect((await (await page(req,ctx)).json()).surface.liveEnabled).toBe(true);
    expect((await authorize(req,ctx)).status).toBe(200);
  }
  policy.anonymousLive=true;
  try {expect((await (await page(request(`/api/page/artifact/${id}`),ctx)).json()).surface.liveEnabled).toBe(true);}
  finally {policy.anonymousLive=false;}
});
