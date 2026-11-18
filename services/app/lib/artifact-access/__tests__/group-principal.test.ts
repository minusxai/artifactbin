/**
 * THE RULE FOR A GROUP'S SIGN-IN (lib/accounts `GroupPrincipal`), in both languages: on every page, its role is exactly
 * the role of its TWIN, a person whose only relationship to anything is a direct membership of the group at the same
 * level; and every decision source agrees on it (the JavaScript rule over live, preloaded and transaction facts,
 * `readThrough`, and the SQL scopes), with no ownership ever. Root > Team > Squad; the principal is Team's.
 */
import {it,expect} from 'vitest';
import {useAppHarness,admitGroupMember} from '@/__tests__/harness';
import {account,mine,head,sql,type Account} from '@/__tests__/artifact-fixtures';
import {createGroup} from '@/lib/groups';
import {setArtifactGroupShare,getArtifactFor} from '@/lib/artifacts';
import {getDb} from '@/lib/platform';
import {shareRolesAtLeast,type ArtifactRole} from '@artifactbin/contracts';
import type {AccessActor} from '@/lib/accounts';
import {effectiveRole,liveAccessFacts,preloadAccessFacts,transactionAccessFacts,readThrough,reactionScope,annotationScope,editorScope,ownerScope,commentMonitorScope,type Scope} from '..';
useAppHarness();

const admitted=async(scope:Scope,id:string)=>(await sql(`SELECT id FROM artifacts WHERE id=$1 AND ${scope.where('$2')}`,[id,scope.val])).length===1;
const reaches=(role:ArtifactRole,min:ArtifactRole)=>role==='owner'||(min!=='owner'&&shareRolesAtLeast(min).includes(role as never));

/** The group principal's role on `id`, after asserting every source agrees with it. */
async function principalRole(id:string,actor:AccessActor,twin?:Account):Promise<ArtifactRole>{
 const db=await getDb(),row=await head(id);
 const live=await effectiveRole(row,actor,liveAccessFacts(actor));
 expect(await effectiveRole(row,actor,await preloadAccessFacts(db,actor,[row])),'preloaded').toBe(live);
 expect(await db.transaction(tx=>effectiveRole(row,actor,transactionAccessFacts(actor,tx))),'transaction').toBe(live);
 expect(await readThrough(db,row,actor),'readThrough').toBe(live!=='none');
 expect(await admitted(reactionScope(actor),id),'sql viewer').toBe(live!=='none');
 if(twin)expect(await admitted(commentMonitorScope(actor),id),'sql comment monitor').toBe(await admitted(commentMonitorScope(twin),id));
 expect(await admitted(annotationScope(actor),id),'sql commenter').toBe(reaches(live,'commenter'));
 expect(await admitted(editorScope(actor),id),'sql editor').toBe(reaches(live,'editor'));
 expect(await admitted(ownerScope(actor),id),'sql owner').toBe(false);
 expect(!!(await getArtifactFor(actor,id)),'serving read').toBe(reaches(live,'editor'));
 return live;
}

async function tree(){
 const admin=await account('mxmx_test_gp_admin@example.com');
 const root=await createGroup(admin.userId,{handle:'gp_root',name:'Root'});
 const team=await createGroup(admin.userId,{handle:'gp_team',name:'Team',parent_id:root.id});
 const squad=await createGroup(admin.userId,{handle:'gp_squad',name:'Squad',parent_id:team.id});
 const doc=async(title:string,extra:Record<string,unknown>)=>(await mine(admin,title,{visibility:'private',...extra})).id;
 const pages:Record<string,string>={
  root:await doc('Root',{destination:{type:'group',id:root.id}}),
  team:await doc('Team',{destination:{type:'group',id:team.id}}),
  teamPublic:await doc('Team public',{destination:{type:'group',id:team.id},visibility:'public'}),
  squad:await doc('Squad',{destination:{type:'group',id:squad.id}}),
  personal:await doc('Personal',{}),
  toTeam:await doc('To Team',{}),toRoot:await doc('To Root',{}),toSquad:await doc('To Squad',{}),
  linkCommenter:await doc('Link commenter',{visibility:'unlisted'}),
  linkViewer:await doc('Link viewer',{visibility:'unlisted'}),
 };
 await setArtifactGroupShare(admin,pages.toTeam!,team.id,'commenter');
 await setArtifactGroupShare(admin,pages.toRoot!,root.id,'editor');
 await setArtifactGroupShare(admin,pages.toSquad!,squad.id,'editor');
 await sql("UPDATE artifacts SET link_role='commenter' WHERE id=$1",[pages.linkCommenter]);
 return {admin,root,team,squad,pages};
}
const principal=(group:string,role:'member'|'editor'):AccessActor=>({userId:null,tokenId:null,email:null,documentEditor:false,principalGroup:{id:group,role,tokenId:'tok_group_sign_in',issuedBy:'usr_someone'}});

it('holds exactly its twin\'s role on every page, at both levels, and every source agrees',async()=>{
 const t=await tree();
 for(const role of ['member','editor'] as const){
  const twin:Account=await account(`mxmx_test_gp_twin_${role}@example.com`);
  await admitGroupMember(t.admin.userId,t.team.id,twin.userId,role);
  const actor=principal(t.team.id,role);
  for(const [name,id] of Object.entries(t.pages)){
   const expected=await effectiveRole(await head(id),twin);
   expect(await principalRole(id,actor,twin),`${role} ${name}`).toBe(expected==='owner'?'none':expected);
  }
  // What that means, spelled out for the editor: its group's pages to edit, its ancestor's to read, nothing below it.
  if(role==='editor'){
   expect(await principalRole(t.pages.team!,actor)).toBe('editor');
   expect(await principalRole(t.pages.root!,actor)).toBe('viewer');
   expect(await principalRole(t.pages.squad!,actor)).toBe('none');
   expect(await principalRole(t.pages.toRoot!,actor)).toBe('editor');
   expect(await principalRole(t.pages.toSquad!,actor)).toBe('none');
   expect(await principalRole(t.pages.personal!,actor)).toBe('none');
   expect(await principalRole(t.pages.linkCommenter!,actor)).toBe('commenter');
  }
 }
});

it('a deleted group grants its sign-in nothing, and another group\'s principal reaches none of this group\'s pages',async()=>{
 const t=await tree();
 expect(await principalRole(t.pages.squad!,principal(t.squad.id,'editor'))).toBe('editor');
 expect(await principalRole(t.pages.team!,principal(t.squad.id,'editor'))).toBe('viewer');
 // Deleted as the identity module marks it (a group with pages is not deletable through the app; the mark is what counts).
 await sql('UPDATE auth.groups SET deleted_at=now() WHERE id=$1',[t.squad.id]);
 expect(await principalRole(t.pages.squad!,principal(t.squad.id,'editor'))).toBe('none');
 expect(await principalRole(t.pages.team!,principal(t.squad.id,'editor'))).toBe('none');
});
