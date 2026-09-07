import {expect,it,vi} from 'vitest';
vi.mock('@/lib/config',async original=>({...await original<object>(),CONTROLS_ORIGIN:'http://i.localhost:3000',get PUBLIC_BASE_URL(){return 'http://localhost:3000';}}));
import {attachActor} from '@artifactbin/utils';
import {POST as create} from '@/app/api/artifacts/route';
import {POST as mutate} from '@/app/a/[id]/mutate/route';
import {GET as review,POST as approve} from '@/app/mutation-consent/[code]/route';
import {getArtifactById,updateSharingFor} from '@/lib/artifacts';
import {getDb} from '@/lib/db';
import {mintToken} from '@/lib/tokens';
import {createUser} from '@/lib/users';
import {request,useAppHarness} from './harness';
useAppHarness();
const trusted='http://i.localhost:3000';
async function fixture(){
  const owner=await mintToken('owner');
  const viewer=await createUser({email:'mxmx_test_consent_viewer@example.com'});
  const publish=async(body:object)=>{
    const response=await create(request('/api/artifacts',{method:'POST',token:owner.token,json:body}));
    expect(response.status,await response.clone().text()).toBe(201);return (await response.json()).id as string;
  };
  const dataset=await publish({dataset:[{n:1}],access:'readwrite'});
  const document=await publish({markup:`<Helmet><Value name="n" type="number" default={2}/><Mutation name="add">{\`insert into ref_${dataset} values ($n)\`}</Mutation></Helmet><Button run="$add">Add</Button>`});
  await updateSharingFor({tokenId:owner.id,userId:null},dataset,{shares:[{email:viewer.email,role:'editor'}]});
  const asViewer=(url:string,init:RequestInit={},sessionId='session-one')=>attachActor(new Request(url,init),{credential:'session',userId:viewer.id,email:viewer.email,sessionId});
  const write=()=>mutate(asViewer(`${trusted}/a/${document}/mutate`,{method:'POST',headers:{origin:trusted,'content-type':'application/json'},body:JSON.stringify({mutation:'add'})}),{params:Promise.resolve({id:document})});
  const prepare=async()=>{
    const response=await write();expect(response.status).toBe(202);
    expect((await getArtifactById(dataset))?.version).toBe(1);
    const body=await response.json();expect(body.error).toBe('consent_required');
    const url=body.consentUrl as string;expect(url).toMatch(/^http:\/\/i\.localhost:3000\/mutation-consent\/[A-Za-z0-9_-]{43}$/);
    return {url,code:url.split('/').at(-1)!};
  };
  const confirm=(url:string,code:string,sessionId='session-one')=>approve(asViewer(url,{method:'POST',headers:{origin:trusted,'content-type':'application/x-www-form-urlencoded'},body:'approve=yes'},sessionId),{params:Promise.resolve({code})});
  return {owner,viewer,dataset,document,asViewer,prepare,confirm};
}
it('requires trusted review before a non-owner write, then commits only once',async()=>{
  const f=await fixture();const {url,code}=await f.prepare();
  const page=await review(f.asViewer(url),{params:Promise.resolve({code})});
  expect(page.status).toBe(200);
  expect(page.headers.get('content-security-policy')).toContain("frame-ancestors 'none'");
  expect(page.headers.get('cache-control')).toBe('no-store');
  const html=await page.text();expect(html).toContain(f.dataset);expect(html).toContain('insert into');
  expect(html).toContain('&quot;n&quot;: 2');
  expect((await f.confirm(url,code)).status).toBe(303);
  expect((await getArtifactById(f.dataset))?.version).toBe(2);
  expect((await f.confirm(url,code)).status).toBe(404);
});
it('expires approvals and rejects missing/full-read-only identity',async()=>{
  const f=await fixture();const {url,code}=await f.prepare();
  expect((await review(new Request(url),{params:Promise.resolve({code})})).status).toBe(404);
  expect((await review(attachActor(new Request(url),{credential:'read-session',userId:f.viewer.id}),{params:Promise.resolve({code})})).status).toBe(404);
  await (await getDb()).query("UPDATE codes SET expires_at=now()-interval '1 second' WHERE kind='mutation-consent'");
  expect((await f.confirm(url,code)).status).toBe(404);
  expect((await getArtifactById(f.dataset))?.version).toBe(1);
});
it('checks current dataset ACL and refuses wrong-origin approval without consuming it',async()=>{
  const f=await fixture();const {url,code}=await f.prepare();
  const forged=f.asViewer(url,{method:'POST',headers:{origin:'http://localhost:3000','content-type':'application/x-www-form-urlencoded'},body:'approve=yes'});
  expect((await approve(forged,{params:Promise.resolve({code})})).status).toBe(403);
  await updateSharingFor({tokenId:f.owner.id,userId:null},f.dataset,{shares:[]});
  expect((await f.confirm(url,code)).status).toBe(403);
  expect((await getArtifactById(f.dataset))?.version).toBe(1);
});
it('consumes an approval atomically under concurrent submissions',async()=>{
  const f=await fixture();const {url,code}=await f.prepare();
  const responses=await Promise.all([f.confirm(url,code),f.confirm(url,code)]);
  expect(responses.map(r=>r.status).sort()).toEqual([303,404]);
  expect((await getArtifactById(f.dataset))?.version).toBe(2);
});
it('denies another session without consuming the real approval',async()=>{
  const f=await fixture();const {url,code}=await f.prepare();
  expect((await f.confirm(url,code,'session-two')).status).toBe(404);
  expect((await f.confirm(url,code)).status).toBe(303);
});
it('refuses a changed document and does not touch the dataset',async()=>{
  const f=await fixture();const {url,code}=await f.prepare();
  await (await getDb()).query('UPDATE artifacts SET edit_id=md5(random()::text) WHERE id=$1',[f.document]);
  expect((await f.confirm(url,code)).status).toBe(409);
  expect((await getArtifactById(f.dataset))?.version).toBe(1);
});
