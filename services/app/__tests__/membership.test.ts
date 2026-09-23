import {createAnnotationFor} from '@/lib/annotations';
import {membershipInbox,updateMembershipInbox} from '@/lib/membership-inbox';
import { expect, it } from 'vitest';
import { request, useAppHarness } from './harness';
import { POST } from '@/app/api/my/artifacts/[id]/members/route';
import { effectiveRole, getArtifactById } from '@/lib/artifacts';
import { createUser } from '@/lib/users';
import { link } from '@/lib/relations';
import { changeMembership, membershipState, mentionCandidates, invitePeople } from '@/lib/membership';
import { getDb } from '@/lib/db';

useAppHarness();
async function world() {
  const owner = await createUser({ email: 'mxmx_test_members_owner@example.com' });
  const bob = await createUser({ email: 'mxmx_test_members_bob@example.com' });
  const eve = await createUser({ email: 'mxmx_test_members_eve@example.com' });
  const db = await getDb();
  for (const [user, username] of [[owner,'member_owner'],[bob,'member_bob'],[eve,'member_eve']] as const) await db.query('UPDATE users SET username=$2 WHERE id=$1',[user.id,username]);
  await db.query("INSERT INTO artifacts(id,token_id,user_id,format,content,visibility,link_role) VALUES('a1B2c3','owner-token',$1,'markup','hello','public','commenter')",[owner.id]);
  return { db, owner, bob, eve, actor: (user: {id:string}) => ({ userId:user.id,tokenId:null }) };
}
it('joins an owner immediately; readers request and only an editor can approve', async () => {
  const w=await world();
  expect((await changeMembership(w.actor(w.owner),'a1B2c3',{action:'join'})).self?.status).toBe('accepted');
  expect((await changeMembership(w.actor(w.bob),'a1B2c3',{action:'join'})).self?.status).toBe('pending');
  await expect(changeMembership(w.actor(w.bob),'a1B2c3',{action:'approve',userId:w.bob.id})).rejects.toThrow(/approve/i);
  await changeMembership(w.actor(w.owner),'a1B2c3',{action:'approve',userId:w.bob.id});
  expect((await membershipState(w.actor(w.bob),'a1B2c3')).self?.joined_at).toBeTruthy();
  await changeMembership(w.actor(w.bob),'a1B2c3',{action:'leave'});
  expect((await membershipState(w.actor(w.bob),'a1B2c3')).members.map(m=>m.user_id)).not.toContain(w.bob.id);
});
it('uses recipient-follows-sender direction for candidates and autoaccept, including agents', async () => {
  const w=await world();
  await link(w.bob.id,'follow',w.owner.id);
  await link(w.owner.id,'follow',w.eve.id);
  expect(await mentionCandidates(w.actor(w.owner),'a1B2c3','member')).toEqual(expect.arrayContaining([expect.objectContaining({ user_id:w.bob.id })]));
  expect(await mentionCandidates(w.actor(w.owner),'a1B2c3','member_eve')).toEqual([]);
  await changeMembership({...w.actor(w.owner),tokenId:'agent-token'},'a1B2c3',{action:'invite',usernames:['@member_bob']});
  expect((await membershipState(w.actor(w.bob),'a1B2c3')).self?.status).toBe('accepted');
  expect((await changeMembership(w.actor(w.owner),'a1B2c3',{action:'invite',usernames:['@member_eve']})).pending).toEqual([expect.objectContaining({user_id:w.eve.id})]);
});
it('keeps invitations pending when autoaccept is disabled; only the recipient accepts', async () => {
  const w=await world();
  await w.db.query('UPDATE users SET auto_accept_mentions=false WHERE id=$1',[w.bob.id]);
  await link(w.bob.id,'follow',w.owner.id);
  await changeMembership(w.actor(w.owner),'a1B2c3',{action:'invite',usernames:['@member_bob']});
  await expect(changeMembership(w.actor(w.owner),'a1B2c3',{action:'approve',userId:w.bob.id})).rejects.toThrow(/recipient/i);
  expect((await changeMembership(w.actor(w.bob),'a1B2c3',{action:'accept'})).self?.status).toBe('accepted');
});
it('keeps repeated requests idempotent and pending identities private', async () => {
  const w=await world();
  await changeMembership(w.actor(w.bob),'a1B2c3',{action:'join'});
  await changeMembership(w.actor(w.bob),'a1B2c3',{action:'join'});
  expect((await membershipState(w.actor(w.eve),'a1B2c3')).pending).toEqual([]);
  expect((await membershipState(w.actor(w.owner),'a1B2c3')).pending).toHaveLength(1);
  expect((await w.db.query('SELECT * FROM member_notifications WHERE recipient_id=$1',[w.owner.id])).rows).toHaveLength(1);
});
it('rechecks access before approving and refuses anonymous participation', async () => {
  const w=await world();
  await expect(changeMembership({userId:null,tokenId:null},'a1B2c3',{action:'join'})).rejects.toThrow(/sign in/i);
  await changeMembership(w.actor(w.bob),'a1B2c3',{action:'join'});
  await w.db.query("UPDATE artifacts SET visibility='private',sharing_revision=sharing_revision+1 WHERE id='a1B2c3'");
  await expect(changeMembership(w.actor(w.owner),'a1B2c3',{action:'approve',userId:w.bob.id})).rejects.toThrow(/access/i);
});
it('caps outstanding requests across artefacts and frees slots on withdrawal', async () => {
  const w=await world();
  for(let i=0;i<30;i++) {
    const id=`cap${String(i).padStart(3,'0')}`;
    await w.db.query("INSERT INTO artifacts(id,token_id,user_id,format,content,visibility) VALUES($1,'owner-token',$2,'markup','x','public')",[id,w.owner.id]);
    await changeMembership(w.actor(w.bob),id,{action:'join'});
  }
  await expect(changeMembership(w.actor(w.bob),'a1B2c3',{action:'join'})).rejects.toThrow(/30/);
  await changeMembership(w.actor(w.bob),'cap000',{action:'leave'});
  expect((await changeMembership(w.actor(w.bob),'a1B2c3',{action:'join'})).self?.status).toBe('pending');
});

it('the browser handler keeps comment access independent and refuses cross-site membership changes', async () => {
  const w=await world();
  const ctx={params:Promise.resolve({id:'a1B2c3'})};
  const actor={credential:'session' as const,userId:w.bob.id,email:w.bob.email!,emailVerified:true};
  const response=await POST(request('/api/my/artifacts/a1B2c3/members',{method:'POST',origin:'same',actor,json:{action:'join'}}),ctx);
  expect(response.status).toBe(200);
  expect((await response.json()).self.status).toBe('pending');
  expect(await effectiveRole((await getArtifactById('a1B2c3'))!,w.actor(w.bob))).toBe('commenter');
  const cross=await POST(request('/api/my/artifacts/a1B2c3/members',{method:'POST',origin:'https://outside.example',actor,json:{action:'leave'}}),ctx);
  expect(cross.status).toBe(403);
});

it('commits resolved mentions once, reuses pending requests, and refuses blocked recipients',async()=>{
 const w=await world();await link(w.bob.id,'follow',w.owner.id);
 await w.db.query('UPDATE users SET auto_accept_mentions=false WHERE id=$1',[w.bob.id]);
 const mention=(source:string)=>w.db.transaction(async tx=>{const row=(await tx.query<any>("SELECT * FROM artifacts WHERE id='a1B2c3' FOR UPDATE")).rows[0];await invitePeople(tx,row,w.actor(w.owner),[w.bob.id],source);});
 await mention('comment:one');await mention('comment:one');await mention('comment:two');
 expect((await w.db.query("SELECT * FROM member_notifications WHERE kind<>'follow'")).rows).toHaveLength(1);
 await changeMembership(w.actor(w.bob),'a1B2c3',{action:'accept'});
 await mention('comment:three');await mention('comment:three');
 expect((await w.db.query("SELECT * FROM member_notifications WHERE kind='mention'")).rows).toHaveLength(1);
 await w.db.query('INSERT INTO user_blocks(user_id,blocked_user_id) VALUES($1,$2)',[w.bob.id,w.owner.id]);
 expect(await mentionCandidates(w.actor(w.owner),'a1B2c3','')).toEqual([]);
 await expect(mention('comment:blocked')).rejects.toThrow('eligible');
});

it('posts resolved comment mentions atomically for agents and ignores examples in code',async()=>{
 const w=await world();await link(w.bob.id,'follow',w.owner.id);
 await w.db.query(`UPDATE artifacts SET source='<p id="mark">Hello</p>' WHERE id='a1B2c3'`);
 const actor={userId:w.owner.id,tokenId:'owner-token'};
 const post=(body:string)=>createAnnotationFor(actor,'a1B2c3',{nodeId:'mark',body},{kind:'agent',label:'test',transport:'http'});
 expect(await post('`[@member_bob](/people/'+w.bob.id+')`')).not.toBeNull();
 expect((await membershipInbox(w.actor(w.bob))).notifications).toHaveLength(0);
 const result=await post('[@member_bob](/people/'+w.bob.id+')');expect(result).not.toBeInstanceOf(Response);
 expect((await membershipState(w.actor(w.bob),'a1B2c3')).self?.status).toBe('accepted');
 const inbox=await membershipInbox(w.actor(w.bob));expect(inbox.notifications).toHaveLength(1);
 expect(inbox.notifications[0].source).toMatch(/^comment:/);
 await updateMembershipInbox(w.actor(w.bob),{autoAccept:false,block:w.owner.id});
 expect((await membershipInbox(w.actor(w.bob))).autoAccept).toBe(false);
 const refused=await post('[@member_bob](/people/'+w.bob.id+')');expect(refused).toBeInstanceOf(Response);expect((refused as Response).status).toBe(403);
 expect((await w.db.query('SELECT * FROM annotations')).rows).toHaveLength(2);
});

it('permits explicit invitations without a follow',async()=>{
 const w=await world();
 expect((await changeMembership(w.actor(w.owner),'a1B2c3',{action:'invite',usernames:['@member_bob']})).pending).toHaveLength(1);
});
it('refuses another unsolicited invitation after dismissal',async()=>{
 const w=await world();await link(w.bob.id,'follow',w.owner.id);
 await w.db.query('UPDATE users SET auto_accept_mentions=false WHERE id=$1',[w.bob.id]);
 await changeMembership(w.actor(w.owner),'a1B2c3',{action:'invite',usernames:['@member_bob']});
 await changeMembership(w.actor(w.bob),'a1B2c3',{action:'dismiss'});
 await expect(changeMembership(w.actor(w.owner),'a1B2c3',{action:'invite',usernames:['@member_bob']})).rejects.toThrow();
});
it('gives an existing requester instant membership after receiving edit access',async()=>{
 const w=await world();await changeMembership(w.actor(w.bob),'a1B2c3',{action:'join'});
 await w.db.query("INSERT INTO artifact_shares(artifact_id,user_id,email,role) VALUES('a1B2c3',$1,$2,'editor')",[w.bob.id,w.bob.email]);
 expect((await changeMembership(w.actor(w.bob),'a1B2c3',{action:'join'})).self?.status).toBe('accepted');
});
it('includes viewing access atomically only when explicitly requested by an editor',async()=>{
 const w=await world();await w.db.query("UPDATE artifacts SET visibility='private' WHERE id='a1B2c3'");
 await expect(changeMembership(w.actor(w.owner),'a1B2c3',{action:'invite',usernames:['@member_bob']})).rejects.toThrow(/access/);
 await changeMembership(w.actor(w.owner),'a1B2c3',{action:'invite',usernames:['@member_bob'],includeAccess:true});
 expect(await effectiveRole((await getArtifactById('a1B2c3'))!,w.actor(w.bob))).toBe('viewer');
 expect((await membershipState(w.actor(w.bob),'a1B2c3')).self?.status).toBe('pending');
 await expect(changeMembership(w.actor(w.bob),'a1B2c3',{action:'invite',usernames:['@member_eve'],includeAccess:true})).rejects.toThrow(/owners and editors/);
 await expect(changeMembership(w.actor(w.owner),'a1B2c3',{action:'invite',usernames:['@member_eve','@missing'],includeAccess:true})).rejects.toThrow();
 expect(await effectiveRole((await getArtifactById('a1B2c3'))!,w.actor(w.eve))).toBe('none');
});
it('keeps mention autocomplete restricted while explicit invitations can find non-followers',async()=>{
 const w=await world();
 expect(await mentionCandidates(w.actor(w.owner),'a1B2c3','member_bob')).toEqual([]);
 expect(await mentionCandidates(w.actor(w.owner),'a1B2c3','member_bob','invite')).toEqual([expect.objectContaining({user_id:w.bob.id})]);
});

it('does not let a new artefact bypass a dismissed invitation',async()=>{
 const w=await world();
 await changeMembership(w.actor(w.owner),'a1B2c3',{action:'invite',usernames:['@member_bob']});
 await changeMembership(w.actor(w.bob),'a1B2c3',{action:'dismiss'});
 await w.db.query("INSERT INTO artifacts(id,token_id,user_id,format,content,visibility,link_role) VALUES('d4E5f6','owner-token',$1,'markup','hello','public','commenter')",[w.owner.id]);
 await expect(changeMembership(w.actor(w.owner),'d4E5f6',{action:'invite',usernames:['@member_bob']})).rejects.toThrow(/declined/);
});
