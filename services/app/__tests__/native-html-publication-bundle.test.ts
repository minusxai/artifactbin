import {it,expect} from 'vitest';
import {request,useAppHarness,mintAccountToken} from './harness';
import {POST} from '@/app/api/artifacts/route';
import {GET,PUT} from '@/app/api/artifacts/[id]/route';
const harness=useAppHarness();
const file=(path:string,source:string,contentType:string)=>({path,contentType,base64:Buffer.from(source).toString('base64')});
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
