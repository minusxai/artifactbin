/**
 * APPROVED QUERIES ON THE DEFAULT CONNECTION (lib/query-approvals, the page SQL door's ./approved-queries), end to end
 * on the composed host: a page owned by a group declares a query on a `default:` link; by default it runs as each
 * reader, so a reader without access to the data is refused with a message naming whom to ask. An Admin of the group
 * approves exactly that query (its text, connection and allowed parameters): it then runs as the group's agent at member
 * level for every reader of the page, until it is edited, revoked, the page moves, the approver is no longer Admin or
 * the group is deleted, each of which ends it for good. The database is a real Postgres engine on a loopback socket (test-support pglite-wire) whose
 * guarded view refuses (42501) any reader whose groups are not allowed, and shows the reader values it was sent.
 */
import {afterAll,beforeAll,beforeEach,expect,it} from 'vitest';
import {startPgliteWire,type PgliteWire} from '@artifactbin/test-support/pglite-wire';
import {closeDefaultConnection} from '@/lib/connections';
import {overrideConfig} from '@/lib/platform/config';
import {deleteGroup,recordGroupChanges,setGroupMember} from '@/lib/groups';
import {services} from '@/lib/platform';
import {approvePageQuery} from '@/lib/query-approvals';
import {useAppHarness,admitGroupMember,request,params} from './harness';
import {GET as listRoute,POST as approveRoute} from '@/app/api/artifacts/[id]/query-approvals/route';
import {DELETE as revokeRoute} from '@/app/api/artifacts/[id]/query-approvals/[approvalId]/route';
import {SECRET,composed,origin,sql,useGroupPrincipalHost,world} from './group-principal-fixture';
useAppHarness();
useGroupPrincipalHost();
let wire:PgliteWire;
beforeAll(async()=>{wire=await startPgliteWire(`
  create schema sales; create table sales.orders(region text, amount int, secret text);
  insert into sales.orders values ('EU',10,'eu-margin'),('EU',5,'eu-margin-2'),('US',7,'us-margin');
  create table public.allowed_groups(id text primary key);
  create function sales.guarded() returns setof sales.orders language plpgsql stable as $$
  begin
    if not exists (select 1 from public.allowed_groups a where current_setting('app.viewer_groups', true) like '%"' || a.id || '"%') then
      raise exception 'sales are not shared with this reader' using errcode = 'insufficient_privilege';
    end if;
    return query select * from sales.orders;
  end $$;
  create view sales.visible as select * from sales.guarded();`);});
afterAll(async()=>{await closeDefaultConnection();await wire?.close();});
beforeEach(()=>{overrideConfig({internalServiceSecret:SECRET,publicBaseUrl:origin},{DATASETS__DEFAULT_CONNECTION:JSON.stringify({connector:'postgres',host:'127.0.0.1',port:wire.port,database:'postgres',user:'postgres',password:'x',tls:'disable'}),DATASETS__ALLOW_PRIVATE_NETWORK:'1'});});

/** What the database saw of the reader, beside the numbers: the session's values and the bound ones. */
const SEEN=`current_setting('app.viewer_id', true) as seen_id, current_setting('app.viewer_email', true) as seen_email, current_setting('app.viewer_groups', true) as seen_groups,
 current_setting('app.viewer_group_role', true) as seen_level, :viewer_id as bound_id, :viewer_email as bound_email, :viewer_groups as bound_groups, :viewer_group_role as bound_level`;
const TOTALS=`select region, sum(amount)::int as total, ${SEEN} from wh.sales.visible where region = :region group by region`;
const SENSITIVE=`select region, secret, ${SEEN} from wh.sales.visible where region = :region`;
const PARAMS='{"region":["EU","US"]}';
const html=(query=TOTALS,{params=PARAMS,href='default:',name='wh'}:{params?:string;href?:string;name?:string}={})=>`<!doctype html><html><head><link rel="af-dataset" data-af-name="${name}" href="${href}">
<script type="application/sql" data-af-query="totals" data-af-dataset="${name}" data-af-params='${params}'>${query}</script></head><body><h1>Sales</h1></body></html>`;

type Host=Awaited<ReturnType<typeof composed>>;
/** Root > Team: Ada created both (Admin), Rob is Team's Admin, Eve its Editor, Mia its Member; Olga is outside it. */
async function setting(host:Host){
 const {ada,eve,root,team,squad}=await world(host,false);
 const rob=await host.signIn('mxmx_test_qa_rob@example.test'),mia=await host.signIn('mxmx_test_qa_mia@example.test'),olga=await host.signIn('mxmx_test_qa_olga@example.test');
 await admitGroupMember(ada.userId,team.id,rob.userId,'admin');
 await admitGroupMember(ada.userId,team.id,mia.userId,'member');
 // The data is the team's: its members read it themselves; Olga has no access of her own.
 await wire.db.query('delete from public.allowed_groups');
 await wire.db.query('insert into public.allowed_groups values ($1)',[team.id]);
 const made=await host.call('POST','/api/artifacts',ada.token,{title:'Sales',html:html(),destination:{type:'group',id:team.id},visibility:'private',shares:[{email:'mxmx_test_qa_olga@example.test',role:'viewer'}]});
 expect(made.status,JSON.stringify(made.body)).toBe(201);
 const page=String(made.body!.id);
 /** A reader runs the declared query `totals` (of `revision`, default the head), as the page's chart would. */
 const read=async(who:{token:string},params:Record<string,unknown>={region:'EU'},extra:Record<string,unknown>={})=>{
  const revision=extra.revision??String((await host.call('GET',`/api/artifacts/${page}`,ada.token)).body!.version);
  return host.call('POST',`/api/artifacts/${page}/sql`,who.token,{query:'totals',params,...extra,revision});
 };
 const approvals=(who:{token:string})=>host.call('GET',`/api/artifacts/${page}/query-approvals`,who.token);
 const approve=async(who:{token:string},hash?:string)=>host.call('POST',`/api/artifacts/${page}/query-approvals`,who.token,{query:'totals',hash:hash??((await approvals(ada)).body!.queries as Array<{hash:string}>)[0]!.hash});
 const edit=async(who:{token:string},next:string)=>{
  const current=await host.call('GET',`/api/artifacts/${page}`,who.token);
  const saved=await host.call('PUT',`/api/artifacts/${page}`,who.token,{html:next,expectedVersion:current.body?.version,expectedState:current.body?.state});
  expect(saved.status,JSON.stringify(saved.body)).toBe(200);
 };
 return {ada,eve,rob,mia,olga,root,team,squad,page,read,approvals,approve,edit};
}
const NOTICE="You don't have access to this data. Ask Team, who owns this page, for access.";
const refusedNamingOwner=(reply:{status:number;body:Record<string,unknown>|null})=>expect([reply.status,reply.body?.error,reply.body?.notice],JSON.stringify(reply.body)).toEqual([403,'permission_denied',NOTICE]);
const rows=(reply:{status:number;body:Record<string,unknown>|null})=>{expect(reply.status,JSON.stringify(reply.body)).toBe(200);return reply.body!.rows as Array<Record<string,unknown>>;};
const asGroup=(team:string)=>({seen_id:'',seen_email:'',seen_groups:JSON.stringify([team]),seen_level:'member',bound_id:null,bound_email:null,bound_groups:JSON.stringify([team]),bound_level:'member'});

it('runs a declared query as each reader until an Admin approves it; then as the group at member level, with exactly those values on the wire',async()=>{
 const host=await composed(),{ada,eve,mia,olga,team,page,read,approvals,approve}=await setting(host);
 // Before any approval: Olga is refused, told plainly whom to ask; Mia reads as herself.
 refusedNamingOwner(await read(olga));
 expect(rows(await read(mia))).toEqual([{region:'EU',total:15,seen_id:mia.userId,seen_email:'mxmx_test_qa_mia@example.test',seen_groups:JSON.stringify([team.id]),seen_level:'',
  bound_id:mia.userId,bound_email:'mxmx_test_qa_mia@example.test',bound_groups:JSON.stringify([team.id]),bound_level:''}]);
 // An Admin sees the query, what approving it means, and that it is not approved.
 const listed=await approvals(ada);
 expect(listed.status,JSON.stringify(listed.body)).toBe(200);
 expect(listed.body).toEqual({group:{id:team.id,name:'Team'},queries:[{name:'totals',connection:'default:',sql:TOTALS,params:{region:{values:['EU','US']}},hash:expect.stringMatching(/^[0-9a-f]{64}$/),approval:null,
  statement:'Everyone who can open this page will see what totals returns when Team reads it as a member, whatever their own access to this data. They may choose region (one of EU, US); any other value is refused. Changing its text, its connection or what readers may vary ends the approval.'}]});
 // An Editor of the group may neither see nor approve it.
 expect((await approvals(eve)).status).toBe(403);
 expect(await approve(eve)).toMatchObject({status:403,body:{error:'forbidden'}});
 expect(await approve(olga)).toMatchObject({status:404});
 const approved=await approve(ada);
 expect(approved.status,JSON.stringify(approved.body)).toBe(201);
 // Olga reads the numbers as the group: no person, exactly the group, member level (the session's and the bound values).
 expect(rows(await read(olga))).toEqual([{region:'EU',total:15,...asGroup(team.id)}]);
 expect(rows(await read(olga,{region:'US'}))).toEqual([{region:'US',total:7,...asGroup(team.id)}]);
 // Mia, who has her own access, still reads.
 expect(rows(await read(mia))).toEqual([{region:'EU',total:15,...asGroup(team.id)}]);
 // Each read as the group is recorded naming the real reader and the approval, never the reader's values.
 await expect.poll(async()=>sql("SELECT subject_kind,subject_id,payload FROM events.events WHERE verb='approved_query_read' AND object_id=$1 ORDER BY subject_id",[page])).toEqual([olga,olga,mia].sort((a,b)=>a.userId<b.userId?-1:1).map(who=>({subject_kind:'user',subject_id:who.userId,
  payload:{approval_id:approved.body!.id,query:'totals',query_hash:approved.body!.hash,connection:'default:',group_id:team.id}})));
 expect(((await approvals(ada)).body!.queries as Array<{approval:unknown}>)[0]!.approval).toEqual({id:approved.body!.id,approved_by:{id:ada.userId,name:null,username:expect.any(String)},approved_at:expect.any(String)});
 // Audited: who, the page, the query's hash, the connection and the group; the event's time is when.
 await expect.poll(async()=>sql("SELECT subject_id,verb,object_id,payload FROM events.events WHERE verb='query_approved' AND object_id=$1",[page])).toEqual([{subject_id:ada.userId,verb:'query_approved',object_id:page,
  payload:{approval_id:approved.body!.id,query:'totals',query_hash:approved.body!.hash,connection:'default:',group_id:team.id}}]);
 // A copy of the page carries the query, never its approval.
 const fork=await host.call('POST',`/api/artifacts/${page}/fork`,mia.token,{});
 expect(fork.status,JSON.stringify(fork.body)).toBe(201);
 expect(await sql('SELECT count(*)::int AS n FROM page_query_approvals WHERE page_id=$1',[String(fork.body!.id)])).toEqual([{n:0}]);
});

it('ends the approval when the approved query is edited to select a more sensitive column: the outside reader is refused until an Admin approves the new text',async()=>{
 const host=await composed(),{ada,eve,mia,olga,team,page,read,approvals,approve,edit}=await setting(host);
 const first=await approve(ada);
 expect(first.status).toBe(201);
 expect(rows(await read(olga))).toEqual([{region:'EU',total:15,...asGroup(team.id)}]);
 const approvedAt=String((await host.call('GET',`/api/artifacts/${page}`,ada.token)).body!.version);
 // Eve, an Editor, rewrites the query to select the margins.
 await edit(eve,html(SENSITIVE));
 refusedNamingOwner(await read(olga));
 // Nor does the old version, which still declares the approved text, run as the group any more.
 refusedNamingOwner(await read(olga,{region:'EU'},{revision:approvedAt}));
 // Mia, with her own access, is unaffected: she reads the new column as herself.
 expect(rows(await read(mia)).map(row=>[row.secret,row.seen_id])).toEqual([['eu-margin',mia.userId],['eu-margin-2',mia.userId]]);
 // The listing shows it unapproved, and the hash Ada was shown before is refused: she must look at the new text.
 const now=((await approvals(ada)).body!.queries as Array<{hash:string;sql:string;approval:unknown}>)[0]!;
 expect(now).toMatchObject({sql:SENSITIVE,approval:null});
 expect(await approve(ada,String(first.body!.hash))).toMatchObject({status:409,body:{error:'query_changed'}});
 // Putting the old text back, by an edit or by reverting to the approved version, does not bring the approval back.
 await edit(eve,html());
 refusedNamingOwner(await read(olga));
 const head=await host.call('GET',`/api/artifacts/${page}`,eve.token);
 const reverted=await host.call('POST',`/api/artifacts/${page}/revert`,eve.token,{version:Number(approvedAt),expectedVersion:head.body?.version,expectedState:head.body?.state});
 expect(reverted.status,JSON.stringify(reverted.body)).toBe(200);
 refusedNamingOwner(await read(olga));
 await edit(eve,html(SENSITIVE));
 // Ada approves the new text: Olga then reads it as the group.
 expect((await approve(ada,now.hash)).status).toBe(201);
 expect(rows(await read(olga)).map(row=>[row.secret,row.seen_id,row.seen_groups])).toEqual([['eu-margin','',JSON.stringify([team.id])],['eu-margin-2','',JSON.stringify([team.id])]]);
 await expect.poll(async()=>sql("SELECT subject_id,payload->>'reason' AS reason,payload->>'approval_id' AS id FROM events.events WHERE verb='query_approval_ended' AND object_id=$1",[page])).toEqual([{subject_id:eve.userId,reason:'edited',id:first.body!.id}]);
});

it('a change of connection, of the link\'s name or of what readers may vary ends it as an edit of the text does',async()=>{
 const host=await composed(),{ada,eve,olga,read,approvals,approve,edit}=await setting(host);
 for(const changed of [html(TOTALS,{href:'default:postgres'}),html(TOTALS,{params:'{"region":["EU","US","APAC"]}'}),html(TOTALS,{params:'{"region":"text"}'})]){
  expect((await approve(ada)).status).toBe(201);
  expect((await read(olga)).status).toBe(200);
  await edit(eve,changed);
  refusedNamingOwner(await read(olga));
  await edit(eve,html());
 }
 // Renaming the link changes which qualifiers the run removes, so it is a different statement: the approval ends.
 expect((await approve(ada)).status).toBe(201);
 await edit(eve,html(TOTALS,{name:'wh2'}));
 expect(((await approvals(ada)).body!.queries as Array<{approval:unknown}>)[0]!.approval).toBeNull();
 expect((await read(olga)).status).not.toBe(200);
});

it('refuses a parameter outside the approval instead of running it as the reader, and never runs the reader\'s own SQL as the group',async()=>{
 const host=await composed(),{ada,mia,olga,page,read,approve}=await setting(host);
 expect((await approve(ada)).status).toBe(201);
 for(const forged of [{region:'APAC'},{region:'EU',extra:'1'},{region:'EU',viewer_region:'x'},{region:7},{region:null},{region:['EU']}])
  expect([(await read(olga,forged)).status,(await read(olga,forged)).body?.error],JSON.stringify(forged)).toEqual([403,'permission_denied']);
 // Not for Mia either, though she has her own access: the approved query is what readers run.
 expect((await read(mia,{region:'APAC'})).status).toBe(403);
 // The server's reader values are never the reader's to send.
 expect((await read(olga,{region:'EU',viewer_group_role:'editor'})).status).toBe(400);
 expect((await read(olga,{region:'EU',viewer_groups:'["x"]'})).status).toBe(400);
 // A statement of Olga's own, even the approved text itself, runs as Olga: refused.
 const revision=String((await host.call('GET',`/api/artifacts/${page}`,ada.token)).body!.version);
 refusedNamingOwner(await host.call('POST',`/api/artifacts/${page}/sql`,olga.token,{sql:'select secret from wh.sales.visible',params:{},revision}));
 refusedNamingOwner(await host.call('POST',`/api/artifacts/${page}/sql`,olga.token,{sql:"select region, sum(amount)::int as total from wh.sales.visible where region = 'EU' group by region",params:{},revision}));
 // Naming the query and sending SQL too is refused before anything runs.
 expect((await read(olga,{region:'EU'},{sql:'select secret from wh.sales.visible'})).status).toBe(400);
 // Anonymous readers never reach the default connection.
 expect((await host.fetch(new Request(`${origin}/api/artifacts/${page}/sql`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({query:'totals',params:{region:'EU'},revision})}))).status).not.toBe(200);
});

it('ends at once when revoked, when the approver is no longer Admin, when the page moves to another owner and when the group is deleted',async()=>{
 const host=await composed(),{ada,rob,olga,root,team,page,read,approvals,approve}=await setting(host);
 // Revoked by an Admin: audited.
 const first=await approve(rob);
 expect(first.status).toBe(201);
 expect((await read(olga)).status).toBe(200);
 expect((await host.call('DELETE',`/api/artifacts/${page}/query-approvals/${String(first.body!.id)}`,ada.token))).toMatchObject({status:200,body:{ok:true}});
 refusedNamingOwner(await read(olga));
 expect((await host.call('DELETE',`/api/artifacts/${page}/query-approvals/${String(first.body!.id)}`,ada.token)).status).toBe(404);
 await expect.poll(async()=>sql("SELECT subject_id,payload->>'reason' AS reason,payload->>'query_hash' AS hash,payload->>'connection' AS connection FROM events.events WHERE verb='query_approval_ended' AND object_id=$1",[page]))
  .toEqual([{subject_id:ada.userId,reason:'revoked',hash:first.body!.hash,connection:'default:'}]);
 // Rob approves again, then is made a Member: his approval ends at once, audited as Ada's change.
 const second=await approve(rob);
 expect(second.status).toBe(201);
 expect((await read(olga)).status).toBe(200);
 await setGroupMember(ada.userId,team.id,rob.userId,'member');
 refusedNamingOwner(await read(olga));
 expect(((await approvals(ada)).body!.queries as Array<{approval:unknown}>)[0]!.approval).toBeNull();
 // Ended for good, not paused: made Admin again, his old approval stays ended until a fresh one.
 await setGroupMember(ada.userId,team.id,rob.userId,'admin');
 refusedNamingOwner(await read(olga));
 expect(((await approvals(ada)).body!.queries as Array<{approval:unknown}>)[0]!.approval).toBeNull();
 expect(await sql('SELECT ended_reason,ended_by FROM page_query_approvals WHERE id=$1',[String(second.body!.id)])).toEqual([{ended_reason:'approver_not_admin',ended_by:ada.userId}]);
 await setGroupMember(ada.userId,team.id,rob.userId,'member');
 // An Admin through an ancestor approves too.
 await admitGroupMember(ada.userId,root.id,rob.userId,'admin');
 const third=await approve(rob);
 expect(third.status).toBe(201);
 expect((await read(olga)).status).toBe(200);
 // His Admin taken away outside the app (the identity module's own rows): the next read finds the approval no longer
 // holding and ends it, so his Admin coming back the same way revives nothing.
 await sql("UPDATE auth.group_members SET role='member' WHERE group_id=$1 AND user_id=$2",[root.id,rob.userId]);
 refusedNamingOwner(await read(olga));
 await sql("UPDATE auth.group_members SET role='admin' WHERE group_id=$1 AND user_id=$2",[root.id,rob.userId]);
 refusedNamingOwner(await read(olga));
 expect(await sql('SELECT ended_reason,ended_by FROM page_query_approvals WHERE id=$1',[String(third.body!.id)])).toEqual([{ended_reason:'approver_not_admin',ended_by:null}]);
 // The page moves to Ada herself: it ends for good, and a person's page approves nothing.
 const fourth=await approve(rob);
 expect(fourth.status).toBe(201);
 expect((await read(olga)).status).toBe(200);
 expect((await host.call('POST',`/api/artifacts/${page}/transfer`,ada.token,{destination:{type:'personal'}})).status).toBe(200);
 expect((await read(olga)).status).toBe(403);
 expect(await sql('SELECT ended_reason FROM page_query_approvals WHERE id=$1',[String(fourth.body!.id)])).toEqual([{ended_reason:'moved'}]);
 expect(await approvals(ada)).toMatchObject({status:400,body:{error:'not_group_owned'}});
 expect((await host.call('POST',`/api/artifacts/${page}/transfer`,ada.token,{destination:{type:'group',id:team.id}})).status).toBe(200);
 refusedNamingOwner(await read(olga));
 // The group is deleted, as the identity module deletes one (the app's own door refuses a group that still owns pages)
 // and the app records it: the approval ends, audited as the deleter's.
 const fifth=await approve(rob);
 expect(fifth.status).toBe(201);
 expect((await read(olga)).status).toBe(200);
 const handleOf=async(id:string)=>String((await sql('SELECT handle FROM auth.groups WHERE id=$1',[id]))[0]!.handle);
 // Its subgroup first: a group with subgroups is never deleted.
 for(const child of await sql('SELECT id FROM auth.groups WHERE parent_id=$1 AND deleted_at IS NULL',[team.id]))await deleteGroup(ada.userId,String(child.id),await handleOf(String(child.id)));
 const handle=await handleOf(team.id);
 await recordGroupChanges((await services().identity.deleteGroup({actorId:ada.userId,groupId:team.id,handle})).changes);
 expect(await sql('SELECT ended_reason,ended_by FROM page_query_approvals WHERE id=$1',[String(fifth.body!.id)])).toEqual([{ended_reason:'group_deleted',ended_by:ada.userId}]);
 expect((await read(olga)).status).not.toBe(200);
});

it('a page owned by a person has no approved queries, and an agent signed in as the group never approves',async()=>{
 const host=await composed(),{ada,eve,team,page,approve}=await setting(host);
 const personal=String((await host.call('POST','/api/artifacts',ada.token,{title:'Mine',html:html(),destination:{type:'personal'},visibility:'private'})).body!.id);
 expect(await host.call('GET',`/api/artifacts/${personal}/query-approvals`,ada.token)).toMatchObject({status:400,body:{error:'not_group_owned'}});
 expect(await host.call('POST',`/api/artifacts/${personal}/query-approvals`,ada.token,{query:'totals',hash:'0'.repeat(64)})).toMatchObject({status:400,body:{error:'not_group_owned'}});
 expect((await host.call('GET',`/api/artifacts/${personal}/query-approvals`,eve.token)).status).toBe(404);
 // The group's agent, at either level, is refused at the app's edge and by the approval itself.
 for(const level of ['member','editor'] as const){
  const agent=await eve.asGroup(team.id,level);
  expect(await approve(agent)).toMatchObject({status:403,body:{error:'group_principal_refused'}});
  await expect(approvePageQuery({userId:null,tokenId:null,email:null,documentEditor:false,principalGroup:{id:team.id,role:level,issuedBy:eve.userId,tokenId:agent.tokenId}},page,{query:'totals',hash:'0'.repeat(64)})).rejects.toMatchObject({status:403,code:'forbidden'});
 }
 expect(await sql('SELECT count(*)::int AS n FROM page_query_approvals')).toEqual([{n:0}]);
});

it('serves the sharing dialog\'s browser session the same routes, and refuses a cross-site approval',async()=>{
 const host=await composed(),{ada,olga,page,read}=await setting(host);
 const actor={credential:'session' as const,userId:ada.userId,email:'mxmx_test_ga_ada@example.test',emailVerified:true};
 const path=`/api/artifacts/${page}/query-approvals`;
 const listed=await listRoute(request(path,{actor}),params(page));
 expect(listed.status).toBe(200);
 const hash=((await listed.json()) as {queries:Array<{hash:string}>}).queries[0]!.hash;
 expect((await approveRoute(request(path,{actor,method:'POST',origin:'https://other.test',json:{query:'totals',hash}}),params(page))).status).toBe(403);
 const approved=await approveRoute(request(path,{actor,method:'POST',origin:'same',json:{query:'totals',hash}}),params(page));
 expect(approved.status).toBe(201);
 expect((await read(olga)).status).toBe(200);
 const id=String(((await approved.json()) as {id:string}).id);
 expect((await revokeRoute(request(`${path}/${id}`,{actor,method:'DELETE',origin:'same'}),params({id:page,approvalId:id}))).status).toBe(200);
 expect((await read(olga)).status).toBe(403);
});
