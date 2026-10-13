import {afterEach,beforeEach,expect,it} from 'vitest';
import {Hono} from 'hono';
import {resolve} from 'node:path';
import {readFile,writeFile} from 'node:fs/promises';
import {createAuthHost} from '@artifactbin/auth';
import {createTokenReader,inProcess} from '@artifactbin/utils';
import {createDocumentGraph} from '@/lib/document/document-graph';
import {getArtifactById} from '@/lib/artifacts';
import {createUser,claimToken,setDocumentEditorPolicy} from '@/lib/accounts';
import {mintAccountToken as mintToken} from '@/__tests__/harness';
import {cliHarness,type RecordedCall} from '../../cli/test/harness';
import {GET,PUT} from '@/app/api/artifacts/[id]/route';
import {POST as prepare} from '@/app/api/artifacts/[id]/prepare/route';
import {POST as edit} from '@/app/api/artifacts/[id]/edits/route';
import {GET as content} from '@/app/api/artifacts/[id]/content/route';
import {GET as annotations,POST as annotate} from '@/app/api/artifacts/[id]/annotations/route';
import {GET as capabilities} from '@/app/api/capabilities/route';
import {POST as preflight} from '@/app/api/artifacts/preflight/route';
import {GET as versions} from '@/app/api/artifacts/[id]/versions/route';
import {GET as version} from '@/app/api/artifacts/[id]/versions/[version]/route';
import {request,useAppHarness} from './harness';
import {documentEditBody} from './prepared-document';

/**
 * The host's document editor grant (ADMIN__EMAILS in production) through the REAL production shape:
 * the auth proxy attaches verified claims, the app resolves the bearer, and every route reaches the
 * same decision. Two rules: an admin edits any document that is not private, through every door the
 * owner uses (the CLI's /prepare included); an admin reaches NO private artifact, by any door.
 */
const harness=useAppHarness();
// A <Query> makes the CLI prepare the authoring context (lib/document/document-update-client.ts),
// which is the door production refused. The CLI prepares only the CHANGED scope, so the edit must touch the Helmet.
const SOURCE='<Helmet><Value name="rows" type="table" value={[{"n":1}]} /><Query name="total">{`select sum(n) as n from rows`}</Query></Helmet><p id="intro">Before</p>';
type Doc={id:string;visibility:'public'|'unlisted'|'private'};
const UNLISTED:Doc={id:'unl123',visibility:'unlisted'},PRIVATE:Doc={id:'prv123',visibility:'private'};
let token:{id:string;token:string};let userId:string;let identity:{userId:string;email:string;emailVerified:boolean};let proxy:ReturnType<typeof createAuthHost>;

const routed=(handler:(request:Request,context:{params:Promise<Record<string,string>>})=>Promise<Response>|Response)=>
 (c:{req:{raw:Request;param:()=>Record<string,string>}})=>handler(c.req.raw,{params:Promise.resolve(c.req.param())});

beforeEach(async()=>{
 const user=await createUser({email:'admin@example.com'});userId=user.id;
 token=await mintToken('mxmx_test_admin_access',user.id);await claimToken(user.id,token.token);
 setDocumentEditorPolicy(actor=>actor.userId===user.id && actor.emailVerified===true);
 const db=await harness.db();
 await db.query("INSERT INTO users(id,email,kind) VALUES ('usr_owner','owner@example.com','account') ON CONFLICT DO NOTHING");
 for(const doc of [UNLISTED,PRIVATE])await db.query(`INSERT INTO artifacts(id,token_id,user_id,title,document,meta,format,visibility,edit_id) VALUES ($1,'tok_owner','usr_owner',$2,$3::jsonb,'{"dataSyntax":2}','markup',$4,'base-edit')`,[doc.id,`${doc.visibility} document`,JSON.stringify(createDocumentGraph(SOURCE,1)),doc.visibility]);
 identity={userId:user.id,email:user.email!,emailVerified:true};
 const app=new Hono();
 app.get('/api/capabilities',c=>capabilities(c.req.raw));
 app.post('/api/artifacts/preflight',c=>preflight(c.req.raw));
 app.get('/api/artifacts/:id',routed(GET));
 app.put('/api/artifacts/:id',routed(PUT));
 app.post('/api/artifacts/:id/prepare',routed(prepare));
 app.post('/api/artifacts/:id/edits',routed(edit));
 app.get('/api/artifacts/:id/content',routed(content));
 app.get('/api/artifacts/:id/annotations',routed(annotations));
 app.post('/api/artifacts/:id/annotations',routed(annotate));
 app.get('/api/artifacts/:id/versions',routed(versions));
 app.get('/api/artifacts/:id/versions/:version',routed(version));
 proxy=createAuthHost({upstream:inProcess(app),tokens:createTokenReader({db}),sessions:{resolve:async()=>null,identity:async()=>identity},cookieSecret:'mxmx_test_cookie_secret_0123456789',env:{}});
});
afterEach(()=>setDocumentEditorPolicy());

const bearer=(path:string,init:{method?:string;json?:unknown}={})=>proxy.fetch(request(path,{token:token.token,...init}));

it('lets an admin pull and push a non-private document whose save prepares an authoring context',async()=>{
 const cli=await cliHarness('admin-access-',{token:token.token,account:null,flags:['--server','https://example.com','--json']});
 const respond=(call:RecordedCall)=>proxy.fetch(request(call.path,{method:call.method,headers:call.headers,...(call.body===undefined?{}:{json:call.body})}));
 try{
  expect(await cli.invoke(['pull',UNLISTED.id,'--output','doc.jsx'],respond),JSON.stringify(cli.out)).toBe(0);
  const path=resolve(cli.root,'doc.jsx');await writeFile(path,(await readFile(path,'utf8')).replace('Before','After admin repair').replace('sum(n) as n','sum(n) + 0 as n'));
  expect(await cli.invoke(['push','doc.jsx'],respond),JSON.stringify(cli.out)).toBe(0);
  expect(cli.calls.some(call=>call.path.endsWith(`/api/artifacts/${UNLISTED.id}/prepare`)),'the push must exercise /prepare').toBe(true);
  expect(await getArtifactById(UNLISTED.id)).toMatchObject({user_id:'usr_owner',actor_user_id:userId,visibility:'unlisted',version:2});
  expect((await getArtifactById(UNLISTED.id))?.source).toContain('After admin repair');
 }finally{await cli.cleanup();}
});

it('refuses an admin every door to a private document with the uniform not-found, leaking nothing',async()=>{
 const row=(await getArtifactById(PRIVATE.id))!;
 const doors:Array<[string,Response|Promise<Response>]>=[
  ['read',bearer(`/api/artifacts/${PRIVATE.id}`)],
  ['content',bearer(`/api/artifacts/${PRIVATE.id}/content`)],
  ['versions',bearer(`/api/artifacts/${PRIVATE.id}/versions`)],
  ['prepare',bearer(`/api/artifacts/${PRIVATE.id}/prepare`,{method:'POST',json:{source:SOURCE}})],
  // A well-formed edit (prepared-document's protocol body), so the refusal is the access decision and not the body check.
  ['edits',bearer(`/api/artifacts/${PRIVATE.id}/edits`,{method:'POST',json:documentEditBody(row,{source:'<p id="intro">Admin</p>',whole:true})})],
  ['annotations',bearer(`/api/artifacts/${PRIVATE.id}/annotations`)],
  ['annotate',bearer(`/api/artifacts/${PRIVATE.id}/annotations`,{method:'POST',json:{node_id:'intro',body:'hello'}})],
 ];
 for(const [door,pending] of doors){
  const response=await pending,text=await response.text();
  expect(response.status,`${door}: ${text}`).toBe(404);
  expect(text,door).not.toContain('private document');
 }
 expect(await getArtifactById(PRIVATE.id)).toMatchObject({version:1,actor_user_id:null});
});

it('answers the read of a non-private document with the edit capability and no unrelated ACL column',async()=>{
 const response=await bearer(`/api/artifacts/${UNLISTED.id}`);
 expect(response.status).toBe(200);
 const body=await response.json() as Record<string,unknown>;
 expect(body.capabilities).toMatchObject({edit:true,delete:false});
 expect(body).not.toHaveProperty('access');
});
