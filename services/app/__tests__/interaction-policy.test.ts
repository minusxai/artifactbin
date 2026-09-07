import {expect,it,vi} from 'vitest';
const policy=vi.hoisted(()=>({anonymousLive:false}));
vi.mock('@/lib/config',async original=>({...await original<object>(),CONTROLS_ORIGIN:'http://i.localhost:3000',get PUBLIC_BASE_URL(){return 'http://localhost:3000';},get LIVE_UPDATES_ANON_ENABLED(){return policy.anonymousLive;}}));
import {attachActor} from '@artifactbin/utils';
import {POST as create} from '@/app/api/artifacts/route';
import {POST as mutate} from '@/app/a/[id]/mutate/route';
import {GET as events} from '@/app/a/[id]/events/route';
import {getArtifactById,updateSharingFor} from '@/lib/artifacts';
import {mintToken} from '@/lib/tokens';
import {createUser} from '@/lib/users';
import {request,useAppHarness} from './harness';
useAppHarness();
const trusted='http://i.localhost:3000';
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
  const req=attachActor(new Request(`${trusted}/a/${document}/mutate`,{method:'POST',headers:{origin:trusted,'content-type':'application/json'},body:JSON.stringify({mutation:'add'})}),{credential:'session',userId:viewer.id,email:viewer.email,sessionId:'session-one'});
  const response=await mutate(req,{params:Promise.resolve({id:document})});
  expect(response.status).toBe(200);
  expect(await response.json()).not.toHaveProperty('consentUrl');
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
});
