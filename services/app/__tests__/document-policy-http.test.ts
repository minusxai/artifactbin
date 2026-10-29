import {expect,it} from 'vitest';
import {nativeHtml} from './native-html-fixture';
import {artifactState, getArtifactById} from '@/lib/artifacts';
import { setDocumentEditorPolicy, claimToken } from '@/lib/authentication';
import {Hono} from 'hono';
import {createAuthHost} from '@artifactbin/auth';
import {createTokenReader,inProcess} from '@artifactbin/utils';
import {GET,PUT} from '@/app/api/artifacts/[id]/route';
import {GET as content} from '@/app/api/artifacts/[id]/content/route';
import {GET as capabilities} from '@/app/api/capabilities/route';
import {POST as preflight} from '@/app/api/artifacts/preflight/route';
import {GET as versions} from '@/app/api/artifacts/[id]/versions/route';
import {GET as version} from '@/app/api/artifacts/[id]/versions/[version]/route';
import { revokeToken, createUser } from '@/lib/accounts';
import { mintAccountToken as mintToken } from '@/__tests__/harness';
import {request,useAppHarness} from './harness';

const harness=useAppHarness();
it('HTTP native publication grants never reach private pages and end on verification loss, policy removal or token revocation',async()=>{
 const user=await createUser({email:'admin@example.com'}),token=await mintToken('mxmx_test_admin_cli',user.id);await claimToken(user.id,token.token);
 setDocumentEditorPolicy(actor=>actor.userId===user.id && actor.emailVerified===true);
 const db=await harness.db();
 for(const [id,title,visibility] of [['abc123','Unlisted document','unlisted'],['prv123','Private document','private']])
  await db.query(`INSERT INTO artifacts(id,token_id,user_id,title,source,meta,format,visibility,edit_id) VALUES ($1,'tok_owner','usr_owner',$2,$3,'{}','html',$4,'base-edit')`,[id,title,nativeHtml('<p data-af-id="intro">Before</p>'),visibility]);
 let identity={userId:user.id,email:user.email,emailVerified:true};
 const app=new Hono();
 app.get('/api/capabilities',c=>capabilities(c.req.raw));
 app.post('/api/artifacts/preflight',c=>preflight(c.req.raw));
 app.get('/api/artifacts/:id',c=>GET(c.req.raw,{params:Promise.resolve({id:c.req.param('id')})}));
 app.put('/api/artifacts/:id',c=>PUT(c.req.raw,{params:Promise.resolve({id:c.req.param('id')})}));
 app.get('/api/artifacts/:id/content',c=>content(c.req.raw,{params:Promise.resolve({id:c.req.param('id')})}));
 app.get('/api/artifacts/:id/versions',c=>versions(c.req.raw,{params:Promise.resolve({id:c.req.param('id')})}));
 app.get('/api/artifacts/:id/versions/:version',c=>version(c.req.raw,{params:Promise.resolve({id:c.req.param('id'),version:c.req.param('version')})}));
 const proxy=createAuthHost({upstream:inProcess(app),tokens:createTokenReader({db}),sessions:{resolve:async()=>null,identity:async()=>identity},cookieSecret:'mxmx_test_cookie_secret_0123456789',env:{}});
 const read=(id:string)=>proxy.fetch(request(`/api/artifacts/${id}`,{token:token.token}));
 const save=async(text:string)=>{
  const row=(await getArtifactById('abc123'))!;
  return proxy.fetch(request('/api/artifacts/abc123',{method:'PUT',token:token.token,json:{html:nativeHtml(`<p data-af-id="intro">${text}</p>`),expectedVersion:row.version,expectedState:artifactState(row)}}));
 };
 try{
  expect((await read('abc123')).status).toBe(200);
  const saved=await save('After HTTP repair');expect(saved.status,await saved.clone().text()).toBe(200);
  expect(await getArtifactById('abc123')).toMatchObject({user_id:'usr_owner',actor_user_id:user.id,actor_token_id:token.id,version:2,visibility:'unlisted'});
  const previous=await proxy.fetch(request('/api/artifacts/abc123/content?version=1',{token:token.token}));
  expect(previous.status).toBe(200);expect(await previous.text()).toContain('Before');
  expect((await read('prv123')).status).toBe(404);
  expect(await getArtifactById('prv123')).toMatchObject({version:1,actor_user_id:null});
  identity={...identity,emailVerified:false};expect((await save('Unverified')).status).toBe(404);
  identity={...identity,emailVerified:true};setDocumentEditorPolicy();expect((await save('Policy removed')).status).toBe(404);
  setDocumentEditorPolicy(actor=>actor.userId===user.id && actor.emailVerified===true);await revokeToken(token.id);
  expect((await read('abc123')).status).toBe(401);expect((await save('Revoked')).status).toBe(401);
  expect(await getArtifactById('abc123')).toMatchObject({version:2});
 }finally{setDocumentEditorPolicy();}
});
