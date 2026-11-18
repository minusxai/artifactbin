/**
 * APPROVED QUERIES ON THE DEFAULT CONNECTION (lib/query-approvals, the page SQL door's ./approved-queries), end to end
 * on the composed host: a page owned by a group declares a query on a `default:` link; by default it runs as each
 * reader, so a reader without access to the data is refused with a message naming whom to ask. An Admin of the group
 * approves exactly that query (its text, connection and allowed parameters): it then runs as the group's agent at member
 * level for every signed-in account that can open the page, until it is edited, revoked, the page moves, the approver is no longer Admin or
 * the group is deleted, each of which ends it for good. The setting and the database are ./query-approvals-fixture's.
 */
import {expect,it} from 'vitest';
import {createGroup,deleteGroup,recordGroupChanges,setGroupMember,setGroupParent,updateGroup} from '@/lib/groups';
import {services} from '@/lib/platform';
import {approvePageQuery} from '@/lib/query-approvals';
import {admitGroupMember,request,params} from './harness';
import {GET as listRoute,POST as approveRoute} from '@/app/api/artifacts/[id]/query-approvals/route';
import {GET as sharingRoute} from '@/app/api/my/artifacts/[id]/sharing/route';
import {DELETE as revokeRoute} from '@/app/api/artifacts/[id]/query-approvals/[approvalId]/route';
import {composed,origin,sql} from './group-principal-fixture';
import {SENSITIVE,TOTALS,asGroup,html,refusedNamingOwner,rows,setting,useApprovalsHost} from './query-approvals-fixture';
useApprovalsHost();

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
  statement:'Everyone signed in with their own account who can open this page, including people who later join a group that can open it, will see what totals returns as Team sees it. '+
   'They may choose region (one of EU, US); any other value is refused. While it is approved, only an Admin of Team may change this page\'s sharing. '+
   'Editing the query, its connection or what readers may vary ends the approval.'}]});
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

it('indexes a page\'s approvals by page for the export revision read, beside the live-approval unique index',async()=>{
 await composed();
 const defs=(await sql<{indexdef:string}>("SELECT indexdef FROM pg_indexes WHERE tablename='page_query_approvals'")).map(row=>row.indexdef);
 expect(defs.some(def=>/\(page_id\)\s*$/.test(def)&&!/UNIQUE|WHERE/i.test(def)),defs.join('\n')).toBe(true);
 expect(defs.some(def=>/UNIQUE/.test(def)&&/WHERE/.test(def))).toBe(true);
});

it('ends an approval found stale during a group change as no person\'s doing, and looks only at the groups that change can affect',async()=>{
 const host=await composed(),{ada,rob,team,page,approve}=await setting(host);
 const first=await approve(rob);
 expect(first.status).toBe(201);
 // Rob's Admin on Team is taken away outside the app: nothing notices until something asks.
 await sql("UPDATE auth.group_members SET role='member' WHERE group_id=$1 AND user_id=$2",[team.id,rob.userId]);
 const live=async(id:string)=>(await sql<{ended_at:string|null}>('SELECT ended_at FROM page_query_approvals WHERE id=$1',[id]))[0]!.ended_at;
 // A change to an unrelated group (a new root group, a sibling of nothing in Team's tree) does not even look at it.
 await createGroup(ada.userId,{handle:'elsewhere',name:'Elsewhere'});
 expect(await live(String(first.body!.id))).toBeNull();
 // A change inside Team's tree that did not cause it (a rename) finds it: ended, and no person did it.
 await updateGroup(ada.userId,team.id,{name:'Team renamed'});
 expect(await sql('SELECT ended_reason,ended_by FROM page_query_approvals WHERE id=$1',[String(first.body!.id)])).toEqual([{ended_reason:'approver_not_admin',ended_by:null}]);
 await expect.poll(async()=>sql("SELECT subject_kind,subject_id,payload FROM events.events WHERE verb='query_approval_ended' AND object_id=$1",[page])).toEqual([{subject_kind:null,subject_id:null,
  payload:{approval_id:first.body!.id,query:'totals',query_hash:first.body!.hash,connection:'default:',group_id:team.id,reason:'approver_not_admin',system:true}}]);
});

it('tells the sharing dialog whether the viewer may approve the page\'s queries: only an Admin of the owning group, never for a person\'s page',async()=>{
 const host=await composed(),{ada,rob,eve,page}=await setting(host);
 const personal=String((await host.call('POST','/api/artifacts',ada.token,{title:'Mine',html:html(),destination:{type:'personal'},visibility:'private'})).body!.id);
 const state=async(who:{userId:string},id:string)=>{
  const email=String((await sql<{email:string}>('SELECT email FROM users WHERE id=$1',[who.userId]))[0]!.email);
  const actor={credential:'session' as const,userId:who.userId,email,emailVerified:true};
  const answer=await sharingRoute(request(`/api/my/artifacts/${id}/sharing`,{actor}),params(id));
  return {status:answer.status,body:await answer.json() as Record<string,unknown>};
 };
 expect((await state(rob,page)).body).toMatchObject({canApproveQueries:true});
 expect((await state(ada,page)).body).toMatchObject({canApproveQueries:true});
 const editor=await state(eve,page);
 expect([editor.status,editor.body.canApproveQueries]).toEqual([200,false]);
 const mine=await state(ada,personal);
 expect([mine.status,mine.body.canApproveQueries]).toEqual([200,false]);
});

it('names the person who moves a group out from under its approver\'s Admin, whose ending it caused',async()=>{
 const host=await composed(),{ada,rob,root,team,approve}=await setting(host);
 // Rob is Admin of Team only through Root.
 await setGroupMember(ada.userId,team.id,rob.userId,'member');
 await admitGroupMember(ada.userId,root.id,rob.userId,'admin');
 const first=await approve(rob);
 expect(first.status,JSON.stringify(first.body)).toBe(201);
 await setGroupParent(ada.userId,team.id,null,root.id);
 expect(await sql('SELECT ended_reason,ended_by FROM page_query_approvals WHERE id=$1',[String(first.body!.id)])).toEqual([{ended_reason:'approver_not_admin',ended_by:ada.userId}]);
});
