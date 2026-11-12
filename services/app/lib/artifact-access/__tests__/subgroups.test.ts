/**
 * SUBTREE AUDIENCE (lib/groups hierarchy): Finance ⊃ {Retail, Enterprise}. A share to a group reaches the direct
 * members of that group and of every descendant, never upward or sideways; group-owned work keeps its owners on
 * direct editor rows. Every decision source must agree for every actor: the JavaScript rule over live, preloaded
 * and transaction facts, `readThrough`, the SQL scopes, the comment-monitor scope and the listing.
 */
import {describe,it,expect} from 'vitest';
import {useAppHarness,admitGroupMember} from '@/__tests__/harness';
import {account,mine,head,sql,dataset,type Account} from '@/__tests__/artifact-fixtures';
import {createGroup,deleteGroup,removeGroupMember,setGroupParent} from '@/lib/groups';
import {setArtifactGroupShare,listArtifactPageFor,getArtifactFor} from '@/lib/artifacts';
import {datasetWriteAccess} from '@/lib/dataset-permissions';
import {getDb} from '@/lib/platform';
import {shareRolesAtLeast,type ArtifactRole} from '@artifactbin/contracts';
import {effectiveRole,liveAccessFacts,preloadAccessFacts,transactionAccessFacts,readThrough,reactionScope,annotationScope,editorScope,ownerScope,commentMonitorScope,policyReaderSql,type Scope} from '..';
useAppHarness();

const admitted=async(scope:Scope,id:string)=>(await sql(`SELECT id FROM artifacts WHERE id=$1 AND ${scope.where('$2')}`,[id,scope.val])).length===1;
const reaches=(role:ArtifactRole,min:ArtifactRole)=>role==='owner'||(min!=='owner'&&shareRolesAtLeast(min).includes(role as never));
/** The one role every source gives `actor` on `id`, after asserting they all agree with it. */
async function roleOf(id:string,actor:Account):Promise<ArtifactRole>{
 const db=await getDb(),row=await head(id);
 const live=await effectiveRole(row,actor,liveAccessFacts(actor));
 expect(await effectiveRole(row,actor,await preloadAccessFacts(db,actor,[row])),'preloaded').toBe(live);
 expect(await db.transaction(tx=>effectiveRole(row,actor,transactionAccessFacts(actor,tx))),'transaction').toBe(live);
 const read=live!=='none';
 expect(await readThrough(db,row,actor),'readThrough').toBe(read);
 // The viewer-level SQL scope admits share holders only: a group-owned row's member audience (direct or through a
 // subgroup) reads through the policy-reader, comment-monitor and listing predicates instead, as it did before.
 if(!row.group_id)expect(await admitted(reactionScope(actor),id),'sql viewer').toBe(read);
 expect((await sql(`SELECT id FROM artifacts WHERE id=$1 AND ${policyReaderSql('$2','$3')}`,[id,actor.userId,null])).length===1,'sql policy reader').toBe(read);
 expect(await admitted(commentMonitorScope(actor),id),'sql comment monitor').toBe(read);
 expect(await admitted(annotationScope(actor),id),'sql commenter').toBe(reaches(live,'commenter'));
 expect(await admitted(editorScope(actor),id),'sql editor').toBe(reaches(live,'editor'));
 expect(await admitted(ownerScope(actor),id),'sql owner').toBe(live==='owner');
 expect((await listArtifactPageFor(actor,100)).rows.some(r=>r.id===id),'listing').toBe(read);
 expect(!!(await getArtifactFor(actor,id)),'serving read').toBe(reaches(live,'editor'));
 return live;
}
/** Finance ⊃ {Retail, Enterprise}; one direct viewer in each, and an author outside every group. */
async function finance(){
 const admin=await account('mxmx_test_admin@example.com'),author=await account('mxmx_test_author@example.com');
 const fin=await createGroup(admin.userId,{handle:'finance',name:'Finance'});
 const retail=await createGroup(admin.userId,{handle:'retail',name:'Retail',parent_id:fin.id});
 const enterprise=await createGroup(admin.userId,{handle:'enterprise',name:'Enterprise',parent_id:fin.id});
 const finOnly=await account('mxmx_test_fin@example.com'),retailOnly=await account('mxmx_test_retail@example.com'),entOnly=await account('mxmx_test_ent@example.com');
 await admitGroupMember(admin.userId,fin.id,finOnly.userId,'member');
 await admitGroupMember(admin.userId,retail.id,retailOnly.userId,'member');
 await admitGroupMember(admin.userId,enterprise.id,entOnly.userId,'member');
 // The author shares into groups it belongs to (sharing requires membership): a viewer of each.
 for(const group of [fin,retail,enterprise])await admitGroupMember(admin.userId,group.id,author.userId,'member');
 return {admin,author,fin,retail,enterprise,finOnly,retailOnly,entOnly};
}

describe('a share reaches its group and every descendant, nothing upward or sideways',()=>{
 it('a Finance share reaches a Retail-only member; a Retail share reaches neither Finance-only nor the sibling',async()=>{
  const f=await finance();
  const toFinance=await mine(f.author,'To Finance',{visibility:'private'}),toRetail=await mine(f.author,'To Retail',{visibility:'private'});
  await setArtifactGroupShare(f.author,toFinance.id,f.fin.id,'commenter');
  await setArtifactGroupShare(f.author,toRetail.id,f.retail.id,'editor');
  expect(await roleOf(toFinance.id,f.finOnly)).toBe('commenter');
  expect(await roleOf(toFinance.id,f.retailOnly)).toBe('commenter');
  expect(await roleOf(toFinance.id,f.entOnly)).toBe('commenter');
  expect(await roleOf(toRetail.id,f.retailOnly)).toBe('editor');
  expect(await roleOf(toRetail.id,f.finOnly)).toBe('none');
  expect(await roleOf(toRetail.id,f.entOnly)).toBe('none');
 });

 it('combines a parent and a subgroup share by the highest role; a narrower subgroup share never downgrades',async()=>{
  const f=await finance();
  const doc=await mine(f.author,'Both',{visibility:'private'});
  await setArtifactGroupShare(f.author,doc.id,f.fin.id,'editor');
  await setArtifactGroupShare(f.author,doc.id,f.retail.id,'viewer');
  expect(await roleOf(doc.id,f.retailOnly)).toBe('editor');
  expect(await roleOf(doc.id,f.finOnly)).toBe('editor');
  await setArtifactGroupShare(f.author,doc.id,f.fin.id,'viewer');
  await setArtifactGroupShare(f.author,doc.id,f.retail.id,'commenter');
  expect(await roleOf(doc.id,f.retailOnly)).toBe('commenter');
  expect(await roleOf(doc.id,f.finOnly)).toBe('viewer');
 });

 it('reaches a dataset the same way, as its one dataset role',async()=>{
  const f=await finance();
  const data=await dataset(f.author,{version:3,tables:[]},{visibility:'private'});
  await setArtifactGroupShare(f.author,data.id,f.fin.id,'viewer');
  expect((await datasetWriteAccess(await head(data.id),f.retailOnly)).role).toBe('viewer');
  expect(await roleOf(data.id,f.retailOnly)).toBe('viewer');
  await setArtifactGroupShare(f.author,data.id,f.fin.id,null);
  await setArtifactGroupShare(f.author,data.id,f.retail.id,'viewer');
  expect((await datasetWriteAccess(await head(data.id),f.finOnly)).role).toBeNull();
  expect(await roleOf(data.id,f.finOnly)).toBe('none');
 });
});

describe('group-owned work: the audience reads, ownership stays on direct editor rows',()=>{
 it('a Retail editor reads Finance-owned work but never owns or edits it by ancestry',async()=>{
  const f=await finance(),lead=await account('mxmx_test_lead@example.com');
  await admitGroupMember(f.admin.userId,f.retail.id,lead.userId,'admin');
  const owned=await mine(f.admin,'Finance owned',{visibility:'private',destination:{type:'group',id:f.fin.id}});
  expect((await head(owned.id)).group_id).toBe(f.fin.id);
  expect(await roleOf(owned.id,f.admin)).toBe('owner');
  expect(await roleOf(owned.id,lead)).toBe('viewer');
  expect(await roleOf(owned.id,f.retailOnly)).toBe('viewer');
  expect(await roleOf(owned.id,f.finOnly)).toBe('viewer');
  const retailOwned=await mine(f.admin,'Retail owned',{visibility:'private',destination:{type:'group',id:f.retail.id}});
  expect(await roleOf(retailOwned.id,lead)).toBe('owner');
  expect(await roleOf(retailOwned.id,f.finOnly)).toBe('none');
  expect(await roleOf(retailOwned.id,f.entOnly)).toBe('none');
 });
});

describe('revocation takes effect for the next request',()=>{
 it('removing the membership, deleting the share and reparenting Retail out of Finance each revoke',async()=>{
  const f=await finance();
  const doc=await mine(f.author,'Revoked',{visibility:'private'});
  const owned=await mine(f.admin,'Owned',{visibility:'private',destination:{type:'group',id:f.fin.id}});
  await setArtifactGroupShare(f.author,doc.id,f.fin.id,'editor');
  // The share.
  expect(await roleOf(doc.id,f.retailOnly)).toBe('editor');
  await setArtifactGroupShare(f.author,doc.id,f.fin.id,null);
  expect(await roleOf(doc.id,f.retailOnly)).toBe('none');
  await setArtifactGroupShare(f.author,doc.id,f.fin.id,'editor');
  // The reparent: Retail out of Finance, then back in.
  await setGroupParent(f.admin.userId,f.retail.id,null,f.fin.id);
  expect(await roleOf(doc.id,f.retailOnly)).toBe('none');
  expect(await roleOf(owned.id,f.retailOnly)).toBe('none');
  expect(await roleOf(doc.id,f.entOnly)).toBe('editor');
  await setGroupParent(f.admin.userId,f.retail.id,f.fin.id);
  expect(await roleOf(doc.id,f.retailOnly)).toBe('editor');
  expect(await roleOf(owned.id,f.retailOnly)).toBe('viewer');
  // The membership.
  await removeGroupMember(f.admin.userId,f.retail.id,f.retailOnly.userId);
  expect(await roleOf(doc.id,f.retailOnly)).toBe('none');
  expect(await roleOf(owned.id,f.retailOnly)).toBe('none');
 });

 it('a deleted subgroup reaches nothing',async()=>{
  const f=await finance();
  const doc=await mine(f.author,'Deleted',{visibility:'private'});
  await setArtifactGroupShare(f.author,doc.id,f.fin.id,'viewer');
  await deleteGroup(f.admin.userId,f.enterprise.id,'enterprise');
  expect(await roleOf(doc.id,f.entOnly)).toBe('none');
  expect(await roleOf(doc.id,f.retailOnly)).toBe('viewer');
 });
});
