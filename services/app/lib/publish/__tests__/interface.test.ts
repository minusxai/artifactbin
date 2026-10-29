/**
 * lib/publish's use cases through its index: create, replace and preflight, the bundle preparation, fork, asset
 * refresh, content admission, the live frame and stream, and the mermaid harvester's lifecycle. Access refusals are
 * the uniform not_found, before anything is parsed or written.
 */
import {describe,expect,it} from 'vitest';
import {MAX_DOCUMENT_BYTES} from '@artifactbin/contracts';
import {mintAccountToken,request,useAppHarness} from '@/__tests__/harness';
import {identityForUser,type TokenHoldingActor} from '@/lib/accounts';
import {artifactState,getArtifactById} from '@/lib/artifacts';
import {MERMAID_RENDER_ENGINE} from '@/lib/mermaid-images';
import {
 createArtifactFromBody,forkArtifact,forkDatasetPreview,forkRefusal,liveFrameFor,openDocumentEvents,parseContentInput,preflightPublication,
 preparePublicationBundle,refreshAssetsFor,replaceArtifactWithBody,startMermaidHarvester,
} from '..';

const harness=useAppHarness();
const BASE='http://localhost:3030';
const page=(title:string,body='<p>☕</p>')=>`<!doctype html><html><head><title>${title}</title></head><body>${body}</body></html>`;
async function actor(name='publish_interface'):Promise<TokenHoldingActor>{const token=await mintAccountToken(name);return identityForUser(token.userId,token.id);}
async function created(owner:TokenHoldingActor,body:Record<string,unknown>,headers:Record<string,string>={}){
 const response=await createArtifactFromBody(body,owner,BASE,new Request(`${BASE}/api/artifacts`,{method:'POST',headers}));
 return {status:response.status,body:await response.json() as Record<string,unknown>&{id:string;version:number}};
}
const errorOf=async(response:Response)=>[response.status,((await response.json()) as {error?:string}).error];
/** The observed version and state a replace must name. */
const observed=async(id:string)=>{const row=(await getArtifactById(id))!;return {expectedVersion:row.version,expectedState:artifactState(row)};};
const count=async()=>(await (await harness.db()).query<{n:number}>('SELECT count(*)::int n FROM artifacts')).rows[0]!.n;

describe('createArtifactFromBody',()=>{
 it('creates a page with its derived unicode title, and an idempotent replay answers the same row',async()=>{
  const owner=await actor();
  const first=await created(owner,{html:page('Café 名前')},{'Idempotency-Key':'publish_interface_create_01'});
  expect(first.status).toBe(201);
  expect((await getArtifactById(first.body.id))?.title).toBe('Café 名前');
  const replay=await created(owner,{html:page('Café 名前')},{'Idempotency-Key':'publish_interface_create_01'});
  expect(replay.body.id).toBe(first.body.id);
  expect(await count()).toBe(1);
 });

 it('answers a dry run without writing, and refuses malformed, oversized and combined bodies before writing',async()=>{
  const owner=await actor();
  const dry=await createArtifactFromBody({html:page('Dry')},owner,BASE,undefined,{dryRun:true});
  expect(await dry.json()).toMatchObject({valid:true,dry_run:true,format:'html'});
  const refusals:Array<[Record<string,unknown>,number,string,{dryRun?:boolean}?]>=[
   [{html:page('x'),publicationBundle:{entryPath:'index.html',files:[]}},400,'bundle_preflight_requires_dependency_plan',{dryRun:true}],
   [{html:page('x'),reserved_id:'../bad'},400,'invalid_reserved_id'],
   [{html:page('x'),policy:{}},400,'combined_policy_write'],
   [{markup:'<p>old</p>'},400,'native_html_required'],
   [{},400,'one_of_html_dataset_viz_image_pdf_file'],
   [{html:'x'.repeat(MAX_DOCUMENT_BYTES+1)},413,'too_large'],
   [{html:page('x'),forked_from:'not an id'},400,'invalid_metadata'],
   [{html:page('x'),visibility:null},400,'invalid_metadata'],
  ];
  for(const [body,status,error,options] of refusals)expect(await errorOf(await createArtifactFromBody(body,owner,BASE,undefined,options))).toEqual([status,error]);
  expect(await count()).toBe(0);
 });

 it('records lineage only from a source the creator can read',async()=>{
  const owner=await actor('lineage_owner'),other=await actor('lineage_other');
  const secret=await created(owner,{html:page('Secret'),visibility:'private'});
  expect(await errorOf(await createArtifactFromBody({html:page('Copy'),forked_from:secret.body.id},other,BASE))).toEqual([404,'not_found']);
  const own=await created(owner,{html:page('Copy'),forked_from:secret.body.id});
  expect(own.status).toBe(201);
 });
});

describe('replaceArtifactWithBody',()=>{
 it('replaces at the observed version and refuses a stale one with the current version',async()=>{
  const owner=await actor();
  const {body:{id}}=await created(owner,{html:page('One')});
  const first=await observed(id);
  const saved=await replaceArtifactWithBody({html:page('Two'),...first},owner,id,BASE);
  expect(saved.status).toBe(200);
  expect(await getArtifactById(id)).toMatchObject({version:2,title:'Two'});
  const stale=await replaceArtifactWithBody({html:page('Three'),...first},owner,id,BASE);
  expect(stale.status).toBe(409);
  expect(await stale.json()).toMatchObject({error:'version_conflict',currentVersion:2});
 });

 it('answers the uniform not_found to a stranger, and refuses invalid bodies, without moving the version',async()=>{
  const owner=await actor('replace_owner'),stranger=await actor('replace_stranger');
  const {body:{id}}=await created(owner,{html:page('Mine'),visibility:'private'});
  const seen=await observed(id);
  expect(await errorOf(await replaceArtifactWithBody({html:page('Theirs'),...seen},stranger,id,BASE))).toEqual([404,'not_found']);
  // A dry run answers before the write: its refusal is the read scope alone, never a validation or version oracle.
  expect(await errorOf(await replaceArtifactWithBody({html:page('Theirs'),...seen},stranger,id,BASE,{dryRun:true}))).toEqual([404,'not_found']);
  expect(await errorOf(await replaceArtifactWithBody({html:page('Theirs'),expectedVersion:9,expectedState:seen.expectedState},stranger,id,BASE))).toEqual([404,'not_found']);
  expect(await errorOf(await replaceArtifactWithBody({html:page('No version')},owner,id,BASE))).toEqual([400,'version_required']);
  expect(await errorOf(await replaceArtifactWithBody({html:page('No state'),expectedVersion:1},owner,id,BASE))).toEqual([400,'state_required']);
  expect(await errorOf(await replaceArtifactWithBody({html:page('Gone')},owner,'Missing123',BASE))).toEqual([404,'not_found']);
  expect(await errorOf(await replaceArtifactWithBody(null,owner,id,BASE))).toEqual([400,'invalid_json']);
  expect(await errorOf(await replaceArtifactWithBody({markup:'<p>x</p>'},owner,id,BASE))).toEqual([400,'native_html_required']);
  expect(await errorOf(await replaceArtifactWithBody({html:page('x'),destination:{type:'user'}},owner,id,BASE))).toEqual([400,'ownership_requires_transfer']);
  expect(await errorOf(await replaceArtifactWithBody({html:page('x'),policy:{}},owner,id,BASE))).toEqual([400,'combined_policy_write']);
  const dry=await replaceArtifactWithBody({html:page('Dry'),...seen},owner,id,BASE,{dryRun:true});
  expect(await dry.json()).toMatchObject({valid:true,dry_run:true});
  expect((await getArtifactById(id))?.version).toBe(1);
 });
});

describe('preflightPublication',()=>{
 const preflight=(owner:TokenHoldingActor,body:Record<string,unknown>)=>preflightPublication(new Request(`${BASE}/api/preflight`),owner,body);
 it('validates a create, a replace and a delete against real identities and permissions',async()=>{
  const owner=await actor('preflight_owner'),stranger=await actor('preflight_stranger');
  expect(await (await preflight(owner,{input:{html:page('New')}})).json()).toMatchObject({valid:true,dry_run:true});
  const {body:{id}}=await created(owner,{html:page('Old'),visibility:'private'});
  expect(await (await preflight(owner,{id,input:{html:page('Next'),...await observed(id)}})).json()).toMatchObject({valid:true,dry_run:true});
  expect(await (await preflight(owner,{id,mode:'delete',input:{}})).json()).toMatchObject({valid:true,would_delete:id,includes_subtree:false,dependents:[]});
  expect(await errorOf(await preflight(stranger,{id,mode:'delete',input:{}}))).toEqual([404,'not_found']);
  expect(await errorOf(await preflight(stranger,{id,input:{html:page('x')}}))).toEqual([404,'not_found']);
  expect((await getArtifactById(id))?.version).toBe(1);
  expect(await count()).toBe(1);
 });
 it('refuses malformed preflight requests by name',async()=>{
  const owner=await actor();
  const cases:Array<[Record<string,unknown>,number,string]>=[
   [{},400,'invalid_preflight'],[{input:[]},400,'invalid_preflight'],[{input:{},id:'../x'},400,'invalid_reference'],
   [{input:{},id:'Missing123'},404,'not_found'],[{input:{},dependencies:{}},400,'invalid_preflight'],[{input:{},mode:'upsert'},400,'invalid_preflight_mode'],
   [{input:{},mode:'metadata'},400,'invalid_preflight'],
  ];
  for(const [body,status,error] of cases)expect(await errorOf(await preflight(owner,body))).toEqual([status,error]);
 });
});

describe('preparePublicationBundle',()=>{
 const file=(path:string,text:string,contentType:string)=>({path,contentType,base64:Buffer.from(text).toString('base64')});
 const unused=async():Promise<Response>=>{throw new Error('nothing should be written');};
 const keyed=(key:string)=>new Request(`${BASE}/api/artifacts`,{method:'POST',headers:{'Idempotency-Key':key}});
 it('passes a body without a bundle through, and refuses a bundle without html, a key or its files',async()=>{
  const owner=await actor();
  expect(await preparePublicationBundle({html:'<p>x</p>'},owner,BASE,undefined,unused,unused)).toEqual({body:{html:'<p>x</p>'},receipts:[]});
  expect(await preparePublicationBundle({title:'no content'},owner,BASE,undefined,unused,unused)).toEqual({body:{title:'no content'},receipts:[]});
  const bundle={entryPath:'index.html',files:[file('logo.svg','<svg/>','image/svg+xml')]};
  const refusals:Array<[Record<string,unknown>,Request|undefined,string]>=[
   [{publicationBundle:bundle},keyed('publish_interface_bundle_01'),'invalid_publication_bundle'],
   [{html:'<img src="./logo.svg">',publicationBundle:bundle},undefined,'bundle_idempotency_required'],
   [{html:'<img src="./logo.svg">',publicationBundle:bundle},keyed('short'),'bundle_idempotency_required'],
   [{html:'<img src="./missing.svg">',publicationBundle:bundle},keyed('publish_interface_bundle_01'),'unresolved_publication_dependencies'],
   [{html:'<link rel="af-backend" data-af-name="api" href="./api.graphql">',backendSources:{api:'type Query{b:Int}'},publicationBundle:{entryPath:'index.html',files:[file('api.graphql','type Query{a:Int}','text/plain')]}},keyed('publish_interface_bundle_01'),'conflicting_backend_sources'],
  ];
  for(const [body,req,error] of refusals){
   const result=await preparePublicationBundle(body,owner,BASE,req,unused,unused);
   expect(result instanceof Response?await errorOf(result):result).toEqual([400,error]);
  }
 });
 it('creates each new file through the caller under a reserved id and rewrites the page to its address',async()=>{
  const owner=await actor();
  const writes:Array<Record<string,unknown>>=[];
  const create=async(body:Record<string,unknown>)=>{writes.push(body);return Response.json({id:body.reserved_id,version:1},{status:201});};
  const result=await preparePublicationBundle({html:'<img src="./img/logo.svg">',visibility:'private',publicationBundle:{entryPath:'index.html',files:[file('img/logo.svg','<svg>☕</svg>','image/svg+xml')]}},owner,BASE,keyed('publish_interface_bundle_02'),create,unused);
  if(result instanceof Response)throw new Error(await result.text());
  expect(writes).toHaveLength(1);
  expect(writes[0]).toMatchObject({visibility:'private',file:{filename:'logo.svg',contentType:'image/svg+xml'}});
  const id=writes[0]!.reserved_id as string;
  expect(result.receipts).toEqual([expect.objectContaining({path:'img/logo.svg',kind:'asset',id,revision:'1'})]);
  expect(result.body.publicationBundle).toBeUndefined();
  expect(result.body.html).toBe(`<img src="/a/${result.body.reserved_id}/assets?dependency=${id}&amp;revision=1">`);
 });
});

describe('fork',()=>{
 it('copies a readable page under the forker, and refuses a folder before copying anything',async()=>{
  const owner=await actor('fork_owner'),forker=await actor('fork_forker');
  const {body:{id}}=await created(owner,{html:page('Original ☕'),visibility:'public'});
  const source=(await getArtifactById(id))!;
  expect(forkRefusal(source)).toBeNull();
  expect(await forkDatasetPreview(forker,source)).toEqual([]);
  const forked=await forkArtifact(forker,source,{title:'Mine'});
  if(forked instanceof Response)throw new Error(await forked.text());
  expect(forked.datasets).toEqual([]);
  expect(forked.artifact).toMatchObject({title:'Mine',user_id:forker.userId,source:source.source});
  expect(forked.artifact.id).not.toBe(id);
  const folderId=(await created(owner,{format:'folder',title:'Folder'})).body.id;
  const folder=(await getArtifactById(folderId))!;
  expect(await errorOf(forkRefusal(folder)!)).toEqual([400,'not_forkable']);
  expect(await forkDatasetPreview(forker,folder)).toEqual([]);
  const refused=await forkArtifact(forker,folder);
  expect(refused instanceof Response?await errorOf(refused):refused).toEqual([400,'not_forkable']);
  expect(await count()).toBe(3);
 });
});

describe('refreshAssetsFor',()=>{
 it('needs a url or a document, answers not_found for an unreachable document, and reports nothing held as an empty refresh',async()=>{
  const owner=await actor('refresh_owner'),stranger=await actor('refresh_stranger');
  const {body:{id}}=await created(owner,{html:page('Pictures','<img src="https://images.example/a.png">'),visibility:'private'});
  expect(await errorOf(await refreshAssetsFor(owner,{}))).toEqual([400,'nothing_to_refresh']);
  expect(await errorOf(await refreshAssetsFor(owner,{url:'',id:7}))).toEqual([400,'nothing_to_refresh']);
  expect(await errorOf(await refreshAssetsFor(stranger,{id}))).toEqual([404,'not_found']);
  expect(await (await refreshAssetsFor(owner,{id})).json()).toEqual({refreshed:[],unchanged:[],failed:[]});
 });
});

describe('parseContentInput',()=>{
 it('admits exactly one content field and names every refusal',async()=>{
  const cases:Array<[Record<string,unknown>,number,string]>=[
   [{markup:'x'},400,'native_html_required'],[{},400,'one_of_html_dataset_viz_image_pdf_file'],[{html:'<p>a</p>',viz:{}},400,'one_of_html_dataset_viz_image_pdf_file'],
   [{program:'x'},400,'unsupported_format'],[{format:'folder'},400,'one_of_html_dataset_viz_image_pdf_file'],[{html:'x'.repeat(MAX_DOCUMENT_BYTES+1)},413,'too_large'],
   [{html:'<html><head><meta name="artifactbin:og-image" content="nope"></head><body></body></html>'},400,'invalid_social_preview_image'],
   [{image:'aGk='},400,'image_not_previewable'],[{imageUrl:'https://x.test/a.png'},400,'image_not_previewable'],[{pdf:'aGk='},400,'pdf_not_previewable'],
   [{file:{filename:'a.txt',base64:'aGk='}},400,'file_not_previewable'],[{dataset:{kind:'sqlite'}},400,'dataset_not_previewable'],
  ];
  for(const [body,status,error] of cases){
   const parsed=await parseContentInput(body);
   expect(parsed instanceof Response?await errorOf(parsed):parsed,JSON.stringify(body).slice(0,60)).toEqual([status,error]);
  }
 });
 it('reads a page title and description, makes a folder only when creating, and charges the byte quota before storing',async()=>{
  expect(await parseContentInput({html:page('Über ☕').replace('</head>','<meta name="description" content="Désc"></head>')})).toMatchObject({format:'html',derivedTitle:'Über ☕',derivedDescription:'Désc',meta:{refs:[]}});
  expect(await parseContentInput({format:'folder'},{creating:true})).toEqual({format:'folder',source:'',meta:{},derivedTitle:null});
  let asked=0;
  const over=await parseContentInput({image:'aGk='},{overByteQuota:async()=>{asked++;return true;}});
  expect(over instanceof Response?await errorOf(over):over).toEqual([403,'quota_exceeded']);
  expect(asked).toBe(1);
 });
 it('refuses an asset ref the loader cannot resolve to bytes',async()=>{
  const parsed=await parseContentInput({html:'<img src="ref:abc123">'},{loadRef:async()=>null});
  expect(parsed instanceof Response?await errorOf(parsed):parsed).toEqual([400,'invalid_refs']);
 });
});

describe('the live frame and stream',()=>{
 it('builds a frame once per edit, naming the version and its author',async()=>{
  const owner=await actor();
  const {body:{id}}=await created(owner,{html:page('Live')});
  const row=(await getArtifactById(id))!;
  const frame=await liveFrameFor(row);
  expect(frame).toMatchObject({editId:row.edit_id,version:1,format:'html',title:'Live',source:null,datasets:[]});
  expect(await liveFrameFor(row)).toBe(frame);
  expect((await replaceArtifactWithBody({html:page('Live 2'),...await observed(id)},owner,id,BASE)).status).toBe(200);
  const next=await liveFrameFor((await getArtifactById(id))!);
  expect(next).toMatchObject({version:2,title:'Live 2'});
 });

 it('opens a stream only for a well-formed, existing, readable document',async()=>{
  const token=await mintAccountToken('events_owner');
  const owner=identityForUser(token.userId,token.id);
  const {body:{id}}=await created(owner,{html:page('Events'),visibility:'private'});
  expect(await openDocumentEvents(new Request(`${BASE}/a/x/events`),'../x')).toEqual({status:'not_found'});
  expect(await openDocumentEvents(new Request(`${BASE}/a/Missing123/events`),'Missing123')).toEqual({status:'not_found'});
  expect(await openDocumentEvents(new Request(`${BASE}/a/${id}/events`),id)).toEqual({status:'not_found'});
  const viewer={credential:'session' as const,userId:token.userId!,email:token.email??'',emailVerified:true};
  expect(await openDocumentEvents(request(`/a/${id}/events?anonymous=1`,{actor:viewer}),id)).toEqual({status:'not_found'});
  const stranger=await mintAccountToken('events_stranger');
  expect(await openDocumentEvents(request(`/a/${id}/events`,{actor:{...viewer,userId:stranger.userId!,email:stranger.email??''}}),id)).toEqual({status:'not_found'});
  const opened=await openDocumentEvents(request(`/a/${id}/events`,{actor:viewer}),id);
  expect(opened.status).toBe('open');
  if(opened.status!=='open')return;
  const reader=opened.stream.getReader();
  const first=new TextDecoder().decode((await reader.read()).value);
  expect(first).toContain('data:');
  await reader.cancel();
 });
});

describe('startMermaidHarvester',()=>{
 it('drains due jobs when started, and runs none after it is stopped',async()=>{
  const owner=await actor();
  const db=await harness.db();
  const first=(await created(owner,{html:page('Harvest one')})).body.id,second=(await created(owner,{html:page('Harvest two')})).body.id;
  const job=(id:string)=>db.query('INSERT INTO mermaid_harvests(artifact_id,version,engine) VALUES($1,1,$2)',[id,MERMAID_RENDER_ENGINE]);
  const state=async(id:string)=>(await db.query<{state:string}>('SELECT state FROM mermaid_harvests WHERE artifact_id=$1',[id])).rows[0]?.state;
  await job(first);
  const stop=startMermaidHarvester({intervalMs:60_000});
  await stop();
  // Not a mermaid-drawing document: claimed, then settled as superseded rather than retried.
  expect(await state(first)).toBe('superseded');
  await job(second);
  await new Promise(resolve=>setTimeout(resolve,20));
  expect(await state(second)).toBe('pending');
 });
});
