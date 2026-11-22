/**
 * WHAT AN AGENT SIGNED IN AS A GROUP WRITES, and who the author is: at editor level it creates in its group only and
 * edits its group's pages (never personal, never another group, never named shares or placement), setting there exactly
 * the visibility, link role and dataset access its twin (a direct Editor) may; it comments where its role reaches, as
 * the group (shown under the group's name, as an agent), and edits only its own comments (the group's, at its level).
 */
import {GROUP_PRINCIPAL_REFUSED} from '@artifactbin/contracts/actor';
import {expect,it} from 'vitest';
import {admitGroupMember,useAppHarness} from './harness';
import {composed,page,sql,useGroupPrincipalHost,world} from './group-principal-fixture';
useAppHarness();
useGroupPrincipalHost();

it('at editor level creates in its group only and edits its group\'s pages; a member does neither',async()=>{
 const host=await composed(),{ada,eve,root,team,squad,pages}=await world(host);
 const editor=await eve.asGroup(team.id,'editor'),member=await eve.asGroup(team.id,'member');
 const narrowedOwner=await ada.asGroup(team.id,'editor');
 expect((await host.call('GET',`/api/artifacts/${pages.personal}`,ada.token)).status).toBe(200);
 expect((await host.call('GET',`/api/artifacts/${pages.personal}`,narrowedOwner.token)).status).toBe(404);
 const made=await host.call('POST','/api/artifacts',editor.token,{title:'By the agent',html:page('By the agent')});
 expect(made.status,JSON.stringify(made.body)).toBe(201);
 const id=String(made.body!.id);
 // Owned by the group, no person on it; the group recorded as the writer beside the sign-in's token.
 expect(await sql('SELECT group_id,user_id,creator_user_id,token_id,actor_user_id,actor_token_id,actor_group_id,visibility FROM artifacts WHERE id=$1',[id])).toEqual([{group_id:team.id,user_id:null,creator_user_id:null,token_id:editor.tokenId,actor_user_id:null,actor_token_id:editor.tokenId,actor_group_id:team.id,visibility:'private'}]);
 expect(await sql('SELECT actor_group_id,actor_token_id FROM artifact_edits WHERE artifact_id=$1',[id])).toEqual([{actor_group_id:team.id,actor_token_id:editor.tokenId}]);
 // Elsewhere: never personal, never another group, never a subgroup (Editor does not flow down).
 expect(await host.call('POST','/api/artifacts',editor.token,{title:'Mine',html:page('Mine'),destination:{type:'personal'}})).toMatchObject({status:403,body:{error:'group_principal_personal_refused'}});
 for(const group of [root.id,squad.id])expect((await host.call('POST','/api/artifacts',editor.token,{title:'Elsewhere',html:page('Elsewhere'),destination:{type:'group',id:group}})).status).toBe(403);
 // A member publishes nothing.
 expect((await host.call('POST','/api/artifacts',member.token,{title:'Member',html:page('Member')})).status).toBe(403);
 // Edits: Team's pages at editor level; never Root's, never a member's.
 const replace=async(token:string,target:string,title:string,extra:Record<string,unknown>={})=>{
  const current=await host.call('GET',`/api/artifacts/${target}`,token);
  return host.call('PUT',`/api/artifacts/${target}`,token,{html:page(title),expectedVersion:current.body?.version,expectedState:current.body?.state,...extra});
 };
 const edited=await replace(editor.token,pages.team,'Edited by the agent');
 expect(edited.status,JSON.stringify(edited.body)).toBe(200);
 expect(await sql('SELECT actor_user_id,actor_group_id FROM artifacts WHERE id=$1',[pages.team])).toEqual([{actor_user_id:null,actor_group_id:team.id}]);
 // The version it replaced keeps its own writer (Eve), and the edit log names the group.
 expect(await sql('SELECT actor_user_id,actor_group_id FROM artifact_versions WHERE artifact_id=$1 ORDER BY version',[pages.team])).toEqual([{actor_user_id:eve.userId,actor_group_id:null}]);
 // Its history reads as an editor's: the versions, and the one it replaced.
 const history=await host.call('GET',`/api/artifacts/${pages.team}/versions`,editor.token);
 expect(history.status,JSON.stringify(history.body)).toBe(200);
 expect((await host.call('GET',`/api/artifacts/${pages.team}/versions/1`,editor.token)).status).toBe(200);
 expect((await replace(editor.token,pages.root,'Not ours')).status).toBe(404);
 expect((await replace(member.token,pages.team,'Member edit')).status).toBe(404);
 // What its twin, a direct Editor, may set on a replace it sets too (visibility: the last test); named shares stay with people.
 expect(await replace(editor.token,pages.team,'Shared',{shares:[{email:'someone@example.test',role:'viewer'}]})).toMatchObject({status:403,body:{error:GROUP_PRINCIPAL_REFUSED}});
 // Owner and Admin acts are refused outright.
 for(const [method,path,body] of [['DELETE',`/api/artifacts/${pages.team}`,undefined],['PUT',`/api/artifacts/${pages.team}/group-shares/${root.id}`,{role:'viewer'}],['POST',`/api/artifacts/${pages.team}/transfer`,{}],['GET','/api/artifacts',undefined],['POST','/api/groups',{handle:'x',name:'x'}]] as const)
  expect(await host.call(method,path,editor.token,body),path).toMatchObject({status:403,body:{error:GROUP_PRINCIPAL_REFUSED}});
});

it('comments where its role reaches, as the group, and edits only the group\'s own comments',async()=>{
 const host=await composed(),{eve,team,pages}=await world(host);
 const member=await eve.asGroup(team.id,'member'),editor=await eve.asGroup(team.id,'editor');
 /** The paragraph's stable node id, as the page was saved (ids are the server's). */
 const anchorOf=async(target:string)=>{const row=(await sql<{source:string;version:number}>('SELECT source,version FROM artifacts WHERE id=$1',[target]))[0]!;return {kind:'html-node',v:1,revision:String(row.version),nodeId:row.source.match(/<p data-af-id="([^"]+)">Body of/)![1],quote:''};};
 const comment=async(token:string,target:string,body:string)=>host.call('POST',`/api/artifacts/${target}/annotations`,token,{body,anchor:await anchorOf(target)});
 // A share to Team as commenter, and a commenter link: a member comments. On Team's own page a member only reads.
 const made=await comment(member.token,pages.sharedTeam,'From the team agent');
 expect(made.status,JSON.stringify(made.body)).toBe(201);
 expect((await comment(member.token,pages.linkCommenter,'Via the link')).status).toBe(201);
 expect((await comment(member.token,pages.team,'A member on the page')).status).toBe(404);
 expect((await comment(editor.token,pages.team,'An editor on the page')).status).toBe(201);
 // Shown as an agent, under the group's name; stored with the group, the sign-in's token and no person.
 const listed=await host.call('GET',`/api/artifacts/${pages.sharedTeam}/annotations`,member.token);
 const author=(listed.body!.annotations as Array<{comments?:Array<{author:Record<string,unknown>}>;author?:Record<string,unknown>}>)[0]!;
 expect(JSON.stringify(author)).toContain('"label":"Team"');
 expect(JSON.stringify(author)).toContain('"kind":"agent"');
 expect(await sql("SELECT author_kind,author_user_id,author_token_id,author_group_id FROM annotations WHERE body='From the team agent'")).toEqual([{author_kind:'agent',author_user_id:null,author_token_id:member.tokenId,author_group_id:team.id}]);
 await expect.poll(async()=>sql("SELECT subject_kind,subject_id FROM events.events WHERE verb='annotated' AND object_id=$1",[pages.sharedTeam])).toEqual([{subject_kind:'group',subject_id:team.id}]);
 // It watches the comments it may observe, and the feed names the group as the actor.
 const feed=await host.call('GET',`/api/events?artifact_id=${pages.sharedTeam}&category=comments`,member.token);
 expect(feed.status,JSON.stringify(feed.body)).toBe(200);
 expect((feed.body!.events as Array<{actor:unknown}>).map(event=>event.actor)).toContainEqual({kind:'group',id:team.id,you:false});
 expect((await host.call('GET',`/api/events?artifact_id=${pages.personal}&category=comments`,member.token)).status).toBe(404);
 // The whole feed is what its twin observes: an unlisted page it holds only the viewer link to is not in it.
 const quiet=String((await host.call('POST','/api/artifacts',eve.token,{title:'Quiet',html:page('Quiet'),visibility:'unlisted',destination:{type:'personal'}})).body!.id);
 expect((await host.call('POST',`/api/artifacts/${quiet}/annotations`,eve.token,{body:'Eve alone',anchor:await anchorOf(quiet)})).status).toBe(201);
 const all=await host.call('GET','/api/events?category=comments',member.token);
 expect(all.status,JSON.stringify(all.body)).toBe(200);
 expect((all.body!.events as Array<{resource:{id:string}}>).map(event=>event.resource.id)).not.toContain(quiet);
 expect((all.body!.events as Array<{resource:{id:string}}>).map(event=>event.resource.id)).toContain(pages.sharedTeam);
 // Its own comment it edits: any sign-in of the group AT THE SAME LEVEL (its principal), never one at the other level.
 const ownId=String((made.body as {id?:string}).id ?? (made.body as {annotation?:{id:string}}).annotation?.id);
 const sibling=await eve.asGroup(team.id,'member');
 const edit=await host.call('PATCH',`/api/artifacts/${pages.sharedTeam}/annotations/${ownId}`,sibling.token,{body:'Edited by the team agent'});
 expect(edit.status,JSON.stringify(edit.body)).toBe(200);
 expect((await host.call('PATCH',`/api/artifacts/${pages.sharedTeam}/annotations/${ownId}`,editor.token,{body:'Not the editor\'s'})).status).toBe(404);
 const editors=await comment(editor.token,pages.sharedTeam,'From the team editor');
 expect(editors.status,JSON.stringify(editors.body)).toBe(201);
 const editorsId=String(editors.body!.id);
 expect((await host.call('PATCH',`/api/artifacts/${pages.sharedTeam}/annotations/${editorsId}`,member.token,{body:'Not the member\'s'})).status).toBe(404);
 expect((await host.call('PATCH',`/api/artifacts/${pages.sharedTeam}/annotations/${editorsId}`,editor.token,{body:'Edited by the team editor'})).status).toBe(200);
 expect(await sql("SELECT body,author_group_role FROM annotations WHERE id=ANY($1::text[]) ORDER BY body",[[ownId,editorsId]])).toEqual([
  {body:'Edited by the team agent',author_group_role:'member'},{body:'Edited by the team editor',author_group_role:'editor'}]);
 // A comment stored before its level was (no level on the row) is editable by no sign-in of the group, at either level.
 await sql('UPDATE annotations SET author_group_role=NULL WHERE id=$1',[editorsId]);
 for(const token of [editor.token,member.token])expect((await host.call('PATCH',`/api/artifacts/${pages.sharedTeam}/annotations/${editorsId}`,token,{body:'Unowned now'})).status).toBe(404);
 // A person's it does not.
 const eves=await host.call('POST',`/api/artifacts/${pages.sharedTeam}/annotations`,eve.token,{body:'Eve here',anchor:await anchorOf(pages.sharedTeam)});
 expect((await host.call('PATCH',`/api/artifacts/${pages.sharedTeam}/annotations/${String(eves.body!.id)}`,editor.token,{body:'Not yours'})).status).toBe(404);
});

it('sets at creation and on a replace exactly the visibility, link role and dataset access its twin may, at both levels',async()=>{
 const host=await composed(),{ada,eve,team}=await world(host,false);
 /** The twin: a person whose only relationship is a direct membership of Team at that level. */
 const twins={editor:await host.signIn('mxmx_test_ga_tim@example.test'),member:await host.signIn('mxmx_test_ga_mia@example.test')};
 await admitGroupMember(ada.userId,team.id,twins.editor.userId,'editor');
 await admitGroupMember(ada.userId,team.id,twins.member.userId,'member');
 const stored=async(id:string)=>(await sql<{visibility:string;link_role:string|null;access:string|null}>('SELECT visibility,link_role,access FROM artifacts WHERE id=$1',[id]))[0];
 const html=(title:string)=>({title,html:page(title)});
 const data=(title:string)=>({title,dataset:[{n:1}]});
 const CASES:Array<[string,(title:string)=>Record<string,unknown>,Record<string,unknown>]>=[
  ['public page',html,{visibility:'public'}],['unlisted page',html,{visibility:'unlisted'}],
  ['commenter link',html,{visibility:'unlisted',linkRole:'commenter'}],['editor link',html,{visibility:'unlisted',linkRole:'editor'}],
  ['read-write dataset',data,{access:'readwrite'}],['read-only dataset',data,{access:'read'}],
 ];
 const outcomes:Record<string,boolean>={};
 /** Did the write that succeeded store what it was sent? */
 const holds=(row:{visibility:string;link_role:string|null;access:string|null}|null|undefined,fields:Record<string,unknown>)=>!!row
  &&(fields.visibility===undefined||row.visibility===fields.visibility)&&(fields.linkRole===undefined||row.link_role===fields.linkRole)&&(fields.access===undefined||row.access===fields.access);
 for(const role of ['editor','member'] as const){
  const twin=twins[role],agent=await eve.asGroup(team.id,role);
  for(const [name,content,fields] of CASES){
   // Creation in Team.
   const made=async(token:string)=>{const r=await host.call('POST','/api/artifacts',token,{...content(name),destination:{type:'group',id:team.id},...fields});return {ok:r.status===201,row:r.status===201?await stored(String(r.body!.id)):null,body:r.body};};
   const byTwin=await made(twin.token),byAgent=await made(agent.token);
   expect({ok:byAgent.ok,row:byAgent.row},`create ${role} ${name}: ${JSON.stringify(byAgent.body)} vs ${JSON.stringify(byTwin.body)}`).toEqual({ok:byTwin.ok,row:byTwin.row});
   if(byTwin.ok)expect(holds(byTwin.row,fields),`create ${role} ${name} stored`).toBe(true);
   outcomes[`create ${role} ${name}`]=byTwin.ok;
   // A replace of a private Team page (or dataset) Ada made, sending the field.
   const replaced=async(token:string)=>{
    const id=String((await host.call('POST','/api/artifacts',ada.token,{...content(name),destination:{type:'group',id:team.id},visibility:'private'})).body!.id);
    // A dataset under a write policy is its owner's to replace, for a person and a group alike (`policy_locked`); one
    // without a policy is what an editor may replace, so `access` is set where it can be.
    if(fields.access)await sql('UPDATE artifacts SET dataset_policy=NULL WHERE id=$1',[id]);
    const current=await host.call('GET',`/api/artifacts/${id}`,ada.token);
    const body:Record<string,unknown>={...content(name),expectedVersion:current.body?.version,expectedState:current.body?.state,...fields};
    delete body.title;
    const r=await host.call('PUT',`/api/artifacts/${id}`,token,body);
    return {ok:r.status===200,row:await stored(id),body:r.body};
   };
   const twinPut=await replaced(twin.token),agentPut=await replaced(agent.token);
   expect({ok:agentPut.ok,row:agentPut.row},`replace ${role} ${name}: ${JSON.stringify(agentPut.body)} vs ${JSON.stringify(twinPut.body)}`).toEqual({ok:twinPut.ok,row:twinPut.row});
   if(twinPut.ok)expect(holds(twinPut.row,fields),`replace ${role} ${name} stored`).toBe(true);
   outcomes[`replace ${role} ${name}`]=twinPut.ok;
  }
 }
 // Spelled out: a direct Editor sets all three at creation and on a replace; a direct Member creates and replaces nothing.
 expect(outcomes).toEqual(Object.fromEntries(['create','replace'].flatMap(path=>(['editor','member'] as const).flatMap(role=>CASES.map(([name])=>[`${path} ${role} ${name}`,role==='editor'])))));
});
