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
import {GET as raw} from '@/app/a/[id]/raw/route';
import {POST as mutate} from '@/app/a/[id]/mutate/route';
import {GET as events} from '@/app/a/[id]/events/route';
import {GET as exportImage} from '@/app/api/artifacts/[id]/export/route';
import {GET as list} from '@/app/api/artifacts/route';
import {GET as changes} from '@/app/api/artifacts/[id]/annotations/changes/route';
import {GET as commentImage} from '@/app/api/artifacts/[id]/comment-images/[imageId]/route';
import {GET as myArtifact} from '@/app/api/my/artifacts/[id]/route';
import {POST as myComment} from '@/app/api/my/artifacts/[id]/annotations/route';
import {GET as pageArtifact} from '@/app/api/page/artifact/[id]/route';
import {identityForUser,sessionActor} from '@/lib/accounts';
import {selectChildren} from '@/lib/artifacts';
import {stageCommentImage} from '@/lib/annotations';
import sharp from 'sharp';
import type {Actor} from '@artifactbin/contracts';
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

const routed=<P extends Record<string,string>>(handler:(request:Request,context:{params:Promise<P>})=>Promise<Response>|Response)=>
 (c:{req:{raw:Request;param:()=>Record<string,string>}})=>handler(c.req.raw,{params:Promise.resolve(c.req.param() as P)});

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
 app.get('/api/artifacts',c=>list(c.req.raw));
 app.get('/api/artifacts/:id/export',routed(exportImage));
 app.get('/api/artifacts/:id/annotations/changes',routed(changes));
 app.get('/api/artifacts/:id/comment-images/:imageId',routed(commentImage));
 app.get('/a/:id/raw',routed(raw));
 app.post('/a/:id/mutate',routed(mutate));
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

const params=(id:string)=>({params:Promise.resolve({id})});
/** The owner comments with an image on a document, so the image door has something real to refuse. */
async function ownerImage(doc:Doc):Promise<string>{
 const owner=identityForUser('usr_owner','tok_owner'),row=(await getArtifactById(doc.id))!;
 const png=await sharp({create:{width:20,height:10,channels:3,background:'red'}}).png().toBuffer();
 const stage=await stageCommentImage(owner,doc.id,png,png,{v:1,capturedEditId:row.edit_id,capturedAt:new Date().toISOString(),method:'region',width:20,height:10,rect:{x:0,y:0,width:20,height:10},viewport:{width:1000,height:800},strokes:[]});
 if(stage instanceof Response)throw new Error(await stage.text());
 const session:Actor={credential:'session',userId:'usr_owner',email:'owner@example.com',emailVerified:true};
 const made=await myComment(request(`/api/my/artifacts/${doc.id}/annotations`,{method:'POST',actor:session,json:{node_id:'intro',edit_id:row.edit_id,body:'See',attachment_id:stage.id}}),params(doc.id));
 if(made.status!==201)throw new Error(await made.text());
 return stage.id;
}

it('refuses an admin a private document at every other bearer door, and lists it nowhere',async()=>{
 const images={[UNLISTED.id]:await ownerImage(UNLISTED),[PRIVATE.id]:await ownerImage(PRIVATE)};
 const doors=(doc:Doc):Array<[string,()=>Promise<Response>]>=>[
  ['raw',async()=>bearer(`/a/${doc.id}/raw`)],
  ['mutate',async()=>bearer(`/a/${doc.id}/mutate`,{method:'POST',json:{mutation:'missing',args:{}}})],
  ['export',async()=>bearer(`/api/artifacts/${doc.id}/export`)],
  ['annotation changes',async()=>bearer(`/api/artifacts/${doc.id}/annotations/changes`)],
  ['comment image',async()=>bearer(`/api/artifacts/${doc.id}/comment-images/${images[doc.id]}`)],
 ];
 for(const [door,ask] of doors(PRIVATE)){
  const response=await ask(),text=await response.text();
  expect(response.status,`${door}: ${text}`).toBe(404);
  expect(text,door).not.toContain('private document');
 }
 // The same doors answer the non-private sibling: the refusal above is the visibility gate, not the door.
 for(const [door,ask] of doors(UNLISTED))expect((await ask()).status,door).not.toBe(404);
 for(const query of ['','?relationship=all','?search=document','?visibility=private']){
  const listed=await bearer(`/api/artifacts${query}`);expect(listed.status).toBe(200);
  const ids=((await listed.json()) as {artifacts:Array<{id:string}>}).artifacts.map(a=>a.id);
  expect(ids,query).not.toContain(PRIVATE.id);
 }
 expect(await getArtifactById(PRIVATE.id)).toMatchObject({version:1,actor_user_id:null});
});

it('refuses an admin a private document at every browser door, its live stream and a folder listing',async()=>{
 const session:Actor={credential:'session',userId,email:identity.email,emailVerified:true};
 const at=(path:string)=>request(path,{actor:session,origin:'same'});
 const statuses=async(doc:Doc)=>{
  const stream=await events(at(`/a/${doc.id}/events`),params(doc.id));await stream.body?.cancel();
  return {
   head:(await myArtifact(at(`/api/my/artifacts/${doc.id}`),params(doc.id))).status,
   page:(await pageArtifact(at(`/api/page/artifact/${doc.id}`),params(doc.id))).status,
   raw:(await raw(at(`/a/${doc.id}/raw`),params(doc.id))).status,
   stream:stream.status,
  };
 };
 expect(await statuses(UNLISTED)).toEqual({head:200,page:200,raw:200,stream:200});
 expect(await statuses(PRIVATE)).toEqual({head:404,page:404,raw:404,stream:404});
 // A folder the admin may read lists no private child it holds, and no unlisted one: the grant lists nothing.
 const db=await harness.db();
 await db.query(`INSERT INTO artifacts(id,token_id,user_id,title,source,meta,format,visibility,edit_id) VALUES ('fld123','tok_owner','usr_owner','Shelf','','{}','folder','public','folder-edit')`);
 await db.query("UPDATE artifacts SET ancestor_ids=ARRAY['fld123'] WHERE id IN ($1,$2)",[UNLISTED.id,PRIVATE.id]);
 const admin=await sessionActor(at('/api/page/artifact/fld123'));expect(admin.documentEditor).toBe(true);
 const shelf=await selectChildren((await getArtifactById('fld123'))!,admin);
 expect(shelf.children.map(child=>child.id)).toEqual([]);
});
