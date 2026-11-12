import {Hono} from 'hono';
import {userHostIngress,userHostStaticPath} from '../user-host';
import {beforeEach,expect,it,vi} from 'vitest';
import {useAppHarness,request} from '@/__tests__/harness';
import {overrideConfig} from '@/lib/platform/config';
import {mintToken,createUser,setUsername} from '@/lib/accounts';
import {mintExportKey} from '@/lib/export';
import {getDb,services} from '@/lib/platform';
import {POST as publish} from '@/app/api/artifacts/route';
import {createAppServer} from '../app';
import {fixture,sql,stored} from '@/__tests__/page-sql-door-fixture';
import {ACTOR_HEADER} from '@artifactbin/contracts';
import {DOMAIN_HOME_CSP} from '@/lib/user-pages';
useAppHarness();
const app=()=>createAppServer({indexHtml:async()=>'<html><head><link rel="stylesheet" href="/shell.css"></head><body>APP</body></html>'});
const base='https://alice.u.example.test';
beforeEach(()=>overrideConfig({userPagesHost:'u.example.test',publicBaseUrl:'https://app.example.test'}));
async function owner(handle='alice'){
 const user=await createUser({email:`mxmx_test_${handle}_${Math.random()}@example.com`});const token=await mintToken('host-test',user.id);
 await setUsername(user.id,handle);return {id:user.id,token:token.token};
}
async function page(token:string,visibility='public',extra:Record<string,unknown>={}){
 const res=await publish(request('/api/artifacts',{method:'POST',token,json:{html:'<h1>Hello owner</h1>',title:'Hello world',visibility,...extra}}));
 expect(res.status,await res.clone().text()).toBe(201);return await res.json() as {id:string;user_page_url?:string|null};
}
it('serves bare IDs with 200, wrong slugs with 302, and keeps the app canonical',async()=>{
 const user=await owner(),post=await page(user.token),server=app();
 const res=await server.request(`${base}/${post.id}`);expect(res.status).toBe(200);
 const html=await res.text();expect(html).toContain('Hello owner');expect(html).toContain('https://app.example.test/@alice/');
 expect(res.headers.get('content-security-policy')).toContain('sandbox allow-scripts');expect(res.headers.get('content-security-policy')).not.toContain('allow-same-origin');
 const wrong=await server.request(`${base}/${post.id}-wrong?q=1`);expect(wrong.status).toBe(302);expect(wrong.headers.get('location')).toBe(`/${post.id}-hello-world?q=1`);
 const head=await server.request(`${base}/${post.id}`,{method:'HEAD'});expect(head.status).toBe(200);expect(await head.text()).toBe('');
});
it('lists only public HTML, serves unlisted by ID with privacy headers, and hides private IDs before redirects',async()=>{
 const user=await owner(),pub=await page(user.token),quiet=await page(user.token,'unlisted',{title:'Quiet words'}),secret=await page(user.token,'private'),server=app();
 const home=await server.request(`${base}/`);expect(home.status).toBe(200);const html=await home.text();expect(html).toContain(pub.id);expect(html).not.toContain(quiet.id);expect(html).not.toContain(secret.id);
 for(const path of [`/${quiet.id}`,`/${quiet.id}-wrong`]){const res=await server.request(base+path);expect(res.headers.get('x-robots-tag')).toContain('noindex');expect(res.headers.get('referrer-policy')).toBe('no-referrer');}
 for(const host of [base,'https://other.u.example.test'])expect((await server.request(`${host}/${secret.id}-wrong`)).status).toBe(404);
});
it('serves the earliest page titled index (any case) in place at the root, and the listing when there is none',async()=>{
 const user=await owner(),db=await getDb(),server=app();
 const other=await page(user.token,'public',{title:'Index of things'});
 let res=await server.request(`${base}/`);expect(res.status).toBe(200);expect(res.headers.get('content-security-policy')).toBe(DOMAIN_HOME_CSP);expect(await res.text()).toContain(other.id);
 await page(user.token,'public',{title:'index',html:'<h1>Later index</h1>'});const first=await page(user.token,'public',{title:'INDEX.',html:'<h1>First index</h1>'});
 await db.query("UPDATE artifacts SET created_at=now()-interval '1 day' WHERE id=$1",[first.id]);
 res=await server.request(`${base}/`,{headers:{authorization:`Bearer ${user.token}`,cookie:'session=secret'}});expect(res.status).toBe(200);
 const html=await res.text();expect(html).toContain('First index');expect(html).not.toContain('Later index');expect(html).toContain('https://app.example.test/@alice/');
 expect(res.headers.get('content-security-policy')).toContain('sandbox allow-scripts');expect(res.headers.has('set-cookie')).toBe(false);expect(res.headers.has('x-robots-tag')).toBe(false);
 const head=await server.request(`${base}/`,{method:'HEAD'});expect(head.status).toBe(200);expect(await head.text()).toBe('');
 // Its own reads still work from the root, as from its post address.
 expect((await server.request(`${base}/a/${first.id}/events/frame`)).status).toBe(200);
 // Deleted, the next earliest takes the root.
 await db.query('UPDATE artifacts SET deleted_at=now() WHERE id=$1',[first.id]);expect(await (await server.request(`${base}/`)).text()).toContain('Later index');
 // The earliest decides: a private or unlisted earliest "index" leaves the listing, never a later public one.
 for(const visibility of ['private','unlisted']){
  await db.query("UPDATE artifacts SET deleted_at=NULL,visibility=$2 WHERE id=$1",[first.id,visibility]);
  res=await server.request(`${base}/`);expect(res.headers.get('content-security-policy'),visibility).toBe(DOMAIN_HOME_CSP);const listing=await res.text();expect(listing).not.toContain('Later index');expect(listing).not.toContain('First index');
 }
});
it('serves a group host its own index page',async()=>{
 const user=await owner(),post=await page(user.token,'public',{title:'Index',html:'<h1>Team index</h1>'}),db=await getDb();
 await db.query("INSERT INTO groups(id,handle,name,description,created_by) VALUES('grp_idx','team_idx','Team','',$1)",[user.id]);
 const server=app();expect(await (await server.request(`${base}/`)).text()).toContain('Team index');
 await db.query("UPDATE artifacts SET group_id='grp_idx' WHERE id=$1",[post.id]);
 expect(await (await server.request('https://team-idx.u.example.test/')).text()).toContain('Team index');
 expect(await (await server.request(`${base}/`)).text()).not.toContain('Team index');
});
it('redirects directly to the live true owner after rename, reclaim and transfer',async()=>{
 const user=await owner(),post=await page(user.token),server=app();
 await setUsername(user.id,'renamed');await owner('alice');
 let res=await server.request(`${base}/${post.id}-old?q=1`);expect(res.status).toBe(301);expect(res.headers.get('location')).toBe(`https://renamed.u.example.test/${post.id}-hello-world?q=1`);
 const other=await owner('other');await (await getDb()).query('UPDATE artifacts SET user_id=$1 WHERE id=$2',[other.id,post.id]);
 res=await server.request(`https://renamed.u.example.test/${post.id}`);expect(res.status).toBe(301);expect(res.headers.get('location')).toBe(`https://other.u.example.test/${post.id}-hello-world`);
});
it('serves groups by actual ownership and refuses deleted groups or creator hosts',async()=>{
 const user=await owner(),post=await page(user.token,'unlisted'),db=await getDb();
 await db.query("INSERT INTO groups(id,handle,name,description,created_by) VALUES('grp_host','team_one','Team','',$1)",[user.id]);
 await db.query("UPDATE artifacts SET group_id='grp_host' WHERE id=$1",[post.id]);
 const server=app();expect((await server.request(`https://team-one.u.example.test/${post.id}`)).status).toBe(200);
 expect((await server.request(`${base}/${post.id}`)).status).toBe(301);
 await db.query("UPDATE groups SET deleted_at=now() WHERE id='grp_host'");expect((await server.request(`https://team-one.u.example.test/${post.id}`)).status).toBe(404);
});
it('denies retired compiler, identity and encoded doors even carrying credentials',async()=>{
 const user=await owner(),post=await page(user.token),server=app();
 for(const path of ['/login','/api/my/domain','/api/domains/allow',`/a/${post.id}/query`,`/a/${post.id}/mutate`,`/a/${post.id}/story`,`/a/${post.id}/viewer`,'/islands/x.js','/%61pi/tokens','/af/chrome.js','/af/host.js','/af/state.js/extra','/af/state.js.map','/af/%73tate.js','/af/native-regions.js','/af/private.js','/api/tokens','/api/admin/settings','/api/internal/build-assets/assets/app.css']){
  const res=await server.request(base+path,{headers:{authorization:`Bearer ${user.token}`,cookie:'session=secret'}});expect(res.status,path).toBe(404);expect(res.headers.has('set-cookie')).toBe(false);
 }
 for(const host of ['https://u.example.test','https://app.u.example.test','https://a.b.u.example.test'])expect((await server.request(host+'/')).status).toBe(404);
});
it('refuses every retired GraphQL request, even carrying account credentials',async()=>{
 const user=await owner(),post=await page(user.token,'unlisted'),server=app();
 for(const method of ['GET','POST']){const res=await server.request(`${base}/api/artifacts/${post.id}/graphql`,{method,headers:{authorization:`Bearer ${user.token}`,'content-type':'text/plain'},...(method==='POST'?{body:JSON.stringify({query:'{__typename}'})}:{})});expect(res.status).toBe(404);expect(res.headers.has('set-cookie')).toBe(false);}
});
it('removes retired domain API routes on the app host',async()=>{
 await owner();const server=app();for(const path of ['/api/my/domain','/api/my/domain/verify','/api/domains/allow'])expect((await server.request('https://app.example.test'+path)).status).toBe(404);
});
it('serves native static and live read doors and no credential-bearing script entry points',async()=>{
 const user=await owner(),post=await page(user.token),server=app();
 for(const path of ['/af/state.js','/af/apollo.js','/af/reader.js','/af/components/button.js','/af/styles.css']){
  const response=await server.request(base+path,{headers:{authorization:`Bearer ${user.token}`,cookie:'session=secret'}});
  expect(response.status,path).toBe(200);expect(response.headers.has('set-cookie')).toBe(false);
  const anonymous=await server.request(base+path);expect(anonymous.status,path).toBe(200);
  expect(anonymous.headers.get('access-control-allow-origin')).toBe('*');
  expect(anonymous.headers.has('access-control-allow-credentials')).toBe(false);
  expect(await anonymous.text()).toBe(await response.text());
  const head=await server.request(base+path,{method:'HEAD'});expect(head.status,path).toBe(200);expect(await head.text()).toBe('');
  expect((await server.request(base+path,{method:'POST'})).status).toBe(404);
 }
 expect((await server.request(`${base}/a/${post.id}/assets`)).status).toBe(400);
 expect((await server.request(`${base}/a/${post.id}/resolve`)).status).toBe(404);
 expect((await server.request(`${base}/a/${post.id}/events/frame`)).status).toBe(200);
 const stream=await server.request(`${base}/a/${post.id}/events`);expect(stream.status).toBe(200);expect(stream.headers.get('content-type')).toContain('text/event-stream');await stream.body?.cancel();
});
it('returns public view receipts only for eligible current owners',async()=>{
 const user=await owner(),pub=await page(user.token),quiet=await page(user.token,'unlisted'),secret=await page(user.token,'private');
 expect(pub.user_page_url).toBe(`${base}/${pub.id}-hello-world`);expect(quiet.user_page_url).toBe(`${base}/${quiet.id}-hello-world`);expect(secret.user_page_url).toBeNull();
 overrideConfig({userPagesHost:null});expect((await page(user.token)).user_page_url).toBeNull();
});
it('never turns an account bearer into dataset guest authority',async()=>{
 const user=await owner();
 const created=await publish(request('/api/artifacts',{method:'POST',token:user.token,json:{dataset:[{secret:'hidden'}],visibility:'private'}}));expect(created.status).toBe(201);const dataset=await created.json();
 const linked=await page(user.token,'unlisted',{html:`<link rel="af-dataset" data-af-name="secret_data" href="ref:${dataset.id}"><h1>Dataset guest</h1>`});
 const response=await app().request(`${base}/api/artifacts/${linked.id}/graphql`,{method:'POST',headers:{authorization:`Bearer ${user.token}`,cookie:'session=secret','content-type':'text/plain'},body:JSON.stringify({revision:'1',query:'{ secret_data { secret } }'})});
 expect(response.status).toBe(404);expect(response.headers.has('set-cookie')).toBe(false);expect(await response.text()).not.toContain('hidden');
});

it('bypasses composition authentication before it can resolve or refresh a session',async()=>{
 const user=await owner(),post=await page(user.token),inner=app(),outer=new Hono();let authCalls=0;
 outer.use('*',userHostIngress(inner));
 outer.use('*',async(c,next)=>{authCalls++;await next();c.header('set-cookie','session=refreshed');});
 outer.all('*',c=>inner.fetch(c.req.raw));
 const response=await outer.request(`${base}/${post.id}`,{headers:{authorization:`Bearer ${user.token}`,cookie:'session=held'}});
 expect(response.status).toBe(200);expect(authCalls).toBe(0);expect(response.headers.has('set-cookie')).toBe(false);
 await outer.request('https://app.example.test/login');expect(authCalls).toBe(1);
});
it('serves referenced public/unlisted image bytes on raw and native resolve, and revokes them with the post',async()=>{
 const user=await owner(),png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==','base64');
 const uploaded=await publish(new Request('http://localhost:3000/api/artifacts?visibility=unlisted',{method:'POST',headers:{'content-type':'image/png',authorization:`Bearer ${user.token}`},body:new Uint8Array(png)}));
 expect(uploaded.status,await uploaded.clone().text()).toBe(201);const image=await uploaded.json();
 const unrelated=await page(user.token),server=app();expect((await server.request(`${base}/a/${image.id}/raw`)).status).toBe(404);
 expect((await server.request(`${base}/a/${unrelated.id}/resolve?ref=ref:${image.id}`)).status).toBe(404);
 const linked=await page(user.token,'unlisted',{html:`<h1>Linked bytes</h1><img src="ref:${image.id}">`});
 for(const path of [`/a/${image.id}/raw`,`/a/${linked.id}/resolve?ref=ref:${image.id}`]){
  const response=await server.request(base+path);expect(response.status,path).toBe(200);expect(response.headers.get('content-type')).toContain('image/');expect(response.headers.get('x-robots-tag')).toContain('noindex');await response.body?.cancel();
  const head=await server.request(base+path,{method:'HEAD'});expect(head.status,path).toBe(200);expect(await head.text()).toBe('');
 }
 await (await getDb()).query("UPDATE artifacts SET visibility='private' WHERE id=$1",[linked.id]);
 expect((await server.request(`${base}/a/${image.id}/raw`,{headers:{authorization:`Bearer ${user.token}`}})).status).toBe(404);
});
it('exposes the same eligible public-view URL on reads, replacements and the app bootstrap',async()=>{
 const user=await owner(),post=await page(user.token),server=app();
 const headResponse=await server.request(`https://app.example.test/api/artifacts/${post.id}`,{headers:{authorization:`Bearer ${user.token}`}});
 expect(headResponse.status).toBe(200);const head=await headResponse.json();expect(head.user_page_url).toBe(post.user_page_url);
 const replaced=await server.request(`https://app.example.test/api/artifacts/${post.id}`,{method:'PUT',headers:{authorization:`Bearer ${user.token}`,'content-type':'application/json'},body:JSON.stringify({html:head.html.replace('Hello owner','Replacement'),title:head.title,expectedVersion:head.version,expectedState:head.state})});
 expect(replaced.status,await replaced.clone().text()).toBe(200);expect((await replaced.json()).user_page_url).toBe(post.user_page_url);
 const framed=await server.request(`https://app.example.test/a/${post.id}`);expect(framed.status).toBe(200);expect(await framed.text()).toContain(post.user_page_url);
});

it('shares one static allowlist with dev ingress and rejects encoded or executable Vite paths',()=>{
 for(const path of ['/af/state.js','/af/apollo.js','/af/reader.js','/af/components/chunk-ab12.js','/af/styles.css','/af/fonts/test.woff2','/af/app/app-123.css','/af/lib/vega-6.3.1/index.js','/af/geojson/world.json'])expect(userHostStaticPath(path),path).toBe(true);
 for(const path of ['/fonts/test.woff2','/geojson/world.json','/solid-entry.tsx','/@vite/client','/@fs/private.ts','/islands/entry.js','/af/app/app-123.js','/assets/app-123.css','/af/chrome.js','/fonts/%2f../private.ts','/api/internal/build-assets/assets/app.css'])expect(userHostStaticPath(path),path).toBe(false);
});

it('an owner host has no function door: its unframed CSP admits no function path, and a function path is not found',async()=>{
 const user=await owner(),post=await page(user.token),server=app();
 const res=await server.request(`${base}/${post.id}`);
 const connect=res.headers.get('content-security-policy')!.split(';').find(part=>part.trim().startsWith('connect-src'))!;
 expect(connect).not.toContain('/fn/');
 expect((await server.request(`${base}/api/artifacts/${post.id}/fn/missing?revision=1`,{headers:{origin:'null'}})).status).toBe(404);
});

it('owner-host SQL is the canonical anonymous read, always read-only and credential-free',async()=>{
 const f=await fixture();await setUsername(f.owner.userId!,'alice');const server=app();
 const read=(text='select name from staff order by name',extra:Record<string,unknown>={},host=base)=>server.request(`${host}/api/artifacts/${f.page}/sql`,{method:'POST',headers:{origin:'null','content-type':'text/plain',authorization:`Bearer ${f.owner.token}`,cookie:'session=secret','proxy-authorization':'Bearer ignored',[ACTOR_HEADER]:'ignored','idempotency-key':'invalid'},body:JSON.stringify({sql:text,revision:'1',readOnly:false,key:'ignored',...extra})});
 await (await getDb()).query(`UPDATE artifacts SET dataset_policy=jsonb_set(dataset_policy,'{tables,0,select_permissions,2,permission,filter}',$2::jsonb),policy_revision=policy_revision+1 WHERE id=$1`,[f.staff,JSON.stringify({name:{_eq:'ada'}})]);
 const canonical=await sql(f.page,null,'select name from staff order by name');
 expect(canonical.body.rows).toEqual([{name:'ada'}]);
 for(const visibility of ['public','unlisted']){
  await (await getDb()).query('UPDATE artifacts SET visibility=$2 WHERE id=$1',[f.page,visibility]);
  const response=await read();expect(response.status,await response.clone().text()).toBe(200);expect(await response.json()).toEqual(canonical.body);
  expect(response.headers.get('access-control-allow-origin')).toBe('*');expect(response.headers.has('access-control-allow-credentials')).toBe(false);expect(response.headers.has('set-cookie')).toBe(false);
  const html=await server.request(`${base}/${f.page}`);expect(html.headers.get('content-security-policy')).toContain(`${base}/api/artifacts/${f.page}/sql`);
 }
 const before=await stored(f.staff);
 for(const text of ["insert into staff(name) values('bad')","update staff set name='bad'",'delete from staff','drop table staff','select salary from staff','select * from unlinked'])expect((await read(text)).status,text).toBeGreaterThanOrEqual(400);
 expect(await stored(f.staff)).toEqual(before);
 expect((await read(undefined,{revision:'revoked'})).status).toBe(404);
 await owner('other');expect((await read(undefined,{},'https://other.u.example.test')).status).toBe(404);
 const db=await getDb();
 for(const change of ["visibility='private'","deleted_at=now()",'user_id=NULL']){
  await db.query(`UPDATE artifacts SET ${change} WHERE id=$1`,[f.page]);expect((await read()).status).toBe(404);
  await db.query("UPDATE artifacts SET visibility='unlisted',deleted_at=NULL,user_id=$2 WHERE id=$1",[f.page,f.owner.userId]);
 }
 await db.query("UPDATE artifacts SET visibility='private' WHERE id=$1",[f.staff]);expect((await read()).status).toBeGreaterThanOrEqual(400);
 await db.query("UPDATE artifacts SET visibility='unlisted',dataset_policy=$2::jsonb,policy_revision=policy_revision+1 WHERE id=$1",[f.staff,JSON.stringify({version:3,tables:[]})]);expect((await read()).status).toBeGreaterThanOrEqual(400);
});

it('owner-host SQL ignores valid capture authority, while canonical opaque capture reads keep working',async()=>{
 const f=await fixture();await setUsername(f.owner.userId!,'alice');const server=app(),db=await getDb();
 await db.query("UPDATE artifacts SET visibility='private' WHERE id=$1",[f.page]);
 const key=mintExportKey(f.page,60_000,Date.now(),f.owner.actor);
 const send=(host:string,key?:string)=>server.request(`${host}/api/artifacts/${f.page}/sql`,{method:'POST',headers:{origin:'null','content-type':'text/plain',authorization:`Bearer ${f.owner.token}`},body:JSON.stringify({sql:'select salary from staff',revision:'1',readOnly:false,key})});
 expect((await send(base,key)).status).toBe(404);
 expect((await send('https://app.example.test')).status).toBe(403);
 const capture=await send('https://app.example.test',key);expect(capture.status).toBe(200);expect((await capture.json()).rows).toEqual([{salary:10},{salary:20}]);
 await db.query("UPDATE artifacts SET visibility='public' WHERE id=$1",[f.page]);
 expect((await send(base,key)).status).toBeGreaterThanOrEqual(400);
});

it('owner-host SQL withholds results when page, owner identity or dataset access changes during execution',async()=>{
 const f=await fixture();await setUsername(f.owner.userId!,'alice');const server=app(),db=await getDb(),engine=services().sql,run=engine.run.bind(engine);
 for(const change of [
  ()=>db.query("UPDATE artifacts SET visibility='private' WHERE id=$1",[f.page]),
  ()=>db.query('UPDATE artifacts SET deleted_at=now() WHERE id=$1',[f.page]),
  ()=>db.query('UPDATE artifacts SET user_id=$2 WHERE id=$1',[f.page,f.other.userId]),
  ()=>setUsername(f.owner.userId!,'renamed'),
  ()=>db.query('UPDATE artifacts SET version=version+1 WHERE id=$1',[f.page]),
  ()=>db.query('UPDATE artifacts SET dataset_policy=$2::jsonb,policy_revision=policy_revision+1 WHERE id=$1',[f.staff,JSON.stringify({version:3,tables:[]})]),
 ]){
  let changed=false;
  const spy=vi.spyOn(engine,'run').mockImplementation(async input=>{const result=await run(input);if(!changed){changed=true;await change();}return result;});
  try{
   const res=await server.request(`${base}/api/artifacts/${f.page}/sql`,{method:'POST',headers:{origin:'null','content-type':'text/plain'},body:JSON.stringify({sql:'select name from staff',revision:'1'})});
   expect(changed).toBe(true);expect(res.status).toBeGreaterThanOrEqual(400);expect(await res.text()).not.toContain('ada');
  }finally{spy.mockRestore();}
  await db.query("UPDATE artifacts SET visibility='unlisted',deleted_at=NULL,user_id=$2,version=1 WHERE id=$1",[f.page,f.owner.userId]);await setUsername(f.owner.userId!,'alice');
 }
});

it('owner-host SQL follows current group ownership and hides dead or reclaimed identities',async()=>{
 const f=await fixture();await setUsername(f.owner.userId!,'alice');const server=app(),db=await getDb();
 await db.query("INSERT INTO groups(id,handle,name,description,created_by) VALUES('grp_sql','sql_team','Team','',$1)",[f.owner.userId]);
 await db.query("UPDATE artifacts SET group_id='grp_sql' WHERE id=$1",[f.page]);
 const read=(host:string,method='POST')=>server.request(`${host}/api/artifacts/${f.page}/sql`,{method,...(method==='POST'?{headers:{origin:'null','content-type':'text/plain'},body:JSON.stringify({sql:'select name from staff',revision:'1'})}:{})});
 expect((await read(base)).status).toBe(404);
 const groupHost='https://sql-team.u.example.test';expect((await read(groupHost)).status).toBe(200);
 for(const method of ['GET','HEAD','PUT','OPTIONS'])expect((await read(groupHost,method)).status).toBe(404);
 await db.query("UPDATE groups SET deleted_at=now() WHERE id='grp_sql'");expect((await read(groupHost)).status).toBe(404);
 await db.query('UPDATE artifacts SET group_id=NULL WHERE id=$1',[f.page]);
 await setUsername(f.owner.userId!,'renamed');await owner('alice');expect((await read(base)).status).toBe(404);
 expect((await read('https://renamed.u.example.test')).status).toBe(200);
});
