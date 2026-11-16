/** A group's folder browser uses the same caller-visible hierarchy for sessions and bearer callers. */
import {Hono} from 'hono';
import {expect,it,beforeEach} from 'vitest';
import {bearerAdmission} from '@artifactbin/auth';
import {createOAuthStore} from '@artifactbin/auth/identity/oauth';
import {attachActor} from '@artifactbin/utils';
import type {Actor} from '@artifactbin/contracts';
import {mountRoutes} from '../server/api';
import {createGroup} from '@/lib/groups';
import {getDb,setServices} from '@/lib/platform';
import {admitGroupMember,bearerIdentity,mintAccountToken,useAppHarness} from './harness';
useAppHarness();
const app=new Hono();mountRoutes(app);
beforeEach(()=>setServices({humanSessions:{live:async(id,user)=>id===`sess_${user}`}}));
it('lists a group folder at root, pages files without duplicates, and admits the member session',async()=>{
 const owner=await mintAccountToken('collection_owner'),member=await mintAccountToken('collection_member'),stranger=await mintAccountToken('collection_stranger');
 const group=await createGroup(owner.userId!,{handle:'collection_team',name:'Collection team'});
 await admitGroupMember(owner.userId!,group.id,member.userId!,'member');
 const create=async(body:object)=>{
  const r=await app.request('/api/artifacts',{method:'POST',headers:{authorization:`Bearer ${owner.token}`,'content-type':'application/json'},body:JSON.stringify({visibility:'private',destination:{type:'group',id:group.id},...body})});
  expect(r.status,await r.clone().text()).toBe(201);return (await r.json() as {id:string}).id;
 };
 const folder=await create({format:'folder',title:'Reports'});
 const nested=await create({format:'folder',title:'Archive',parent_id:folder});
 const files=[];for(let i=0;i<3;i++)files.push(await create({html:`<!doctype html><html><head><title>Result ${i}</title></head><body><h1>Result ${i}</h1></body></html>`,title:`Result ${i}`,parent_id:folder}));
 const session:Actor={credential:'session',sessionId:`sess_${member.userId}`,userId:member.userId!,email:'member@example.test',emailVerified:true};
 const invalidBearer=await app.request(attachActor(new Request(`http://localhost/api/groups/${group.id}/collection`,{headers:{authorization:'Bearer invalid'}}),session));
 expect(invalidBearer.status).toBe(401);
 expect((await app.request(`/api/groups/${group.id}/collection`)).status).toBeGreaterThanOrEqual(401);
 const root=await app.request(attachActor(new Request(`http://localhost/api/groups/${group.id}/collection?limit=2`),session));
 expect(root.status,await root.clone().text()).toBe(200);
 const body=await root.json() as {items:Array<{id:string;format:string;parent_id:string|null}>;next_cursor:string|null};
 expect(body.items.map(x=>x.id)).toEqual([folder]);expect(body.items[0]).toMatchObject({format:'folder',parent_id:null});
 const found:string[]=[];let cursor:string|null=null;
 do{
  const q=new URLSearchParams({parent_id:folder,limit:'2',...(cursor?{cursor}:{})});
  const r=await app.request(`/api/groups/${group.id}/collection?${q}`,{headers:{authorization:`Bearer ${member.token}`}});
  expect(r.status,await r.clone().text()).toBe(200);const b=await r.json() as typeof body;
  for(const item of b.items){expect(item.parent_id).toBe(folder);found.push(item.id);}cursor=b.next_cursor;
  expect(found.length).toBeLessThanOrEqual(4);
 }while(cursor);
 expect(found.sort()).toEqual([nested,...files].sort());
 const denied=await app.request(`/api/groups/${group.id}/collection`,{headers:{authorization:`Bearer ${stranger.token}`}});expect(denied.status).toBe(404);
});

it('keeps inherited reach directional, redacts hidden parents, browses shared shelves and rechecks revocation',async()=>{
 const owner=await mintAccountToken('collection_acl_owner'),member=await mintAccountToken('collection_acl_member'),peer=await mintAccountToken('collection_acl_peer');
 const top=await createGroup(owner.userId!,{handle:'collection_top',name:'Top'});
 const child=await createGroup(owner.userId!,{handle:'collection_child',name:'Child',parent_id:top.id});
 const side=await createGroup(owner.userId!,{handle:'collection_side',name:'Side',parent_id:top.id});
 await admitGroupMember(owner.userId!,child.id,member.userId!,'member');
 await admitGroupMember(owner.userId!,child.id,peer.userId!,'member');
 const call=async(who:typeof member,g=child.id,q='')=>app.request(`/api/groups/${g}/collection${q}`,{headers:{authorization:`Bearer ${who.token}`}});
 const create=async(body:object)=>{
  const r=await app.request('/api/artifacts',{method:'POST',headers:{authorization:`Bearer ${owner.token}`,'content-type':'application/json'},body:JSON.stringify({visibility:'private',...body})});
  expect(r.status,await r.clone().text()).toBe(201);return (await r.json() as {id:string}).id;
 };
 const page=(title:string,extra:object={})=>create({title,html:`<!doctype html><html><head><title>${title}</title></head><body><p>${title}</p></body></html>`,...extra});
 const folder=await create({format:'folder',title:'Shared shelf'});
 const nested=await create({format:'folder',title:'Nested',parent_id:folder});
 const privateFile=await page('Private child',{parent_id:folder});
 const deep=await page('Deep child',{parent_id:nested});
 const publicFile=await page('Public child',{visibility:'public',parent_id:folder});
 const hidden=await create({format:'folder',title:'Hidden container'});
 const orphan=await page('Direct share',{parent_id:hidden});
 const unrelated=await page('Unrelated',{visibility:'public'});
 const inherited=await create({format:'folder',title:'Ancestor owned',destination:{type:'group',id:top.id}});
 const inheritedFile=await page('Ancestor child',{parent_id:inherited,destination:{type:'group',id:top.id}});
 const sideFile=await page('Side only',{destination:{type:'group',id:side.id}});
 const share=async(id:string,role:'viewer'|'commenter'|null)=>{
  const r=await app.request(`/api/artifacts/${id}/group-shares/${top.id}`,{method:role?'PUT':'DELETE',headers:{authorization:`Bearer ${owner.token}`,'content-type':'application/json'},...(role?{body:JSON.stringify({role})}:{})});expect(r.status,await r.clone().text()).toBe(200);
 };
 await share(folder,'commenter');await share(orphan,'viewer');
 const root=await (await call(member)).json() as import('@artifactbin/contracts').GroupCollection;
 expect(root.items.map(x=>x.id).sort()).toEqual([folder,orphan,inherited].sort());
 expect(root.items.find(x=>x.id===orphan)?.parent_id).toBeNull();
 for(const secret of [hidden,'Hidden container',unrelated,sideFile,privateFile,deep,'ancestor_ids','source','email'])expect(JSON.stringify(root)).not.toContain(secret);
 const list=async(parent:string)=>{
  const result=await call(member,child.id,`?parent_id=${parent}`);expect(result.status).toBe(200);return (await result.json() as import('@artifactbin/contracts').GroupCollection).items.map(x=>x.id).sort();
 };
 expect(await list(folder)).toEqual([nested,privateFile,publicFile].sort());
 // Commenter shelf access grants discovery of the private nested folder, but its own
 // shelf still applies its own viewer relationship; sharing the outer shelf is not recursive ACL inheritance.
 expect(await list(nested)).toEqual([]);
 expect(await list(inherited)).toEqual([inheritedFile]);
 for(const id of [hidden,'absent',orphan])expect((await call(member,child.id,`?parent_id=${id}`)).status).toBe(404);
 expect((await call(member,top.id)).status).toBe(404);
 expect((await call(member,side.id)).status).toBe(404);
 const first=await (await call(member,child.id,'?limit=1')).json() as import('@artifactbin/contracts').GroupCollection;
 expect(first.next_cursor).toBeTypeOf('string');
 const q=`?limit=1&cursor=${encodeURIComponent(first.next_cursor!)}`;
 for(const [who,g,query] of [[peer,child.id,q],[owner,top.id,q],[member,child.id,q+'&parent_id='+folder],[member,child.id,q.replace('limit=1','limit=2')],[member,child.id,'?cursor=garbage'],[member,child.id,q+'x']] as const){
  const r=await call(who,g,query);expect(r.status,await r.clone().text()).toBe(400);
 }
 for(const limit of ['0','101','1.5','nope'])expect((await call(member,child.id,`?limit=${limit}`)).status).toBe(400);
 await share(folder,'viewer');expect(await list(folder)).toEqual([publicFile]);
 await share(folder,null);expect((await call(member,child.id,`?parent_id=${folder}`)).status).toBe(404);
 const left=await app.request(`/api/groups/${child.id}/members/me`,{method:'DELETE',headers:{authorization:`Bearer ${member.token}`}});expect(left.status).toBe(200);
 expect((await call(member,child.id,q)).status).toBe(404);
});

it('pages past excluded batches without a global cap, preserves tied ordering and omits deleted rows',async()=>{
 const owner=await mintAccountToken('collection_volume_owner'),member=await mintAccountToken('collection_volume_member');
 const group=await createGroup(owner.userId!,{handle:'collection_volume',name:'Volume'});
 await admitGroupMember(owner.userId!,group.id,member.userId!,'member');
 const create=async(body:object)=>{
  const r=await app.request('/api/artifacts',{method:'POST',headers:{authorization:`Bearer ${owner.token}`,'content-type':'application/json'},body:JSON.stringify({visibility:'private',...body})});expect(r.status,await r.clone().text()).toBe(201);return (await r.json() as {id:string}).id;
 };
 const folder=await create({format:'folder',title:'Volume'});
 const base=await create({parent_id:folder,html:'<!doctype html><html><head><title>Volume</title></head><body><p>Volume</p></body></html>'});
 const share=await app.request(`/api/artifacts/${folder}/group-shares/${group.id}`,{method:'PUT',headers:{authorization:`Bearer ${owner.token}`,'content-type':'application/json'},body:JSON.stringify({role:'viewer'})});expect(share.status).toBe(200);
 const db=await getDb();
 // Clone real created rows into a large static shelf; newer private rows must not
 // consume the page or hide older public files. Include every supported format.
 await db.query(`INSERT INTO artifacts SELECT (jsonb_populate_record(NULL::artifacts,to_jsonb(a)||jsonb_build_object(
  'id','collection_volume_'||lpad(n::text,4,'0'),'format',(ARRAY['html','markup','dataset','viz','image','pdf','file','program'])[1+(n%8)],
  'visibility',CASE WHEN n<=120 THEN 'private' ELSE 'public' END,
  'updated_at',CASE WHEN n<=120 THEN '2025-02-02T00:00:00Z' ELSE '2025-01-01T00:00:00Z' END,
  'deleted_at',CASE WHEN n=350 THEN '2025-03-01T00:00:00Z' ELSE NULL END))).* FROM artifacts a CROSS JOIN generate_series(1,350) n WHERE a.id=$1`,[base]);
 const found:string[]=[],formats=new Set<string>();let cursor:string|null=null;
 do{
  const q=new URLSearchParams({parent_id:folder,limit:'37',...(cursor?{cursor}:{})});
  const r=await app.request(`/api/groups/${group.id}/collection?${q}`,{headers:{authorization:`Bearer ${member.token}`}});expect(r.status,await r.clone().text()).toBe(200);
  const b=await r.json() as import('@artifactbin/contracts').GroupCollection;
  expect(b.items.length).toBeLessThanOrEqual(37);for(const row of b.items){found.push(row.id);formats.add(row.format);expect(row.parent_id).toBe(folder);}cursor=b.next_cursor;expect(found.length).toBeLessThanOrEqual(229);
 }while(cursor);
 expect(found).toEqual(Array.from({length:229},(_,i)=>`collection_volume_${String(i+121).padStart(4,'0')}`));
 expect([...formats].sort()).toEqual(['html','markup','dataset','viz','image','pdf','file','program'].sort());
 expect((await db.query<{format:string}>('SELECT format FROM artifacts WHERE id=$1',[folder])).rows[0].format).toBe('folder');
 await db.query('UPDATE artifacts SET deleted_at=now() WHERE id=$1',[folder]);
 expect((await app.request(`/api/groups/${group.id}/collection?parent_id=${folder}`,{headers:{authorization:`Bearer ${member.token}`}})).status).toBe(404);
 const deleted=await app.request(`/api/groups/${group.id}`,{method:'DELETE',headers:{authorization:`Bearer ${owner.token}`,'content-type':'application/json'},body:JSON.stringify({handle:'collection_volume'})});expect(deleted.status).toBe(200);
 expect((await app.request(`/api/groups/${group.id}/collection`,{headers:{authorization:`Bearer ${member.token}`}})).status).toBe(404);
});


it('admits artifacts-scoped OAuth through the real bearer boundary and rejects wrong audience, scope and revoked family',async()=>{
 const owner=await mintAccountToken('collection_oauth_owner'),member=await mintAccountToken('collection_oauth_member',undefined,{audience:'http://localhost/api',scope:'artifacts'});
 const group=await createGroup(owner.userId!,{handle:'collection_oauth',name:'OAuth collection'});
 await admitGroupMember(owner.userId!,group.id,member.userId!,'member');
 const bearers=await bearerIdentity();await bearers.account({userId:member.userId!,email:member.email!,emailVerified:true});
 const db=await getDb(),store=createOAuthStore(db);
 const refresh=await store.issueRefresh({clientId:'mxmx_test_collection_client',userId:member.userId!,resource:'http://localhost/api',scope:'artifacts',accessTokenId:member.id});
 const server=new Hono();bearerAdmission({env:{APP__PUBLIC_BASE_URL:'http://localhost'},tokens:bearers.reader}).mount(server);mountRoutes(server);
 const read=()=>server.request(`/api/groups/${group.id}/collection`,{headers:{authorization:`Bearer ${member.token}`}});
 expect((await read()).status).toBe(200);
 await db.query("UPDATE auth.tokens SET scope='other' WHERE id=$1",[member.id]);expect((await read()).status).toBe(401);
 await db.query("UPDATE auth.tokens SET scope='artifacts',audience='http://foreign.example/api' WHERE id=$1",[member.id]);expect((await read()).status).toBe(401);
 await db.query("UPDATE auth.tokens SET audience='http://localhost/api' WHERE id=$1",[member.id]);expect((await read()).status).toBe(200);
 await store.revokeRefresh(refresh,'mxmx_test_collection_client');expect((await read()).status).toBe(401);
});
