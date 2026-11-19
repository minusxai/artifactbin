/**
 * WHAT A PERSON HOLDS, PINNED: their own page, a page shared to them by name, a group's page at each level they hold
 * in the group, what the link reaches, and the personal destination. Every answer is asked of the JavaScript rule
 * (`effectiveRole`, `roleWithoutLink`, `ownsArtifact`), the SQL scopes and the read seam, so a change to how a person
 * is resolved (identity's personal group) has to keep each one.
 */
import {describe,expect,it} from 'vitest';
import {useAppHarness,admitGroupMember} from '@/__tests__/harness';
import {account,head,mine,sql} from '@/__tests__/artifact-fixtures';
import {ANONYMOUS_ACTOR} from '@/lib/accounts';
import {createGroup,selectNewArtifactDestination} from '@/lib/groups';
import {canReadArtifact,getArtifactFor,updateSharingFor} from '@/lib/artifacts';
import {annotationScope,editorScope,effectiveRole,ownerScope,ownsArtifact,policyReaderSql,reactionScope,roleWithoutLink,type Scope} from '..';
import {setArtifact} from '@/__tests__/rows';
import {getDb} from '@/lib/platform';

useAppHarness();
const reaches=async(scope:Scope,id:string)=>(await sql(`SELECT id FROM artifacts WHERE id=$1 AND ${scope.where('$2')}`,[id,scope.val])).length===1;
type Person=Awaited<ReturnType<typeof account>>;
/** Every answer for `who` on the row `id`: role with and without the link, ownership, each scope, the policy fence and the read seam. */
const answers=async(who:Person|typeof ANONYMOUS_ACTOR,id:string)=>{
 const row=await head(id);
 return {
  role:await effectiveRole(row,who),withoutLink:await roleWithoutLink(row,who),owns:ownsArtifact(row,who),
  owner:await reaches(ownerScope(who),id),editor:await reaches(editorScope(who),id),annotate:await reaches(annotationScope(who),id),react:await reaches(reactionScope(who),id),
  policyReader:who.userId?(await sql(`SELECT id FROM artifacts WHERE id=$1 AND ${policyReaderSql('$2','$3')}`,[id,who.userId,null])).length===1:null,
  reads:await canReadArtifact(row,who),edits:!!await getArtifactFor(who,id),
 };
};
const OWNER={role:'owner',withoutLink:'owner',owns:true,owner:true,editor:true,annotate:true,react:true,policyReader:true,reads:true,edits:true};
const NOTHING={role:'none',withoutLink:'none',owns:false,owner:false,editor:false,annotate:false,react:false,policyReader:false,reads:false,edits:false};
/** A group's Admin: its owner by the rule and every scope, though `ownsArtifact` (the row's own owner, no group read) says no. */
const GROUP_ADMIN={...OWNER,owns:false};

describe('a person',()=>{
 it('owns their own page, which nobody else reaches while it is private',async()=>{
  const ann=await account('mxmx_test_ann@example.com'),bob=await account('mxmx_test_bob@example.com');
  const page=await mine(ann,'Own',{visibility:'private'});
  expect(await head(page.id)).toMatchObject({user_id:ann.userId,group_id:null});
  expect(await answers(ann,page.id)).toEqual(OWNER);
  expect(await answers(bob,page.id)).toEqual(NOTHING);
  expect(await answers(ANONYMOUS_ACTOR,page.id)).toEqual({...NOTHING,policyReader:null});
 });

 it('holds exactly the role a page is shared to them with by name, never ownership',async()=>{
  const ann=await account('mxmx_test_ann@example.com'),bob=await account('mxmx_test_bob@example.com'),cat=await account('mxmx_test_cat@example.com');
  const page=await mine(ann,'Shared',{visibility:'private'});
  for(const role of ['viewer','commenter','editor'] as const){
   await updateSharingFor(ann,page.id,{shares:[{email:bob.email!,role}]});
   expect(await answers(bob,page.id),role).toEqual({role,withoutLink:role,owns:false,owner:false,editor:role==='editor',annotate:role!=='viewer',react:true,policyReader:true,reads:true,edits:role==='editor'});
   expect(await answers(cat,page.id),role).toEqual(NOTHING);
   expect(await answers(ann,page.id),role).toEqual(OWNER);
  }
  await updateSharingFor(ann,page.id,{shares:[]});
  expect(await answers(bob,page.id)).toEqual(NOTHING);
 });

 it('holds a group page at the level they hold in the group: member reads, editor edits, admin owns',async()=>{
  const ann=await account('mxmx_test_ann@example.com'),meg=await account('mxmx_test_meg@example.com'),ed=await account('mxmx_test_ed@example.com'),out=await account('mxmx_test_out@example.com');
  const group=await createGroup(ann.userId,{handle:'person_pins',name:'Pins'});
  await admitGroupMember(ann.userId,group.id,meg.userId,'member');
  await admitGroupMember(ann.userId,group.id,ed.userId,'editor');
  const page=await mine(ann,'Group',{visibility:'private',destination:{type:'group',id:group.id}});
  expect(await head(page.id)).toMatchObject({group_id:group.id});
  expect(await answers(ann,page.id)).toEqual(GROUP_ADMIN);
  expect(await answers(ed,page.id)).toEqual({role:'editor',withoutLink:'editor',owns:false,owner:false,editor:true,annotate:true,react:true,policyReader:true,reads:true,edits:true});
  expect(await answers(meg,page.id)).toEqual({role:'viewer',withoutLink:'viewer',owns:false,owner:false,editor:false,annotate:false,react:true,policyReader:true,reads:true,edits:false});
  expect(await answers(out,page.id)).toEqual(NOTHING);
  // A person's own page is no group's: the group's members reach none of it.
  const own=await mine(ann,'Own',{visibility:'private'});
  for(const who of [meg,ed])expect(await answers(who,own.id)).toEqual(NOTHING);
 });

 it('reaches a page by its link alone at the link role, an anonymous caller at viewer at most, and never as ownership or a listing',async()=>{
  const ann=await account('mxmx_test_ann@example.com'),bob=await account('mxmx_test_bob@example.com');
  const page=await mine(ann,'Linked',{visibility:'unlisted'});
  const db=await getDb();
  for(const link of ['viewer','commenter','editor'] as const){
   await setArtifact(db,page.id,{link_role:link});
   expect(await answers(bob,page.id),link).toEqual({role:link,withoutLink:'none',owns:false,owner:false,editor:link==='editor',annotate:link!=='viewer',react:true,policyReader:true,reads:true,edits:link==='editor'});
   expect(await answers(ANONYMOUS_ACTOR,page.id),link).toEqual({role:'viewer',withoutLink:'none',owns:false,owner:false,editor:false,annotate:false,react:false,policyReader:null,reads:true,edits:false});
   expect(await answers(ann,page.id),link).toEqual(OWNER);
  }
  await setArtifact(db,page.id,{visibility:'private'});
  expect(await answers(bob,page.id)).toEqual(NOTHING);
 });

 it('publishes to their personal destination by default, owning the row with no group on it',async()=>{
  expect(selectNewArtifactDestination({})).toEqual({type:'personal'});
  const ann=await account('mxmx_test_ann@example.com');
  for(const page of [await mine(ann,'Default'),await mine(ann,'Named',{destination:{type:'personal'}})]){
   expect(await head(page.id)).toMatchObject({user_id:ann.userId,group_id:null});
   expect(await answers(ann,page.id)).toEqual(OWNER);
  }
 });
});
