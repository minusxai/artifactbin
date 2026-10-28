import {createHash} from 'node:crypto';
import {describe,it,expect} from 'vitest';
import {request,useAppHarness,mintAccountToken} from './harness';
import {POST} from '@/app/api/artifacts/route';
import {GET,PUT} from '@/app/api/artifacts/[id]/route';
const harness=useAppHarness();
const file=(path:string,source:string,contentType:string)=>({path,contentType,base64:Buffer.from(source).toString('base64')});
it('serves reused immutable module dependencies through only their new admitted parent',async()=>{
 const {GET:assetGet}=await import('@/app/a/[id]/assets/route');
 const actor=await mintAccountToken('bundle-reused-module');
 const files=[file('main.js','import "./nested.js";','text/javascript'),file('nested.js','export const ready=true;','text/javascript')];
 const publish=async(key:string,mappings?:Record<string,unknown>)=>{const response=await POST(request('/api/artifacts',{method:'POST',token:actor.token,headers:{'Idempotency-Key':key},json:{html:'<script type="module" src="./main.js"></script>',publicationBundle:{entryPath:'index.html',files,...(mappings?{mappings}:{})}}}));expect(response.status).toBe(201);return response.json();};
 const first=await publish('bundle_reused_module_first');
 const second=await publish('bundle_reused_module_second',Object.fromEntries(first.dependencyReceipts.map(({path,...entry}:{path:string})=>[path,entry])));
 expect(second.dependencyReceipts).toEqual(first.dependencyReceipts);
 const main=second.dependencyReceipts.find((entry:{path:string})=>entry.path==='main.js');
 const nested=second.dependencyReceipts.find((entry:{path:string})=>entry.path==='nested.js');
 const read=(id:string,dependency:string)=>assetGet(request(`/a/${id}/assets?dependency=${dependency}&revision=1&version=1`,{token:actor.token}),{params:Promise.resolve({id})});
 const served=await read(second.id,main.id);expect(served.status).toBe(200);
 const source=await served.text();expect(source).toContain(`/a/${second.id}/assets?dependency=${nested.id}&revision=1&version=1`);expect(source).not.toContain(`/a/${first.id}/assets`);
 expect((await read(second.id,nested.id)).status).toBe(200);
 expect((await read(second.id,'Other12')).status).toBe(404);
 const original=await read(first.id,main.id);expect(await original.text()).toContain(`/a/${first.id}/assets?dependency=${nested.id}`);
});
it('rejects missing dependencies before creating anything',async()=>{
 const actor=await mintAccountToken('bundle-missing');
 const response=await POST(request('/api/artifacts',{method:'POST',token:actor.token,json:{html:'<img src="./assets/missing.svg">'}}));
 expect(response.status).toBe(400);expect(await response.json()).toMatchObject({error:'unresolved_publication_dependencies'});
 const db=await harness.db();expect((await db.query<{n:number}>('SELECT count(*)::int n FROM artifacts')).rows[0]?.n).toBe(0);
});
it('publishes dependencies first, replays without duplicates, and returns the durable path map',async()=>{
 const actor=await mintAccountToken('bundle-upload');
 const body={html:'<!doctype html><html><head><link rel="af-dataset" data-af-name="tasks" href="./data/tasks.csv"></head><body><img src="./assets/logo.svg"></body></html>',publicationBundle:{entryPath:'index.html',files:[file('data/tasks.csv','name,value\nA,1\n','text/csv'),file('assets/logo.svg','<svg xmlns="http://www.w3.org/2000/svg"/>','image/svg+xml')]}};
 const send=()=>POST(request('/api/artifacts',{method:'POST',token:actor.token,headers:{'Idempotency-Key':'bundle_publication_test_01'},json:body}));
 const response=await send();const saved=await response.json();expect(response.status,JSON.stringify(saved)).toBe(201);expect(saved.dependencyReceipts).toHaveLength(2);
 const replay=await (await send()).json();expect(replay.id).toBe(saved.id);
 const db=await harness.db();expect((await db.query<{n:number}>('SELECT count(*)::int n FROM artifacts')).rows[0]?.n).toBe(3);
 const row=(await db.query<{source:string}>('SELECT source FROM artifacts WHERE id=$1',[saved.id])).rows[0];expect(row?.source).toContain('href="ref:');expect(row?.source).toContain('/assets?dependency=');expect(row?.source).not.toContain('./assets');
});

it('conditionally updates changed CSS and dataset dependencies in place and exposes stale revisions',async()=>{
 const actor=await mintAccountToken('bundle-update');
 const html='<link rel="af-dataset" data-af-name="tasks" href="./tasks.csv"><link rel="stylesheet" href="./main.css"><h1>One</h1>';
 const sources=[file('tasks.csv','name,value\nA,1\n','text/csv'),file('main.css','body{color:red}','text/css')];
 const create=await POST(request('/api/artifacts',{method:'POST',token:actor.token,headers:{'Idempotency-Key':'bundle_update_create_01'},json:{html,publicationBundle:{entryPath:'index.html',files:sources}}}));const saved=await create.json();expect(create.status).toBe(201);
 const params={params:Promise.resolve({id:saved.id})};const head=await (await GET(request('/api/artifacts/'+saved.id,{token:actor.token}),params)).json();
 const mapping=Object.fromEntries(saved.dependencyReceipts.map(({path,...entry}:{path:string})=>[path,entry]));
 const body={html:html.replace('One','Two'),expectedVersion:head.version,expectedState:head.state,publicationBundle:{entryPath:'index.html',files:[file('tasks.csv','name,value\nB,2\n','text/csv'),file('main.css','body{color:blue}','text/css')],mappings:mapping}};
 const response=await PUT(request('/api/artifacts/'+saved.id,{method:'PUT',token:actor.token,headers:{'Idempotency-Key':'bundle_update_success_01'},json:body}),params);const receipt=await response.json();expect(response.status,JSON.stringify(receipt)).toBe(200);
 expect(receipt.dependencyReceipts.map((entry:{id:string})=>entry.id).sort()).toEqual(saved.dependencyReceipts.map((entry:{id:string})=>entry.id).sort());expect(receipt.dependencyReceipts.every((entry:{revision:string})=>entry.revision==='2')).toBe(true);
 const next=await (await GET(request('/api/artifacts/'+saved.id,{token:actor.token}),params)).json();
 const conflict=await PUT(request('/api/artifacts/'+saved.id,{method:'PUT',token:actor.token,headers:{'Idempotency-Key':'bundle_update_stale_01'},json:{...body,expectedVersion:next.version,expectedState:next.state}}),params);expect(conflict.status).toBe(409);expect((await conflict.json()).details.join(' ')).toContain('version_conflict');
 const db=await harness.db();expect((await db.query<{n:number}>('SELECT count(*)::int n FROM artifacts')).rows[0]?.n).toBe(3);
});
it('returns partial receipts and retries the same dependency creations without duplicates',async()=>{
 const actor=await mintAccountToken('bundle-partial');
 const body={html:'<img src="./first.svg"><img src="./unsupported.exe">',publicationBundle:{entryPath:'index.html',files:[file('first.svg','<svg/>','image/svg+xml'),file('unsupported.exe','bytes','application/octet-stream')]}};
 const send=()=>POST(request('/api/artifacts',{method:'POST',token:actor.token,headers:{'Idempotency-Key':'bundle_partial_retry_01'},json:body}));
 const response=await send();const receipt=await response.json();expect(response.status).toBe(409);expect(receipt.dependencyReceipts).toHaveLength(1);
 const replay=await (await send()).json();expect(replay.dependencyReceipts).toEqual(receipt.dependencyReceipts);
 const db=await harness.db();expect((await db.query<{n:number}>('SELECT count(*)::int n FROM artifacts')).rows[0]?.n).toBe(1);
});
it('serves private nested CSS/JS/image dependencies through the page session and revokes the page immediately',async()=>{
 const {createUser,issuePagesTicket}=await import('@/lib/accounts');
 const {testIdentity}=await import('./harness');
 const {pagesOriginFor,pagesSiteFor}=await import('@/lib/http/pages-origin');
 const {createAppServer}=await import('../server/app');
 const user=await createUser({email:'mxmx_test_bundle_private@example.com'});const actor=await mintAccountToken('bundle-private',user.id);
 const reader=await createUser({email:'mxmx_test_bundle_reader@example.com'});
 const body={visibility:'private',shares:[{email:reader.email,role:'viewer'}],html:'<link rel="stylesheet" href="./main.css"><script type="module" src="./main.js"></script><img src="./logo.svg">',publicationBundle:{entryPath:'index.html',files:[file('main.css','body{background:url(./logo.svg)}','text/css'),file('main.js','import "./nested.js";','text/javascript'),file('nested.js','export const ready=true;','text/javascript'),file('logo.svg','<svg/>','image/svg+xml')]}};
 const published=await POST(request('/api/artifacts',{method:'POST',token:actor.token,headers:{'Idempotency-Key':'bundle_private_delivery_01'},json:body}));const saved=await published.json();expect(published.status,JSON.stringify(saved)).toBe(201);
 const site=pagesSiteFor('pages.example.test','https://app.example.test'),self=pagesOriginFor(saved.id,site);
 const app=createAppServer({indexHtml:async()=>'<html><body><div id="root"></div></body></html>',pagesSite:site});
 const ticket=await issuePagesTicket(testIdentity('session',{userId:user.id,email:user.email}),{},Date.now(),{artifactId:saved.id,origin:self});
 const opened=await app.request(self+'/?_pt='+ticket);expect(opened.status).toBe(200);const cookie=/__Host-afbin_pages=([^;]+)/.exec(opened.headers.get('set-cookie')??'')?.[1];expect(cookie).toBeTruthy();
 for(const receipt of saved.dependencyReceipts){
  const url=self+`/a/${saved.id}/assets?dependency=${receipt.id}&revision=${receipt.revision}`;
  expect((await app.request(url)).status).toBe(404);
  const result=await app.request(url,{headers:{cookie:'__Host-afbin_pages='+cookie}});expect(result.status,await result.clone().text()).toBe(200);expect(result.headers.get('x-content-type-options')).toBe('nosniff');expect(result.headers.get('content-security-policy')).toContain('sandbox');
  if(receipt.path==='main.css'||receipt.path==='main.js')expect(await result.text()).toContain(`/a/${saved.id}/assets?dependency=`);
 }
 const {loadBundleAssetResources}=await import('@/lib/html-publication-bundle');
 const resources=await loadBundleAssetResources(new Request(self+'/download'),testIdentity('session',{userId:user.id,email:user.email}),saved.id);expect(resources).toHaveLength(4);expect(resources.some(resource=>resource.contentType==='text/javascript')).toBe(true);
 const dependency=saved.dependencyReceipts[0];const url=self+`/a/${saved.id}/assets?dependency=${dependency.id}&revision=${dependency.revision}`;
 const readerTicket=await issuePagesTicket(testIdentity('session',{userId:reader.id,email:reader.email}),{},Date.now(),{artifactId:saved.id,origin:self});
 const readerPage=await app.request(self+'/?_pt='+readerTicket);expect(readerPage.status).toBe(200);const readerCookie=/__Host-afbin_pages=([^;]+)/.exec(readerPage.headers.get('set-cookie')??'')?.[1];
 expect((await app.request(url,{headers:{cookie:'__Host-afbin_pages='+readerCookie}})).status).toBe(200);
 const db=await harness.db();await db.query('DELETE FROM artifact_shares WHERE artifact_id=$1',[dependency.id]);
 expect((await app.request(url,{headers:{cookie:'__Host-afbin_pages='+readerCookie}})).status).toBe(200);
 expect((await app.request(url,{headers:{cookie:'__Host-afbin_pages='+cookie}})).status).toBe(200);
 await db.query('UPDATE artifacts SET deleted_at=now() WHERE id=$1',[saved.id]);
 expect((await app.request(url,{headers:{cookie:'__Host-afbin_pages='+cookie}})).status).toBe(404);
});
it('publishes and conditionally retries through browser account routes without a bearer token',async()=>{
 const {createUser}=await import('@/lib/accounts');
 const {POST:browserCreate}=await import('@/app/api/my/artifacts/route');
 const {GET:browserGet,PUT:browserPut}=await import('@/app/api/my/artifacts/[id]/route');
 const user=await createUser({email:'mxmx_test_browser_bundle@example.com'});const actor={credential:'session' as const,userId:user.id,email:user.email!,emailVerified:true};
 const created=await browserCreate(request('/api/my/artifacts',{method:'POST',actor,headers:{'Idempotency-Key':'browser_bundle_create_01'},json:{visibility:'private',html:'<h1>One</h1><img src="./logo.svg">',publicationBundle:{entryPath:'index.html',files:[file('logo.svg','<svg/>','image/svg+xml')]}}}));const saved=await created.json();expect(created.status,JSON.stringify(saved)).toBe(201);
 const params={params:Promise.resolve({id:saved.id})};const head=await (await browserGet(request('/api/my/artifacts/'+saved.id,{actor}),params)).json();
 const body={html:head.html.replace('One','Two'),expectedVersion:head.version,expectedState:head.state};
 const update=()=>browserPut(request('/api/my/artifacts/'+saved.id,{method:'PUT',actor,headers:{'Idempotency-Key':'browser_bundle_update_01'},json:body}),params);
 const response=await update();const receipt=await response.json();expect(response.status,JSON.stringify(receipt)).toBe(200);const replay=await (await update()).json();expect(replay.version).toBe(receipt.version);
 const db=await harness.db();const row=(await db.query<{meta:{htmlPublicationDependencies:unknown[]}}>('SELECT meta FROM artifacts WHERE id=$1',[saved.id])).rows[0];expect(row?.meta.htmlPublicationDependencies).toHaveLength(1);
});
it('describes a readonly dependency plan without reserving or creating resources',async()=>{
 const {inspectPublicationBundle}=await import('@/lib/html-publication-bundle');
 const plan=inspectPublicationBundle('<img src="./a.svg">',{entryPath:'index.html',files:[file('a.svg','<svg/>','image/svg+xml')]});expect(plan.dependencies).toMatchObject([{path:'a.svg',kind:'asset',bytes:6}]);
 const db=await harness.db();expect((await db.query<{n:number}>('SELECT count(*)::int n FROM artifacts')).rows[0]?.n).toBe(0);
});
it('keeps historical hosted dependencies after the latest page removes them, with exact bytes and current ACLs',async()=>{
 const {GET:assetGet}=await import('@/app/a/[id]/assets/route');const {nativeHtmlAssets}=await import('@/lib/serving/native-html-assets.server');
 const actor=await mintAccountToken('bundle-historical');
 const html='<link rel="stylesheet" href="./main.css"><img src="./logo.svg">';
 const created=await POST(request('/api/artifacts',{method:'POST',token:actor.token,headers:{'Idempotency-Key':'bundle_history_create_01'},json:{html,publicationBundle:{entryPath:'index.html',files:[file('main.css','body{background:url(./logo.svg)}','text/css'),file('logo.svg','<svg>old</svg>','image/svg+xml')]}}}));const saved=await created.json();expect(created.status).toBe(201);
 const params={params:Promise.resolve({id:saved.id})};const head=await (await GET(request('/api/artifacts/'+saved.id,{token:actor.token}),params)).json();
 const updated=await PUT(request('/api/artifacts/'+saved.id,{method:'PUT',token:actor.token,headers:{'Idempotency-Key':'bundle_history_update_01'},json:{html:'<h1>No dependencies</h1>',expectedVersion:head.version,expectedState:head.state,publicationBundle:{entryPath:'index.html',files:[]}}}),params);expect(updated.status).toBe(200);
 const db=await harness.db();const archived=(await db.query<{source:string;meta:Record<string,unknown>}>('SELECT source,meta FROM artifact_versions WHERE artifact_id=$1 AND version=1',[saved.id])).rows[0]!;
 const rendered=await nativeHtmlAssets({id:saved.id,version:1,source:archived.source,meta:archived.meta});expect(rendered).toContain('version=1');
 const css=saved.dependencyReceipts.find((receipt:{path:string})=>receipt.path==='main.css');const image=saved.dependencyReceipts.find((receipt:{path:string})=>receipt.path==='logo.svg');
 const address=(id:string)=>`/a/${saved.id}/assets?dependency=${id}&revision=1`;
 expect((await assetGet(request(address(css.id),{token:actor.token}),params)).status).toBe(404);
 const historical=await assetGet(request(address(css.id)+'&version=1',{token:actor.token}),params);expect(historical.status).toBe(200);expect(await historical.text()).toContain('version=1');
 const bytes=await assetGet(request(address(image.id)+'&version=1',{token:actor.token}),params);expect(await bytes.text()).toBe('<svg>old</svg>');
 const stranger=await mintAccountToken('bundle-history-stranger');expect((await assetGet(request(address(css.id)+'&version=1',{token:stranger.token}),params)).status).toBe(404);
});
it('serves existing actor-owned image and PDF mappings through admitted dependency URLs',async()=>{
 const {GET:assetGet}=await import('@/app/a/[id]/assets/route');const actor=await mintAccountToken('bundle-media-mapping');
 const image='data:image/svg+xml;base64,'+Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"><rect width="1" height="1"/></svg>').toString('base64');const pdf='data:application/pdf;base64,'+Buffer.from('%PDF-1.7\nopaque retained bytes').toString('base64');
 const imageReply=await POST(request('/api/artifacts',{method:'POST',token:actor.token,json:{image}}));const imageAsset=await imageReply.json();expect(imageReply.status,JSON.stringify(imageAsset)).toBe(201);
 const pdfReply=await POST(request('/api/artifacts',{method:'POST',token:actor.token,json:{pdf}}));const pdfAsset=await pdfReply.json();expect(pdfReply.status).toBe(201);
 const response=await POST(request('/api/artifacts',{method:'POST',token:actor.token,headers:{'Idempotency-Key':'bundle_media_mappings_01'},json:{html:'<img src="./image.svg"><object data="./paper.pdf"></object>',publicationBundle:{entryPath:'index.html',files:[],mappings:{'image.svg':{kind:'asset',id:imageAsset.id,revision:'1'},'paper.pdf':{kind:'asset',id:pdfAsset.id,revision:'1'}}}}}));const saved=await response.json();expect(response.status,JSON.stringify(saved)).toBe(201);
 const params={params:Promise.resolve({id:saved.id})};
 for(const id of [imageAsset.id,pdfAsset.id]){const bytes=await assetGet(request(`/a/${saved.id}/assets?dependency=${id}&revision=1`,{token:actor.token}),params);expect(bytes.status).toBe(200);expect(bytes.headers.get('x-content-type-options')).toBe('nosniff');expect((await bytes.arrayBuffer()).byteLength).toBeGreaterThan(0);}
});
it('keeps partial dependency-update receipts and never increments an already-updated dataset on retry',async()=>{
 const actor=await mintAccountToken('bundle-partial-update');const html='<link rel="af-dataset" data-af-name="tasks" href="./a.csv"><img src="./bad.txt">';
 const created=await POST(request('/api/artifacts',{method:'POST',token:actor.token,headers:{'Idempotency-Key':'bundle_partial_change_create'},json:{html,publicationBundle:{entryPath:'index.html',files:[file('a.csv','name,value\nA,1\n','text/csv'),file('bad.txt','before','text/plain')]}}}));const saved=await created.json();expect(created.status).toBe(201);
 const params={params:Promise.resolve({id:saved.id})};const head=await (await GET(request('/api/artifacts/'+saved.id,{token:actor.token}),params)).json();
 const dataset=saved.dependencyReceipts.find((receipt:{path:string})=>receipt.path==='a.csv'),asset=saved.dependencyReceipts.find((receipt:{path:string})=>receipt.path==='bad.txt');
 const body={html:html.replace('bad.txt','bad.exe'),expectedVersion:head.version,expectedState:head.state,publicationBundle:{entryPath:'index.html',files:[file('a.csv','name,value\nB,2\n','text/csv'),file('bad.exe','after','application/octet-stream')],mappings:{'a.csv':dataset,'bad.exe':asset}}};
 const send=()=>PUT(request('/api/artifacts/'+saved.id,{method:'PUT',token:actor.token,headers:{'Idempotency-Key':'bundle_partial_change_update'},json:body}),params);
 const response=await send();const receipt=await response.json();expect(response.status,JSON.stringify(receipt)).toBe(409);expect(receipt.dependencyReceipts).toMatchObject([{id:dataset.id,revision:'2'}]);
 expect(await (await send()).json()).toEqual(receipt);
 const db=await harness.db();expect((await db.query<{version:number}>('SELECT version FROM artifacts WHERE id=$1',[dataset.id])).rows[0]?.version).toBe(2);expect((await db.query<{version:number}>('SELECT version FROM artifacts WHERE id=$1',[saved.id])).rows[0]?.version).toBe(1);
});
it('publishes selected local backend files atomically with the page rather than as assets',async()=>{
 const {setServices}=await import('@/lib/platform');setServices({runner:{start:async()=>({runId:'backend-schema-test'}),getRun:async()=>({runId:'backend-schema-test',status:'completed',output:{typeDefs:'type Query { count:Int! }'},receipt:null}),events:async()=>({events:[],nextSequence:0,hasMore:false}),cancel:async()=>{}}});
 try{
 const actor=await mintAccountToken('bundle-local-backend');const source='export const typeDefs="type Query { count:Int! }"; export default {count:()=>1};';
 const response=await POST(request('/api/artifacts',{method:'POST',token:actor.token,headers:{'Idempotency-Key':'bundle_local_backend_create'},json:{html:'<link rel="af-backend" data-af-name="jobs" href="./api.ts"><h1>Jobs</h1>',publicationBundle:{entryPath:'index.html',files:[file('api.ts',source,'text/typescript')]}}}));const saved=await response.json();expect(response.status,JSON.stringify(saved)).toBe(201);
 const db=await harness.db();const page=(await db.query<{source:string;meta:{htmlLinks:Array<{kind:string;name:string}>}}>('SELECT source,meta FROM artifacts WHERE id=$1',[saved.id])).rows[0]!;expect(page.source).not.toContain('href="./api.ts"');expect(page.meta.htmlLinks).toMatchObject([{kind:'backend',name:'jobs'}]);expect((await db.query<{n:number}>('SELECT count(*)::int n FROM artifacts')).rows[0]?.n).toBe(1);
 }finally{setServices({});}
});
it('delegates private dependencies when the page is shared later and revokes with page or owner authority',async()=>{
 const {createUser}=await import('@/lib/accounts');const {updateSharingFor,transferArtifact}=await import('@/lib/artifacts');const {createGroup}=await import('@/lib/groups');const {GET:assetGet}=await import('@/app/a/[id]/assets/route');const {GET:rawGet}=await import('@/app/a/[id]/raw/route');
 const user=await createUser({email:'mxmx_test_bundle_late_share_owner@example.com'}),reader=await createUser({email:'mxmx_test_bundle_late_share_reader@example.com'});const owner=await mintAccountToken('bundle-late-share',user.id);
 const ownerActor={credential:'session' as const,userId:user.id,email:user.email!,emailVerified:true},readerActor={credential:'session' as const,userId:reader.id,email:reader.email!,emailVerified:true};
 const {testIdentity}=await import('./harness');const ownerIdentity=testIdentity('session',{userId:user.id,email:user.email});
 const created=await POST(request('/api/artifacts',{method:'POST',token:owner.token,headers:{'Idempotency-Key':'bundle_late_share_create'},json:{visibility:'private',html:'<img src="./logo.svg">',publicationBundle:{entryPath:'index.html',files:[file('logo.svg','<svg/>','image/svg+xml')]}}}));const saved=await created.json();expect(created.status).toBe(201);const child=saved.dependencyReceipts[0];const params={params:Promise.resolve({id:saved.id})};const url=`/a/${saved.id}/assets?dependency=${child.id}&revision=1&version=1`;
 const read=(actor:typeof readerActor)=>assetGet(request(url,{actor}),params);
 expect((await read(readerActor)).status).toBe(404);await updateSharingFor(ownerIdentity,saved.id,{shares:[{email:reader.email!,role:'viewer'}]});expect((await read(readerActor)).status).toBe(200);
 expect((await rawGet(request('/a/'+child.id+'/raw',{actor:readerActor}),{params:Promise.resolve({id:child.id})})).status).toBe(404);
 await updateSharingFor(ownerIdentity,saved.id,{shares:[]});expect((await read(readerActor)).status).toBe(404);expect((await read(ownerActor)).status).toBe(200);
 const group=await createGroup(user.id,{handle:'bundle-new-owner',name:'New owner'});await transferArtifact(ownerIdentity,saved.id,{type:'group',id:group.id});expect((await read(ownerActor)).status).toBe(404);
 await transferArtifact(ownerIdentity,child.id,{type:'group',id:group.id});expect((await read(ownerActor)).status).toBe(200);
 const db=await harness.db();await db.query('UPDATE artifacts SET deleted_at=now() WHERE id=$1',[child.id]);expect((await read(ownerActor)).status).toBe(404);
});
it('supports group membership granted after private bundle publication without broadening direct child URLs',async()=>{
 const {createUser}=await import('@/lib/accounts');const {createGroup,setGroupMember,removeGroupMember}=await import('@/lib/groups');const {GET:assetGet}=await import('@/app/a/[id]/assets/route');
 const user=await createUser({email:'mxmx_test_bundle_group_owner@example.com'}),member=await createUser({email:'mxmx_test_bundle_group_member@example.com'});const actor=await mintAccountToken('bundle-group-share',user.id);const group=await createGroup(user.id,{handle:'bundle-group-access',name:'Bundle access'});
 const created=await POST(request('/api/artifacts',{method:'POST',token:actor.token,headers:{'Idempotency-Key':'bundle_group_share_create'},json:{visibility:'private',destination:{type:'group',id:group.id},html:'<img src="./logo.svg">',publicationBundle:{entryPath:'index.html',files:[file('logo.svg','<svg/>','image/svg+xml')]}}}));const saved=await created.json();expect(created.status,JSON.stringify(saved)).toBe(201);const child=saved.dependencyReceipts[0],params={params:Promise.resolve({id:saved.id})};
 const read=()=>assetGet(request(`/a/${saved.id}/assets?dependency=${child.id}&revision=1`,{actor:{credential:'session',userId:member.id,email:member.email!,emailVerified:true}}),params);
 expect((await read()).status).toBe(404);await setGroupMember(user.id,group.id,member.id,'viewer');expect((await read()).status).toBe(200);await removeGroupMember(user.id,group.id,member.id);expect((await read()).status).toBe(404);
});
it('retains the complete dataset update wire reply including affected dependents on its first response and retry',async()=>{
 const actor=await mintAccountToken('dataset-receipt-equivalence');
 const created=await POST(request('/api/artifacts',{method:'POST',token:actor.token,json:{dataset:'name,value\nA,1\n'}}));const dataset=await created.json();
 const dependent=await (await POST(request('/api/artifacts',{method:'POST',token:actor.token,json:{html:`<link rel="af-dataset" data-af-name="tasks" href="ref:${dataset.id}"><h1>Dependent page</h1>`}}))).json();
 const params={params:Promise.resolve({id:dataset.id})};const head=await (await GET(request('/api/artifacts/'+dataset.id,{token:actor.token}),params)).json();
 const body={dataset:'name,value\nB,2\n',expectedVersion:head.version,expectedState:head.state};
 const send=()=>PUT(request('/api/artifacts/'+dataset.id,{method:'PUT',token:actor.token,headers:{'Idempotency-Key':'dataset_complete_wire_reply'},json:body}),params);
 const first=await send();const receipt=await first.json();expect(first.status,JSON.stringify(receipt)).toBe(200);expect(receipt.affected_dependents).toEqual([{id:dependent.id,title:dependent.title}]);
 const retry=await send();expect(retry.status).toBe(first.status);expect(await retry.json()).toEqual(receipt);
 const db=await harness.db();expect((await db.query<{version:number}>('SELECT version FROM artifacts WHERE id=$1',[dataset.id])).rows[0]?.version).toBe(2);
});

it('serves admitted module and font bytes to opaque runners without granting private or unrelated assets',async()=>{
 const {GET:assetGet}=await import('@/app/a/[id]/assets/route');
 const owner=await mintAccountToken('bundle-opaque-cors'),stranger=await mintAccountToken('bundle-opaque-stranger');
 const publish=async(visibility:'unlisted'|'private',key:string)=>{
  const response=await POST(request('/api/artifacts',{method:'POST',token:owner.token,headers:{'Idempotency-Key':key},json:{visibility,html:'<script type="module" src="./main.js"></script><link rel="stylesheet" href="./main.css">',publicationBundle:{entryPath:'index.html',files:[file('main.js','export const ready=true;','text/javascript'),file('main.css','@font-face{font-family:Fixture;src:url(./face.woff2)}','text/css'),file('face.woff2','wOF2fixture','font/woff2')]}}}));
  const saved=await response.json();expect(response.status,JSON.stringify(saved)).toBe(201);return saved;
 };
 const publicPage=await publish('unlisted','bundle_opaque_public_01'),privatePage=await publish('private','bundle_opaque_private_01');
 const load=(page:{id:string},receipt:{id:string;revision:string},origin:string,token?:string)=>assetGet(request(`/a/${page.id}/assets?dependency=${receipt.id}&revision=${receipt.revision}`,{token,headers:{Origin:origin}}),{params:Promise.resolve({id:page.id})});
 for(const receipt of publicPage.dependencyReceipts){
  const response=await load(publicPage,receipt,'null');expect(response.status).toBe(200);expect(response.headers.get('access-control-allow-origin')).toBe('*');expect(response.headers.has('access-control-allow-credentials')).toBe(false);
  expect(response.headers.get('cache-control')).toBe('no-store');expect(response.headers.get('x-content-type-options')).toBe('nosniff');expect(response.headers.get('content-security-policy')).toBe("default-src 'none'; sandbox");
  if(receipt.path==='main.js'){expect(response.headers.get('content-type')).toBe('text/javascript');expect(await response.text()).toBe('export const ready=true;');}
  if(receipt.path==='face.woff2'){expect(response.headers.get('content-type')).toBe('font/woff2');expect(await response.text()).toBe('wOF2fixture');}
 }
 for(const receipt of privatePage.dependencyReceipts){
  for(const token of [undefined,stranger.token]){const denied=await load(privatePage,receipt,'https://foreign.example',token);expect(denied.status).toBe(404);expect(denied.headers.has('access-control-allow-origin')).toBe(false);}
  const ownerResponse=await load(privatePage,receipt,'null',owner.token);expect(ownerResponse.status).toBe(200);expect(ownerResponse.headers.get('access-control-allow-origin')).toBe('*');
  const unrelated=await load(publicPage,receipt,'null',owner.token);expect(unrelated.status).toBe(404);expect(unrelated.headers.has('access-control-allow-origin')).toBe(false);
 }
});


it('admits linked CSS only through this native raw page asset endpoint',async()=>{
 const {GET:rawGet}=await import('@/app/a/[id]/raw/route');const {GET:assetGet}=await import('@/app/a/[id]/assets/route');
 const owner=await mintAccountToken('bundle-linked-style');
 const created=await POST(request('/api/artifacts',{method:'POST',token:owner.token,headers:{'Idempotency-Key':'bundle_linked_style_01'},json:{visibility:'unlisted',html:'<link rel="stylesheet" href="./theme.css"><h1>Styled</h1>',publicationBundle:{entryPath:'index.html',files:[file('theme.css','body{background:#f2e7d6}@font-face{font-family:Fixture;src:url(./face.woff2)}','text/css'),file('face.woff2','wOF2fixture','font/woff2')]}}}));
 const saved=await created.json();expect(created.status).toBe(201);const params={params:Promise.resolve({id:saved.id})};
 const rawRequest=request(`/a/${saved.id}/raw`),raw=await rawGet(rawRequest,params);expect(raw.status).toBe(200);
 const style=raw.headers.get('content-security-policy')!.split('; ').find(value=>value.startsWith('style-src '))!;
 const endpoint=new URL(rawRequest.url).origin+`/a/${saved.id}/assets`;expect(style.split(' ')).toContain(endpoint);expect(style.split(' ')).not.toContain("'self'");expect(style).not.toContain('/a/OtherPage/assets');expect(style.split(' ')).not.toContain(new URL(rawRequest.url).origin);
 const html=await raw.text();expect(html).toContain('rel="stylesheet"');expect(html).toContain(`/a/${saved.id}/assets?dependency=`);
 const css=saved.dependencyReceipts.find((receipt:{path:string})=>receipt.path==='theme.css');
 const served=await assetGet(request(`/a/${saved.id}/assets?dependency=${css.id}&revision=1&version=1`,{headers:{Origin:'null'}}),params);expect(served.status).toBe(200);expect(served.headers.get('content-type')).toBe('text/css');expect(served.headers.get('access-control-allow-origin')).toBe('*');expect(await served.text()).toContain(`/a/${saved.id}/assets?dependency=`);
});
it('repairs a failed middle dependency with returned mappings without reassigning successful reserved IDs',async()=>{
 const actor=await mintAccountToken('bundle-middle-repair');
 const html='<img src="first.svg"><object data="middle.exe"></object><img src="last.svg">';
 const sources=[file('first.svg','<svg>first</svg>','image/svg+xml'),file('middle.exe','middle','application/octet-stream'),file('last.svg','<svg>last</svg>','image/svg+xml')];
 const send=(files:typeof sources,mappings?:Record<string,unknown>)=>POST(request('/api/artifacts',{method:'POST',token:actor.token,headers:{'Idempotency-Key':'bundle_middle_repair_01'},json:{html:html.replace('middle.exe',files[1]!.path),publicationBundle:{entryPath:'index.html',files,...(mappings?{mappings}:{})}}}));
 const failed=await send(sources);const partial=await failed.json();expect(failed.status).toBe(409);expect(partial.dependencyReceipts.map((entry:{path:string})=>entry.path)).toEqual(['first.svg','last.svg']);
 const mappings=Object.fromEntries(partial.dependencyReceipts.map(({path,...entry}:{path:string})=>[path,entry]));
 const repaired=await send(sources.map(source=>source.path==='middle.exe'?{...source,path:'middle.txt',contentType:'text/plain'}:source),mappings);const saved=await repaired.json();expect(repaired.status,JSON.stringify(saved)).toBe(201);
 expect(saved.dependencyReceipts.filter((entry:{path:string})=>entry.path!=='middle.txt')).toEqual(partial.dependencyReceipts);
 const db=await harness.db();expect((await db.query<{n:number}>('SELECT count(*)::int n FROM artifacts')).rows[0]?.n).toBe(4);
});

it('continues dependency writes begun by the previous traversal-order allocator',async()=>{
 const {reserveIds}=await import('@/lib/artifacts');
 const actor=await mintAccountToken('bundle-previous-allocation');
 const {identityForUser}=await import('@/lib/accounts');
 const identity=identityForUser(actor.userId,actor.id);
 const key='bundle_previous_allocation_01',hash=(value:string)=>createHash('sha256').update(value).digest('hex');
 const reserved=await reserveIds(identity,hash(key+'_bundle_ids'));
 const sources=[file('z.svg','<svg>z</svg>','image/svg+xml'),file('a.svg','<svg>a</svg>','image/svg+xml')];
 const previous=await POST(request('/api/artifacts',{method:'POST',token:actor.token,headers:{'Idempotency-Key':hash(key+'_'+Buffer.from('z.svg').toString('base64url'))},json:{reserved_id:reserved[0],visibility:'unlisted',file:{filename:'z.svg',contentType:sources[0]!.contentType,base64:sources[0]!.base64}}}));const staged=await previous.json();expect(previous.status,JSON.stringify(staged)).toBe(201);
 const resumed=await POST(request('/api/artifacts',{method:'POST',token:actor.token,headers:{'Idempotency-Key':key},json:{html:'<img src="z.svg"><img src="a.svg">',publicationBundle:{entryPath:'index.html',files:sources}}}));const saved=await resumed.json();expect(resumed.status,JSON.stringify(saved)).toBe(201);
 expect(saved.dependencyReceipts.find((entry:{path:string})=>entry.path==='z.svg').id).toBe(staged.id);
 const altered=await POST(request('/api/artifacts',{method:'POST',token:actor.token,headers:{'Idempotency-Key':key},json:{html:'<img src="z.svg"><img src="a.svg">',publicationBundle:{entryPath:'index.html',files:[file('z.svg','<svg>different</svg>','image/svg+xml'),sources[1]]}}}));const refused=await altered.json();expect(altered.status).toBe(409);expect(refused.details).toContain('idempotency_mismatch');
 const other=await mintAccountToken('bundle-previous-other-owner');
 const independent=await POST(request('/api/artifacts',{method:'POST',token:other.token,headers:{'Idempotency-Key':key},json:{html:'<img src="z.svg"><img src="a.svg">',publicationBundle:{entryPath:'index.html',files:sources}}}));const owned=await independent.json();expect(independent.status,JSON.stringify(owned)).toBe(201);expect(owned.dependencyReceipts.every((entry:{id:string})=>!saved.dependencyReceipts.some((original:{id:string})=>original.id===entry.id))).toBe(true);

 const db=await harness.db();expect((await db.query<{n:number}>('SELECT count(*)::int n FROM artifacts')).rows[0]?.n).toBe(6);
});

describe('editor bundle saves',()=>{
 type Receipt={path:string;id:string;revision:string};
 const html='<link rel="stylesheet" href="./main.css"><img src="./logo.svg"><h1>One</h1>';
 const sources=[file('main.css','body{color:red}','text/css'),file('logo.svg','<svg/>','image/svg+xml')];
 const setup=async(slug:string)=>{
  const owner=await mintAccountToken('bundle-editor-owner-'+slug),editor=await mintAccountToken('bundle-editor-'+slug);
  const created=await POST(request('/api/artifacts',{method:'POST',token:owner.token,headers:{'Idempotency-Key':'bundle_editor_create_'+slug},json:{html,shares:[{email:editor.email,role:'editor'}],publicationBundle:{entryPath:'index.html',files:sources}}}));
  const saved=await created.json() as {id:string;dependencyReceipts:Receipt[]};expect(created.status,JSON.stringify(saved)).toBe(201);
  const params={params:Promise.resolve({id:saved.id})};
  const mappings=Object.fromEntries(saved.dependencyReceipts.map(({path,...entry})=>[path,entry]));
  const receipt=(path:string)=>saved.dependencyReceipts.find(entry=>entry.path===path)!;
  const save=async(token:string,key:string,files:typeof sources,page=html.replace('One','Two'))=>{
   const head=await (await GET(request('/api/artifacts/'+saved.id,{token}),params)).json();expect(head.version).toBe(1);
   const response=await PUT(request('/api/artifacts/'+saved.id,{method:'PUT',token,headers:{'Idempotency-Key':key},json:{html:page,expectedVersion:head.version,expectedState:head.state,publicationBundle:{entryPath:'index.html',files,mappings}}}),params);
   return {status:response.status,body:await response.json()};
  };
  const db=await harness.db();
  const revoke=(id:string)=>db.query('DELETE FROM artifact_shares WHERE artifact_id=$1',[id]);
  const version=async(id:string)=>(await db.query<{version:number}>('SELECT version FROM artifacts WHERE id=$1',[id])).rows[0]?.version;
  const count=async()=>(await db.query<{n:number}>('SELECT count(*)::int n FROM artifacts')).rows[0]?.n;
  return {owner,editor,saved,receipt,save,revoke,version,count,db};
 };
 it('saves unchanged files without edit access to them',async()=>{
  const {editor,saved,receipt,save,revoke,version}=await setup('unchanged');
  for(const entry of saved.dependencyReceipts)await revoke(entry.id);
  const result=await save(editor.token,'bundle_editor_unchanged_01',sources);expect(result.status,JSON.stringify(result.body)).toBe(200);
  expect(result.body.dependencyReceipts).toEqual(saved.dependencyReceipts);
  expect(await version(saved.id)).toBe(2);expect(await version(receipt('main.css').id)).toBe(1);
 });
 it('updates a changed file the editor can edit',async()=>{
  const {editor,saved,receipt,save,version}=await setup('changed');
  const result=await save(editor.token,'bundle_editor_changed_01',[file('main.css','body{color:blue}','text/css'),sources[1]!]);expect(result.status,JSON.stringify(result.body)).toBe(200);
  expect(result.body.dependencyReceipts.find((entry:Receipt)=>entry.path==='main.css')).toMatchObject({id:receipt('main.css').id,revision:'2'});
  expect(await version(receipt('main.css').id)).toBe(2);expect(await version(receipt('logo.svg').id)).toBe(1);expect(await version(saved.id)).toBe(2);
 });
 it('refuses a changed file the editor cannot edit, naming it, before writing anything',async()=>{
  const {editor,saved,receipt,save,revoke,version,count}=await setup('refused');
  await revoke(receipt('main.css').id);const before=await count();
  const result=await save(editor.token,'bundle_editor_refused_01',[file('main.css','body{color:blue}','text/css'),sources[1]!,file('extra.svg','<svg>extra</svg>','image/svg+xml')],html.replace('One','<img src="./extra.svg">'));
  expect(result.status).toBe(403);expect(result.body).toMatchObject({error:'bundle_file_not_editable',path:'main.css'});
  expect(await count()).toBe(before);expect(await version(receipt('main.css').id)).toBe(1);expect(await version(saved.id)).toBe(1);
 });
 it('creates a new file owned by the page owner, not the editor',async()=>{
  const {owner,editor,saved,save,db}=await setup('added');
  const result=await save(editor.token,'bundle_editor_added_01',[...sources,file('extra.svg','<svg>extra</svg>','image/svg+xml')],html.replace('One','<img src="./extra.svg">'));expect(result.status,JSON.stringify(result.body)).toBe(200);
  const added=result.body.dependencyReceipts.find((entry:Receipt)=>entry.path==='extra.svg');expect(added).toBeTruthy();
  expect(saved.dependencyReceipts.some(entry=>entry.id===added.id)).toBe(false);
  const row=(await db.query<{user_id:string|null}>('SELECT user_id FROM artifacts WHERE id=$1',[added.id])).rows[0];
  expect(row?.user_id).toBe(owner.userId);expect(row?.user_id).not.toBe(editor.userId);
 });
 it('still lets the owner change and add files',async()=>{
  const {owner,receipt,save,version}=await setup('owner');
  const result=await save(owner.token,'bundle_editor_owner_01',[file('main.css','body{color:green}','text/css'),sources[1]!,file('extra.svg','<svg>extra</svg>','image/svg+xml')],html.replace('One','<img src="./extra.svg">'));expect(result.status,JSON.stringify(result.body)).toBe(200);
  expect(result.body.dependencyReceipts.map((entry:Receipt)=>entry.path).sort()).toEqual(['extra.svg','logo.svg','main.css']);
  expect(await version(receipt('main.css').id)).toBe(2);
 });
});
