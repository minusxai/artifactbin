/**
 * AN AGENT SIGNED IN AS A GROUP ON DATA, QUOTAS AND A COMPANY DEPLOYMENT: a dataset its group owns (an editor writes as
 * the group; a member has a member's rules; a rule naming the reader matches nothing), page actions through a page of
 * its group, its quota charged to the group, and its life tied to its person's admission in a company deployment.
 */
import {onTestFinished} from 'vitest';
import {getDb,syncIdentitySettings} from '@/lib/platform';
import {overrideConfig} from '@/lib/platform/config';
import {setArtifactQuotaForTests} from '@/lib/artifacts/testing';
import {SECRET} from './group-principal-fixture';
import {expect,it} from 'vitest';
import {useAppHarness} from './harness';
import {composed,origin,page,sql,useGroupPrincipalHost,world} from './group-principal-fixture';
useAppHarness();
useGroupPrincipalHost();

it('on a dataset its group owns: an editor writes as the group; a member has the rules of a member, and a rule naming the reader matches nothing',async()=>{
 const host=await composed(),{eve,team}=await world(host,false);
 const made=await host.call('POST','/api/artifacts',eve.token,{title:'Signups',dataset:[{name:'a',created_by:''},{name:'b',created_by:'someone'}],access:'readwrite',destination:{type:'group',id:team.id}});
 expect(made.status,JSON.stringify(made.body)).toBe(201);
 const id=String(made.body!.id);
 const editor=await eve.asGroup(team.id,'editor'),member=await eve.asGroup(team.id,'member');
 const mutate=(token:string,sql:string)=>host.call('POST',`/api/artifacts/${id}/mutate`,token,{sql});
 // An editor of the group edits the group's dataset, recorded as the group.
 expect((await mutate(editor.token,"insert into public.rows (name, created_by) values ('c','agent')")).status).toBe(200);
 expect(await sql('SELECT actor_user_id,actor_group_id FROM artifacts WHERE id=$1',[id])).toEqual([{actor_user_id:null,actor_group_id:team.id}]);
 // A member is a viewer of it: the stored read-only template lets it read and not write.
 const rows=await host.call('POST',`/api/artifacts/${id}/query`,member.token,{name:'rows'});
 expect(rows.status,JSON.stringify(rows.body)).toBe(200);
 expect((rows.body!.results as Array<{rows:unknown[]}>)[0]!.rows).toHaveLength(3);
 expect([403,404]).toContain((await mutate(member.token,"insert into public.rows (name) values ('d')")).status);
 // Rules naming the reader: X-Hasura-User-Id is no one's for a group, so the rule denies; never the '' row.
 await sql(`UPDATE artifacts SET dataset_policy=$2::jsonb, policy_revision=policy_revision+1 WHERE id=$1`,[id,JSON.stringify({version:3,tables:[{table:{schema:'public',name:'rows'},
  select_permissions:[{role:'viewer',permission:{columns:'*',filter:{created_by:{_eq:'X-Hasura-User-Id'}}}}],
  insert_permissions:[{role:'viewer',permission:{columns:['name'],check:{},set:{created_by:'X-Hasura-User-Id'}}}]}]})]);
 const own=await host.call('POST',`/api/artifacts/${id}/query`,member.token,{name:'rows'});
 expect(JSON.stringify(own.body)).not.toContain('"name":"a"');
 expect(own.status===200?((own.body!.results as Array<{rows:unknown[]}>)[0]!.rows).length:0).toBe(0);
 expect((await mutate(member.token,"insert into public.rows (name) values ('e')")).status).not.toBe(200);
 expect(await sql("SELECT count(*)::int AS n FROM artifacts WHERE id=$1 AND actor_group_id IS NOT NULL",[id])).toEqual([{n:1}]);
});

it('page actions: through a page of its group, a member writes the rows its role\'s rules allow, recorded as the group; a subgroup\'s page is beyond it',async()=>{
 const host=await composed(),{ada,eve,team,squad}=await world(host,false);
 const ROLES=['viewer','signed_in'];
 const policy={version:3,tables:[{table:{schema:'public',name:'rows'},
  select_permissions:ROLES.map(role=>({role,permission:{columns:'*',filter:{},allow_aggregations:true}})),
  insert_permissions:ROLES.map(role=>({role,permission:{columns:'*',check:{}}}))}]};
 const setUp=async(group:string,owner:string)=>{
  const dataset=String((await host.call('POST','/api/artifacts',owner,{title:'Records',dataset:[{n:1}],access:'readwrite',destination:{type:'group',id:group},visibility:'private'})).body!.id);
  await sql('UPDATE artifacts SET dataset_policy=$2::jsonb, policy_revision=policy_revision+1 WHERE id=$1',[dataset,JSON.stringify(policy)]);
  const made=await host.call('POST','/api/artifacts',owner,{title:'Form',destination:{type:'group',id:group},visibility:'private',
   html:`<!doctype html><html><head><link rel="af-dataset" data-af-name="records" href="ref:${dataset}" data-af-mode="live"></head><body><h1>Form</h1></body></html>`});
  expect(made.status,JSON.stringify(made.body)).toBe(201);
  return {dataset,page:String(made.body!.id)};
 };
 const ours=await setUp(team.id,eve.token),theirs=await setUp(squad.id,ada.token);
 const member=await eve.asGroup(team.id,'member');
 const write=(page:string)=>host.call('POST',`/api/artifacts/${page}/sql`,member.token,{revision:'1',sql:'insert into records(n) values($v)',params:{v:2}});
 const done=await write(ours.page);
 expect(done.status,JSON.stringify(done.body)).toBe(200);
 expect(await sql('SELECT actor_user_id,actor_group_id FROM artifacts WHERE id=$1',[ours.dataset])).toEqual([{actor_user_id:null,actor_group_id:team.id}]);
 const read=await host.call('POST',`/api/artifacts/${ours.page}/sql`,member.token,{revision:'1',sql:'select n from records order by n'});
 expect(read.body!.rows).toEqual([{n:1},{n:2}]);
 // A subgroup's page: not its group's, not readable, nothing written.
 expect((await write(theirs.page)).status).not.toBe(200);
 expect(await sql('SELECT actor_group_id FROM artifacts WHERE id=$1',[theirs.dataset])).toEqual([{actor_group_id:null}]);
});

it('its quota is its group\'s: every sign-in of the group counts against one cap, never a rotating token\'s',async()=>{
 const host=await composed(),{eve,team}=await world(host,false);
 setArtifactQuotaForTests(2);onTestFinished(()=>setArtifactQuotaForTests(null));
 const first=await eve.asGroup(team.id,'editor'),second=await eve.asGroup(team.id,'editor');
 const publish=(token:string,title:string)=>host.call('POST','/api/artifacts',token,{title,html:page(title)});
 expect((await publish(first.token,'One')).status).toBe(201);
 expect((await publish(second.token,'Two')).status).toBe(201);
 expect(await publish(first.token,'Three')).toMatchObject({status:403,body:{error:'quota_exceeded'}});
 expect(await publish((await eve.asGroup(team.id,'editor')).token,'Four')).toMatchObject({status:403,body:{error:'quota_exceeded'}});
 // The person who signed them in is charged nothing of it.
 expect((await publish(eve.token,'Eve own')).status).toBe(201);
});

it('in a company deployment the sign-in lives only while the person who signed it in is admitted there',async()=>{
 const host=await composed(),{eve,team,pages}=await world(host);
 const agent=await eve.asGroup(team.id,'editor');
 // The installation becomes a company deployment with Eve admitted: her agent's sign-in stands.
 overrideConfig({internalServiceSecret:SECRET,publicBaseUrl:origin},{APP__DEPLOYMENT_MODE:'company',APP__DEPLOYMENT_OWNER_EMAIL:'mxmx_test_ga_ada@example.test'});
 await syncIdentitySettings(await getDb());
 await sql('INSERT INTO deployment_members(user_id) VALUES($1) ON CONFLICT DO NOTHING',[eve.userId]);
 expect(await sql('SELECT live FROM tokens WHERE id=$1',[agent.tokenId])).toEqual([{live:true}]);
 const first=await host.call('GET',`/api/artifacts/${pages.team}`,agent.token);
 expect(first.status,JSON.stringify(first.body)).toBe(200);
 // No longer admitted: the sign-in ends on the next request.
 await sql('DELETE FROM deployment_members WHERE user_id=$1',[eve.userId]);
 expect(await sql('SELECT live FROM tokens WHERE id=$1',[agent.tokenId])).toEqual([{live:false}]);
 expect((await host.call('GET',`/api/artifacts/${pages.team}`,agent.token)).status).not.toBe(200);
});
