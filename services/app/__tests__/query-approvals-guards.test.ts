/**
 * WHAT AN APPROVED QUERY NEVER REACHES BEYOND (lib/query-approvals): the audience the Admin approved it for. While one
 * is live only an Admin of the owning group changes who can open the page, by any door; new people brought into a group
 * that reads the page by someone who is not that Admin end it; only a signed-in ordinary account that can open the page
 * reads as the group, and only it is told the owner's name; a stored export image never outlives the approval; a
 * deleted page's approvals never come back, nor does an approval whose approver's Admin membership was taken away and
 * given back. The setting and the database are ./query-approvals-fixture's.
 */
import {expect,it} from 'vitest';
import sharp from 'sharp';
import type {RenderRequest} from '@artifactbin/contracts';
import {identityForUser} from '@/lib/accounts';
import {getArtifactById} from '@/lib/artifacts';
import {exportImageResponse,resetExportRenderer} from '@/lib/export';
import {readHtmlPage} from '@/lib/html-publication';
import {pageDeclaredConnectionSql,namingOwner} from '@/lib/page-doors';
import {setServices} from '@/lib/platform';
import {createGroup,setGroupParent} from '@/lib/groups';
import {createGuestOwner,admitGroupMember} from './harness';
import {composed,origin,sql} from './group-principal-fixture';
import {NAMELESS,asGroup,html,refusedNamingOwner,rows,setting,useApprovalsHost} from './query-approvals-fixture';
useApprovalsHost();

const LIVE=/approved query.*Admin of Team/;
/** The refusal every door answers a non-Admin's change of who can open a page with a live approval. */
const refusedLive=(reply:{status:number;body:Record<string,unknown>|null})=>{
 expect([reply.status,reply.body?.error],JSON.stringify(reply.body)).toEqual([403,'approved_query_live']);
 expect(String(reply.body?.message)).toMatch(LIVE);
};

it('lets only an Admin of the owning group change who can open a page while an approved query is live, by every door',async()=>{
 const host=await composed(),{ada,eve,olga,team,page,read,approve}=await setting(host);
 const approved=await approve(ada);
 expect(approved.status).toBe(201);
 const head=async()=>(await host.call('GET',`/api/artifacts/${page}`,ada.token)).body!;
 const patch=async(who:{token:string},body:Record<string,unknown>,key?:string)=>{
  const current=await head();
  const response=await host.fetch(new Request(`${origin}/api/artifacts/${page}`,{method:'PATCH',headers:{authorization:`Bearer ${who.token}`,'content-type':'application/json',...(key?{'idempotency-key':key}:{})},
   body:JSON.stringify({expectedVersion:current.version,expectedState:current.state,...body})}));
  return {status:response.status,body:await response.json().catch(()=>null) as Record<string,unknown>|null};
 };
 // Eve, an Editor, may not widen it: not by metadata, not with a receipt, not by republishing, not in the dialog.
 refusedLive(await patch(eve,{visibility:'unlisted'}));
 refusedLive(await patch(eve,{linkRole:'commenter',visibility:'public'}));
 refusedLive(await patch(eve,{shares:[{email:'mxmx_test_qa_olga@example.test',role:'viewer'},{email:'mxmx_test_qa_new@example.test',role:'viewer'}]}));
 refusedLive(await patch(eve,{visibility:'unlisted'},'approved-query-live-0001'));
 const current=await head();
 refusedLive(await host.call('PUT',`/api/artifacts/${page}`,eve.token,{html:html(),expectedVersion:current.version,expectedState:current.state,visibility:'unlisted'}));
 // With a receipt (update_artifact's durable path): a terminal refusal, replayed as it was.
 const receipted=async()=>{const response=await host.fetch(new Request(`${origin}/api/artifacts/${page}`,{method:'PUT',headers:{authorization:`Bearer ${eve.token}`,'content-type':'application/json','idempotency-key':'approved-query-live-0002'},
  body:JSON.stringify({html:html(),expectedVersion:current.version,expectedState:current.state,visibility:'unlisted'})}));return {status:response.status,body:await response.json().catch(()=>null) as Record<string,unknown>|null};};
 refusedLive(await receipted());
 refusedLive(await receipted());
 const dialog=await host.fetch(new Request(`${origin}/api/my/artifacts/${page}/sharing`,{method:'PUT',headers:{cookie:eve.cookie,origin,'content-type':'application/json'},body:JSON.stringify({visibility:'unlisted'})}));
 refusedLive({status:dialog.status,body:await dialog.json() as Record<string,unknown>});
 // Nor an agent signed in as the group at editor level.
 const agent=await eve.asGroup(team.id,'editor');
 refusedLive(await host.call('PUT',`/api/artifacts/${page}`,agent.token,{html:html(),expectedVersion:current.version,expectedState:current.state,visibility:'unlisted'}));
 // Nor an invitation that gives a person access.
 const nia=await host.signIn('mxmx_test_qa_nia@example.test');
 const username=(await sql<{username:string}>('SELECT username FROM users WHERE id=$1',[nia.userId]))[0]!.username;
 refusedLive(await host.call('POST',`/api/artifacts/${page}/members`,eve.token,{action:'invite',usernames:[`@${username}`],includeAccess:true}));
 // Nothing changed, and Eve's changes to anything else still go through.
 expect(await sql('SELECT visibility,link_role FROM artifacts WHERE id=$1',[page])).toEqual([{visibility:'private',link_role:null}]);
 expect(await sql('SELECT email FROM artifact_shares WHERE artifact_id=$1',[page])).toEqual([{email:'mxmx_test_qa_olga@example.test'}]);
 expect((await patch(eve,{title:'Sales, renamed',visibility:'private'})).status).toBe(200);
 expect((await read(olga)).status).toBe(200);
 // An Admin of the group may.
 expect((await patch(ada,{visibility:'unlisted'})).status).toBe(200);
 expect(rows(await read(olga))).toEqual([{region:'EU',total:15,...asGroup(team.id)}]);
 // Revoked, the page is as any other: Eve changes its audience again.
 expect((await host.call('DELETE',`/api/artifacts/${page}/query-approvals/${String(approved.body!.id)}`,ada.token)).status).toBe(200);
 expect((await patch(eve,{visibility:'private'})).status).toBe(200);
});

it('ends the approval when someone who is not an Admin of the owning group brings new people into a group that reads the page, and keeps it when that Admin does',async()=>{
 const host=await composed(),{ada,mia,olga,team,squad,page,read,approve}=await setting(host);
 // Mia administers Squad, Team's subgroup, and nothing above it.
 await admitGroupMember(ada.userId,squad.id,mia.userId,'admin');
 const first=await approve(ada);
 expect(first.status).toBe(201);
 // Ada, an Admin of Team, brings Pia into Team: the approval holds.
 const pia=await host.signIn('mxmx_test_qa_pia@example.test');
 await admitGroupMember(ada.userId,team.id,pia.userId,'member');
 expect(rows(await read(pia))).toEqual([{region:'EU',total:15,...asGroup(team.id)}]);
 // Mia creating an empty group under Squad brings nobody new: it holds.
 await createGroup(mia.userId,{handle:'qa_empty',name:'Empty',parent_id:squad.id});
 expect((await read(olga)).status).toBe(200);
 // Mia puts her own group, with its member, under Squad: the approval ends, audited as hers.
 const mine=await createGroup(mia.userId,{handle:'qa_mine',name:'Mine'});
 const kim=await host.signIn('mxmx_test_qa_kim@example.test');
 await admitGroupMember(mia.userId,mine.id,kim.userId,'member');
 expect((await read(olga)).status).toBe(200);
 await setGroupParent(mia.userId,mine.id,squad.id);
 refusedNamingOwner(await read(olga));
 expect(await sql('SELECT ended_reason,ended_by FROM page_query_approvals WHERE id=$1',[String(first.body!.id)])).toEqual([{ended_reason:'audience_changed',ended_by:mia.userId}]);
 // Mia brings Nia into Squad, whose members read Team's pages: a fresh approval ends too, and nobody reads as Team.
 const second=await approve(ada);
 expect((await read(olga)).status).toBe(200);
 const nia=await host.signIn('mxmx_test_qa_nia@example.test');
 await admitGroupMember(mia.userId,squad.id,nia.userId,'member');
 expect((await read(nia)).status).toBe(403);
 refusedNamingOwner(await read(olga));
 expect(await sql('SELECT ended_reason,ended_by FROM page_query_approvals WHERE id=$1',[String(second.body!.id)])).toEqual([{ended_reason:'audience_changed',ended_by:nia.userId}]);
 await expect.poll(async()=>sql("SELECT payload->>'reason' AS reason,subject_id FROM events.events WHERE verb='query_approval_ended' AND object_id=$1 ORDER BY subject_id",[page]))
  .toEqual([{reason:'audience_changed',subject_id:mia.userId},{reason:'audience_changed',subject_id:nia.userId}].sort((a,b)=>a.subject_id<b.subject_id?-1:1));
});

it('runs an approved query as the group only for a signed-in ordinary account that can open the page, and names the owner only to one',async()=>{
 const host=await composed(),{ada,olga,team,page,read,approve}=await setting(host);
 expect((await approve(ada)).status).toBe(201);
 const head=(await host.call('GET',`/api/artifacts/${page}`,ada.token)).body!;
 expect((await host.call('PATCH',`/api/artifacts/${page}`,ada.token,{expectedVersion:head.version,expectedState:head.state,visibility:'unlisted'})).status).toBe(200);
 // Olga, an account the page is shared with, reads as the group.
 expect(rows(await read(olga))).toEqual([{region:'EU',total:15,...asGroup(team.id)}]);
 // A test user and a guest holding the link read as themselves: refused, and not told whose page it is.
 const minted=await host.call('POST','/api/testusers',olga.token);
 expect(minted.status,JSON.stringify(minted.body)).toBe(201);
 const guest=await createGuestOwner();
 const admission={step:<T,>(pending:Promise<T>)=>pending,dispatch:()=>new AbortController().signal};
 for(const actor of [identityForUser(String(minted.body!.userId),String(minted.body!.tokenId)),identityForUser(guest.userId,guest.tokenId)]){
  const version=await readHtmlPage(actor,page);
  const reply=await pageDeclaredConnectionSql(actor,version,version,{query:'totals',params:{region:'EU'}},new AbortController().signal,admission);
  expect([reply?.status,reply?.body.error],JSON.stringify(reply?.body)).toEqual([403,'permission_denied']);
  expect((await namingOwner(reply!,{group_id:team.id},actor)).body.notice).toBe(NAMELESS);
 }
 // Nobody signed in is asked to sign in, as ever.
 const anonymous=await host.fetch(new Request(`${origin}/api/artifacts/${page}/sql`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({query:'totals',params:{region:'EU'},revision:String(head.version)})}));
 expect((await anonymous.json() as {error:string}).error).toBe('sign_in_required');
});

it('refuses a value outside the approval by saying so, to a reader with access of their own too',async()=>{
 const host=await composed(),{ada,mia,olga,read,approve}=await setting(host);
 expect((await approve(ada)).status).toBe(201);
 for(const who of [mia,olga]){
  const refused=await read(who,{region:'APAC'});
  expect([refused.status,refused.body?.error,refused.body?.notice]).toEqual([403,'permission_denied','That value of region is not allowed for this query.']);
 }
});

it('keeps no stored export image of the group\'s data once the approval stops holding',async()=>{
 const host=await composed(),{ada,olga,team,page,approve}=await setting(host);
 const images=[await sharp({create:{width:1,height:1,channels:3,background:'#000'}}).png().toBuffer(),await sharp({create:{width:2,height:1,channels:3,background:'#fff'}}).png().toBuffer()];
 // What the browser photographs: the group's numbers while approved, then what Olga herself may see.
 const renders:RenderRequest[]=[];let showing=images[0]!;
 setServices({browser:{render:async request=>{renders.push(request);return {ok:true,mime:'image/png',bytes:showing};}}});
 try{
  const approved=await approve(ada);
  expect(approved.status).toBe(201);
  const reader={userId:olga.userId,tokenId:null,email:'mxmx_test_qa_olga@example.test',documentEditor:false};
  const shot=async(mode?:string)=>Buffer.from(await (await exportImageResponse((await getArtifactById(page))!,{reader,...(mode?{mode}:{})},origin)).arrayBuffer());
  expect(await shot()).toEqual(images[0]);
  expect(await shot('card')).toEqual(images[0]);
  const before=renders.length;
  expect(await shot()).toEqual(images[0]);
  expect(renders.length).toBe(before);
  // Revoked: the next image is a new render, never the stored one, for the whole page and for its card alike.
  expect((await host.call('DELETE',`/api/artifacts/${page}/query-approvals/${String(approved.body!.id)}`,ada.token)).status).toBe(200);
  showing=images[1]!;
  expect(await shot()).toEqual(images[1]);
  expect(await shot('card')).toEqual(images[1]);
  expect(team.id).toBeTruthy();
 }finally{await resetExportRenderer();setServices({browser:undefined});}
});

it('ends a deleted page\'s approvals for good: restoring it brings none back',async()=>{
 const host=await composed(),{ada,olga,page,read,approve}=await setting(host);
 const approved=await approve(ada);
 expect((await read(olga)).status).toBe(200);
 expect((await host.call('DELETE',`/api/artifacts/${page}`,ada.token)).status).toBe(200);
 expect((await host.call('POST',`/api/artifacts/${page}/restore`,ada.token,{})).status).toBe(200);
 refusedNamingOwner(await read(olga));
 expect(await sql('SELECT ended_reason,ended_by FROM page_query_approvals WHERE id=$1',[String(approved.body!.id)])).toEqual([{ended_reason:'deleted',ended_by:ada.userId}]);
});

it('never revives an approval whose approver\'s Admin membership was taken away and given back in the identity tables with no read between',async()=>{
 const host=await composed(),{rob,olga,team,page,read,approve}=await setting(host);
 const byRob=await approve(rob);
 expect((await read(olga)).status).toBe(200);
 await sql('DELETE FROM auth.group_members WHERE group_id=$1 AND user_id=$2',[team.id,rob.userId]);
 await sql("INSERT INTO auth.group_members(group_id,user_id,role) VALUES($1,$2,'admin')",[team.id,rob.userId]);
 refusedNamingOwner(await read(olga));
 expect(await sql('SELECT ended_reason FROM page_query_approvals WHERE id=$1',[String(byRob.body!.id)])).toEqual([{ended_reason:'approver_not_admin'}]);
 expect(page).toBeTruthy();
});

it('never revives an approval whose group was deleted and put back with the same members in the identity tables with no read between',async()=>{
 const host=await composed(),{ada,olga,team,page,read,approve}=await setting(host);
 // The group deleted as the identity module deletes one (its members' rows go), then put back with the same members.
 const byAda=await approve(ada);
 expect((await read(olga)).status).toBe(200);
 const members=await sql<{user_id:string;role:string}>('SELECT user_id,role FROM auth.group_members WHERE group_id=$1',[team.id]);
 await sql('UPDATE auth.groups SET deleted_at=now() WHERE id=$1',[team.id]);
 await sql('DELETE FROM auth.group_members WHERE group_id=$1',[team.id]);
 await sql('UPDATE auth.groups SET deleted_at=NULL WHERE id=$1',[team.id]);
 for(const member of members)await sql('INSERT INTO auth.group_members(group_id,user_id,role) VALUES($1,$2,$3)',[team.id,member.user_id,member.role]);
 refusedNamingOwner(await read(olga));
 expect(await sql('SELECT ended_at IS NOT NULL AS ended FROM page_query_approvals WHERE id=$1',[String(byAda.body!.id)])).toEqual([{ended:true}]);
 expect(page).toBeTruthy();
});

it('answers a repeated approval of the same query by the same Admin with the approval already live',async()=>{
 const host=await composed(),{ada,rob,page,approve}=await setting(host);
 const first=await approve(ada),again=await approve(ada);
 expect([first.status,again.status]).toEqual([201,201]);
 expect(again.body!.id).toBe(first.body!.id);
 // Another Admin's approval replaces it, so it lasts as long as theirs.
 const byRob=await approve(rob);
 expect(byRob.body!.id).not.toBe(first.body!.id);
 expect(await sql('SELECT ended_reason FROM page_query_approvals WHERE id=$1',[String(first.body!.id)])).toEqual([{ended_reason:'replaced'}]);
 expect(page).toBeTruthy();
});
