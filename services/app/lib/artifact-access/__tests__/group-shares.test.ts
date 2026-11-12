import {describe,it,expect} from 'vitest';
import {useAppHarness,admitGroupMember} from '@/__tests__/harness';
import {account,mine,head,sql,dataset} from '@/__tests__/artifact-fixtures';
import {createGroup,removeGroupMember,setGroupLink} from '@/lib/groups';
import {setArtifactGroupShare,listArtifactPageFor,getArtifactFor,getSharingFor,updateSharingFor} from '@/lib/artifacts';
import {effectiveRole,preloadAccessFacts,liveAccessFacts,readThrough,annotationScope,editorScope,ownerScope,reactionScope,policyReaderSql} from '..';
import {getDb} from '@/lib/platform';
import {datasetWriteAccess} from '@/lib/dataset-permissions';
useAppHarness();
const admitted=async(scope:ReturnType<typeof editorScope>,id:string)=>(await sql(`SELECT id FROM artifacts WHERE id=$1 AND ${scope.where('$2')}`,[id,scope.val])).length===1;
describe('group principal lattice',()=>{
 it('matches live/preloaded JS, SQL, readThrough and policy reads at each role, preserving personal ownership',async()=>{
  const owner=await account('mxmx_test_owner@example.com'),member=await account('mxmx_test_member@example.com'),outsider=await account('mxmx_test_outsider@example.com');
  const group=await createGroup(owner.userId,{handle:'design_crit',name:'Design'});
  await admitGroupMember(owner.userId,group.id,member.userId,'member');
  const page=await mine(owner);
  for(const role of ['viewer','commenter','editor'] as const){
   expect(await setArtifactGroupShare(owner,page.id,group.id,role)).toEqual({changed:true});
   expect(await setArtifactGroupShare(owner,page.id,group.id,role)).toEqual({changed:false});
   const row=await head(page.id),db=await getDb();
   expect(await effectiveRole(row,member,liveAccessFacts(member))).toBe(role);
   const facts=await preloadAccessFacts(db,member,[row]);
   expect(await effectiveRole(row,member,facts)).toBe(role);
   expect(await readThrough(db,row,member,facts)).toBe(true);
   expect(await effectiveRole(row,outsider)).toBe('none');
   expect(await admitted(reactionScope(member),row.id)).toBe(true);
   expect(await admitted(annotationScope(member),row.id)).toBe(role!=='viewer');
   expect(await admitted(editorScope(member),row.id)).toBe(role==='editor');
   expect(await admitted(ownerScope(member),row.id)).toBe(false);
   expect((await sql(`SELECT id FROM artifacts WHERE id=$1 AND ${policyReaderSql('$2','$3')}`,[row.id,member.userId,null]))).toHaveLength(1);
   expect(row).toMatchObject({user_id:owner.userId,group_id:null});
  }
  await expect(setArtifactGroupShare(member,page.id,group.id,'viewer')).resolves.toBeNull();
  expect((await listArtifactPageFor(member,10,undefined,{group_id:group.id})).rows).toMatchObject([{id:page.id,user_id:owner.userId}]);
  expect((await listArtifactPageFor(outsider,10,undefined,{group_id:group.id})).rows).toEqual([]);
  await updateSharingFor(owner,page.id,{shares:[]});
  expect((await getSharingFor(owner,page.id))?.groupShares).toMatchObject([{group:{id:group.id},role:'editor'}]);
  await removeGroupMember(owner.userId,group.id,member.userId);
  expect(await effectiveRole(await head(page.id),member)).toBe('none');
  expect(await getArtifactFor(member,page.id)).toBeNull();
  expect(await readThrough(await getDb(),await head(page.id),member,await preloadAccessFacts(await getDb(),member,[page]))).toBe(false);
  expect(await admitted(editorScope(member),page.id)).toBe(false);
 });
 it('does not inherit through navigation links or grant dataset writes through readability',async()=>{
  const owner=await account('mxmx_test_owner@example.com'),member=await account('mxmx_test_member@example.com');
  const first=await createGroup(owner.userId,{handle:'first_team',name:'First'}),second=await createGroup(owner.userId,{handle:'second_team',name:'Second'});
  await admitGroupMember(owner.userId,second.id,member.userId,'member');await setGroupLink(owner.userId,second.id,first.id,true);
  const row=await dataset(owner,{version:3,tables:[]},{visibility:'private'});
  await setArtifactGroupShare(owner,row.id,first.id,'editor');
  expect(await effectiveRole(row,member)).toBe('none');
  await setArtifactGroupShare(owner,row.id,second.id,'viewer');
  expect(await readThrough(await getDb(),row,member)).toBe(true);
  expect((await datasetWriteAccess(row,member)).allowed).toBe(false);
  await setArtifactGroupShare(owner,row.id,second.id,null);
  expect(await effectiveRole(row,member)).toBe('none');
 });
 it('makes members the dataset viewer only through a group share of the dataset itself, never of the page',async()=>{
  const owner=await account('mxmx_test_owner@example.com'),member=await account('mxmx_test_member@example.com');
  const group=await createGroup(owner.userId,{handle:'tracker_team',name:'Tracker'});
  await admitGroupMember(owner.userId,group.id,member.userId,'member');
  const data=await dataset(owner,{version:3,tables:[]},{visibility:'unlisted'}),page=await mine(owner);
  for(const role of ['viewer','commenter','editor'] as const){
   await setArtifactGroupShare(owner,page.id,group.id,role);
   expect((await datasetWriteAccess(await head(data.id),member,{throughPage:true})).role).toBe('signed_in');
  }
  for(const [role,expected] of [['viewer','viewer'],['commenter','viewer'],['editor','editor']] as const){
   await setArtifactGroupShare(owner,data.id,group.id,role);
   expect((await datasetWriteAccess(await head(data.id),member,{throughPage:true})).role).toBe(expected);
  }
  await setArtifactGroupShare(owner,data.id,group.id,null);
  expect((await datasetWriteAccess(await head(data.id),member,{throughPage:true})).role).toBe('signed_in');
 });
});
