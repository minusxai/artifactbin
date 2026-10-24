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

it('reuses observed mappings for conditional updates and refuses changed local dataset bytes',async()=>{
 const actor=await mintAccountToken('bundle-update');
 const html='<link rel="af-dataset" data-af-name="tasks" href="./tasks.csv"><h1>One</h1>';
 const source=file('tasks.csv','name,value\nA,1\n','text/csv');
 const create=await POST(request('/api/artifacts',{method:'POST',token:actor.token,headers:{'Idempotency-Key':'bundle_update_create_01'},json:{html,publicationBundle:{entryPath:'index.html',files:[source]}}}));const saved=await create.json();expect(create.status).toBe(201);
 const params={params:Promise.resolve({id:saved.id})};
 const head=await (await GET(request('/api/artifacts/'+saved.id,{token:actor.token}),params)).json();
 const mapping=Object.fromEntries(saved.dependencyReceipts.map(({path,...entry}:{path:string})=>[path,entry]));
 const body={html:html.replace('One','Two'),expectedVersion:head.version,expectedState:head.state,publicationBundle:{entryPath:'index.html',files:[source],mappings:mapping}};
 const changed=await PUT(request('/api/artifacts/'+saved.id,{method:'PUT',token:actor.token,headers:{'Idempotency-Key':'bundle_update_changed_01'},json:{...body,publicationBundle:{...body.publicationBundle,files:[file('tasks.csv','name,value\nB,2\n','text/csv')]}}}),params);expect(changed.status).toBe(409);
 const update=await PUT(request('/api/artifacts/'+saved.id,{method:'PUT',token:actor.token,headers:{'Idempotency-Key':'bundle_update_success_01'},json:body}),params);const receipt=await update.json();expect(update.status,JSON.stringify(receipt)).toBe(200);expect(receipt.dependencyReceipts).toHaveLength(1);
 const db=await harness.db();expect((await db.query<{n:number}>('SELECT count(*)::int n FROM artifacts')).rows[0]?.n).toBe(2);
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
 expect((await app.request(url,{headers:{cookie:'__Host-afbin_pages='+readerCookie}})).status).toBe(404);
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
