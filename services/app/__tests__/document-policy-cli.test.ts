import {expect,it} from 'vitest';
import {createDocumentGraph} from '@/lib/document/document-graph';
import {setDocumentEditorPolicy} from '@/lib/accounts';
import {Hono} from 'hono';
import {createAuthHost} from '@artifactbin/auth';
import {createTokenReader,inProcess} from '@artifactbin/utils';
import {resolve} from 'node:path';
import {readFile,writeFile} from 'node:fs/promises';
import {cliHarness,type RecordedCall} from '../../cli/test/harness';
import {GET,PUT} from '@/app/api/artifacts/[id]/route';
import {POST as edit} from '@/app/api/artifacts/[id]/edits/route';
import {GET as content} from '@/app/api/artifacts/[id]/content/route';
import {GET as capabilities} from '@/app/api/capabilities/route';
import {POST as preflight} from '@/app/api/artifacts/preflight/route';
import {GET as versions} from '@/app/api/artifacts/[id]/versions/route';
import {GET as version} from '@/app/api/artifacts/[id]/versions/[version]/route';
import {getArtifactById} from '@/lib/artifacts';
import { revokeToken } from '@/lib/accounts';
import { mintAccountToken as mintToken } from '@/__tests__/harness';
import {createUser,claimToken} from '@/lib/accounts';
import {request,useAppHarness} from './harness';

const harness=useAppHarness();
it('ordinary afbin pull/push works across owners on a non-private document, never reaches a private one, and loses the edit on verification, policy removal or token revocation',async()=>{
 const user=await createUser({email:'admin@example.com'}),token=await mintToken('mxmx_test_admin_cli',user.id);await claimToken(user.id,token.token);
 setDocumentEditorPolicy(actor=>actor.userId===user.id && actor.emailVerified===true);
 const db=await harness.db();
 for(const [id,title,visibility] of [['abc123','Unlisted document','unlisted'],['prv123','Private document','private']])
  await db.query(`INSERT INTO artifacts(id,token_id,user_id,title,document,meta,format,visibility,edit_id) VALUES ($1,'tok_owner','usr_owner',$2,$3::jsonb,'{"dataSyntax":2}','markup',$4,'base-edit')`,[id,title,JSON.stringify(createDocumentGraph('<p id="intro">Before</p>',1)),visibility]);
 let identity={userId:user.id,email:user.email,emailVerified:true};
 const app=new Hono();
 app.get('/api/capabilities',c=>capabilities(c.req.raw));
 app.post('/api/artifacts/preflight',c=>preflight(c.req.raw));
 app.get('/api/artifacts/:id',c=>GET(c.req.raw,{params:Promise.resolve({id:c.req.param('id')})}));
 app.put('/api/artifacts/:id',c=>PUT(c.req.raw,{params:Promise.resolve({id:c.req.param('id')})}));
 app.post('/api/artifacts/:id/edits',c=>edit(c.req.raw,{params:Promise.resolve({id:c.req.param('id')})}));
 app.get('/api/artifacts/:id/content',c=>content(c.req.raw,{params:Promise.resolve({id:c.req.param('id')})}));
 app.get('/api/artifacts/:id/versions',c=>versions(c.req.raw,{params:Promise.resolve({id:c.req.param('id')})}));
 app.get('/api/artifacts/:id/versions/:version',c=>version(c.req.raw,{params:Promise.resolve({id:c.req.param('id'),version:c.req.param('version')})}));
 const proxy=createAuthHost({upstream:inProcess(app),tokens:createTokenReader({db}),sessions:{resolve:async()=>null,identity:async()=>identity},cookieSecret:'mxmx_test_cookie_secret_0123456789',env:{}});
 const cli=await cliHarness('admin-cli-access-', {token:token.token,account:null,flags:['--server','https://example.com','--json']});
 const respond=(call:RecordedCall)=>proxy.fetch(request(call.path,{method:call.method,headers:call.headers,...(call.body===undefined?{}:{json:call.body})}));
 const path=()=>resolve(cli.root,'repair.jsx');
 const change=async(from:string,to:string)=>writeFile(path(),(await readFile(path(),'utf8')).replace(from,to));
 try {
  expect(await cli.invoke(['pull','abc123','--output','repair.jsx'],respond),JSON.stringify(cli.out)).toBe(0);
  await change('Before','After ordinary CLI repair');
  expect(await cli.invoke(['push','repair.jsx'],respond),JSON.stringify(cli.out)).toBe(0);
  expect(await getArtifactById('abc123')).toMatchObject({user_id:'usr_owner',actor_user_id:user.id,actor_token_id:token.id,version:2,visibility:'unlisted'});
  expect((await getArtifactById('abc123'))?.source).toContain('After ordinary CLI repair');
  expect(await cli.invoke(['log','abc123'],respond),JSON.stringify(cli.out)).toBe(0);
  const previous=await proxy.fetch(request('/api/artifacts/abc123/content?version=1',{token:token.token}));
  expect(previous.status).toBe(200);expect(await previous.text()).toContain('Before');
  // The private sibling is the uniform not-found, by the same CLI and the same admin.
  expect(await cli.invoke(['pull','prv123','--output','private.jsx'],respond)).not.toBe(0);expect(cli.last().error.code).toBe('not_found');
  expect(await getArtifactById('prv123')).toMatchObject({version:1,actor_user_id:null});
  // The grant is the edit, not the read: without it the link still reads, and the push is refused.
  identity={...identity,emailVerified:false};await change('After ordinary CLI repair','Unverified');expect(await cli.invoke(['push','repair.jsx'],respond)).not.toBe(0);
  identity={...identity,emailVerified:true};setDocumentEditorPolicy();expect(await cli.invoke(['push','repair.jsx'],respond)).not.toBe(0);
  setDocumentEditorPolicy(actor=>actor.userId===user.id && actor.emailVerified===true);await revokeToken(token.id);expect((await proxy.fetch(request('/api/artifacts/abc123',{token:token.token}))).status).toBe(401);expect(await cli.invoke(['pull','repair.jsx'],respond)).not.toBe(0);
  expect(await getArtifactById('abc123')).toMatchObject({version:2});
 }finally{setDocumentEditorPolicy();await cli.cleanup();}
});
