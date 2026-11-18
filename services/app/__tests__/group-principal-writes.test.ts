/**
 * WHAT AN AGENT SIGNED IN AS A GROUP WRITES, and who the author is: at editor level it creates in its group only and
 * edits its group's pages (never personal, never another group, never sharing or placement); it comments where its role
 * reaches, as the group (shown under the group's name, as an agent), and edits only the group's own comments.
 */
import {GROUP_PRINCIPAL_REFUSED} from '@artifactbin/contracts';
import {expect,it} from 'vitest';
import {useAppHarness} from './harness';
import {composed,page,sql,useGroupPrincipalHost,world} from './group-principal-fixture';
useAppHarness();
useGroupPrincipalHost();

it('at editor level creates in its group only and edits its group\'s pages; a member does neither',async()=>{
 const host=await composed(),{eve,root,team,squad,pages}=await world(host);
 const editor=await eve.asGroup(team.id,'editor'),member=await eve.asGroup(team.id,'member');
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
 // Content only: who may read it stays with people.
 expect(await replace(editor.token,pages.team,'Opened',{visibility:'public'})).toMatchObject({status:403,body:{error:GROUP_PRINCIPAL_REFUSED}});
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
 // Its own comment it edits (any sign-in of the group); a person's it does not.
 const ownId=String((made.body as {id?:string}).id ?? (made.body as {annotation?:{id:string}}).annotation?.id);
 const edit=await host.call('PATCH',`/api/artifacts/${pages.sharedTeam}/annotations/${ownId}`,editor.token,{body:'Edited by the team agent'});
 expect(edit.status,JSON.stringify(edit.body)).toBe(200);
 const eves=await host.call('POST',`/api/artifacts/${pages.sharedTeam}/annotations`,eve.token,{body:'Eve here',anchor:await anchorOf(pages.sharedTeam)});
 expect((await host.call('PATCH',`/api/artifacts/${pages.sharedTeam}/annotations/${String(eves.body!.id)}`,editor.token,{body:'Not yours'})).status).toBe(404);
});
