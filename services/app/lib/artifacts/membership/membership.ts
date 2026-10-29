import { identityForUser, lockMembershipUsers, testAccountMayReach, type AccessActor } from '@/lib/accounts';
import { JOIN_RELATIONS, setRelationState } from '@/lib/social';
import {artifactQuery} from '../document';
import {recordEvent, getDb} from '@/lib/platform';
import {DatasetError} from '@/lib/datasets';
import { readThrough } from '@/lib/artifact-access';
import type { ArtifactMember, MembershipInput, MembershipState, MembershipDirection, MembershipStatus, Queryable } from '@artifactbin/contracts';
import { PENDING_MEMBERSHIP_LIMIT } from '@artifactbin/contracts';
import { effectiveRole } from '@/lib/artifact-access';
import { notifyArtifactSql } from '../table';
import { type ArtifactRow } from '@/lib/artifact-access';
import { getArtifactById, getArtifactHeaderById } from '../rows';
import { canAnnotate, canEdit, canRead } from '@artifactbin/contracts';
import { can } from '@/lib/artifact-access';

export class MembershipError extends DatasetError {
  constructor(message: string, status = 403) { super(message,status); }
}
const fail = (message: string, status = 403): never => { throw new MembershipError(message, status); };
async function opened(actor: AccessActor, id: string) {
  const artifact = await getArtifactById(id);
  if (!artifact) return fail('Artifact not found',404);
  const role = await effectiveRole(artifact,actor);
  if (!canRead(role)) return fail('Artifact not found',404);
  return { artifact, role };
}
async function account(actor: AccessActor, artifact: ArtifactRow) {
  if (!actor.userId || !(await can(actor,'comment',artifact))) fail('Sign in to participate');
  const db=await getDb();
  const user=(await db.query<{kind:string}>('SELECT kind FROM users WHERE id=$1',[actor.userId])).rows[0];
  if (!user || user.kind==='guest') fail('Sign in to participate');
  return actor.userId!;
}
const memberFields = 'm.user_id,u.username,u.name,m.status,m.direction,m.initiated_by,m.joined_at,m.explicit_join';
export async function membershipState(actor: AccessActor, id: string): Promise<MembershipState> {
  // The decision is made from the header; the document is read only if it could name a person (mentionStatesFor).
  const header = await getArtifactHeaderById(id);
  const role = header ? await effectiveRole(header,actor) : 'none';
  if (!header || !canRead(role)) return fail('Artifact not found',404);
  const db=await getDb();
  const rows=(await db.query<ArtifactMember>(`SELECT ${memberFields} FROM ${JOIN_RELATIONS} m JOIN users u ON u.id=m.user_id WHERE m.artifact_id=$1 AND (m.status='accepted' OR m.user_id=$2 OR ($3 AND m.status='pending')) ORDER BY m.joined_at NULLS LAST,u.username`,[id,actor.userId,canEdit(role)])).rows;
  const mentions=await mentionStatesFor(id,header.version);
  return {mentions,members:rows.filter(m=>m.status==='accepted'),pending:rows.filter(m=>m.status==='pending'),self:rows.find(m=>m.user_id===actor.userId)??null,canManage:canEdit(role),canInvite:!!actor.userId&&canAnnotate(role)};
}
async function blocked(tx: Queryable, a: string, b: string): Promise<boolean> {
  return !!(await tx.query('SELECT 1 FROM user_blocks WHERE (user_id=$1 AND blocked_user_id=$2) OR (user_id=$2 AND blocked_user_id=$1)',[a,b])).rows.length;
}
async function follows(tx: Queryable, follower: string, followed: string): Promise<boolean> {
  return !!(await tx.query("SELECT 1 FROM relations WHERE subject_kind='user' AND subject_id=$1 AND verb='follow' AND object_kind='user' AND object_id=$2 AND deleted_at IS NULL AND status='accepted'",[follower,followed])).rows.length;
}
/** Candidate eligibility is enforced again on send, including when an agent supplies raw IDs. */
export async function mentionCandidates(actor: AccessActor, id: string, query: string, purpose: 'mention' | 'invite' = 'mention'): Promise<Array<{user_id:string;username:string;name:string|null}>> {
  const {artifact,role}=await opened(actor,id);
  await account(actor,artifact);
  if(!canAnnotate(role))fail('Comment or edit access is required to invite people');
  const db=await getDb();
  return (await db.query<{user_id:string;username:string;name:string|null}>(`SELECT u.id AS user_id,u.username,u.name FROM users u WHERE u.kind IN ('account','testuser') AND u.username IS NOT NULL AND u.id<>$1
    AND (u.username ILIKE $3 OR COALESCE(u.name,'') ILIKE $3)
    AND ($4 OR EXISTS(SELECT 1 FROM relations r WHERE r.subject_kind='user' AND r.subject_id=u.id AND r.verb='follow' AND r.object_kind='user' AND r.object_id=$1 AND r.deleted_at IS NULL AND r.status='accepted')
      OR EXISTS(SELECT 1 FROM ${JOIN_RELATIONS} m WHERE m.artifact_id=$2 AND m.user_id=u.id AND m.status='accepted'))
    AND NOT EXISTS(SELECT 1 FROM user_blocks b WHERE (b.user_id=$1 AND b.blocked_user_id=u.id) OR (b.user_id=u.id AND b.blocked_user_id=$1))
    ORDER BY u.username LIMIT 30`,[actor.userId,id,query.replace(/^@/,'').replace(/[\\%_]/g,'\\$&')+'%',purpose==='invite'])).rows;
}
interface StoredMember {status:MembershipStatus;direction:MembershipDirection;initiated_by:string;revision:number;explicit_join:boolean}
/** One transaction owns the pair, the account's 30-slot budget, and its notification receipts. */
export async function changeMembership(actor: AccessActor, id: string, input: MembershipInput): Promise<MembershipState> {
  const {artifact,role}=await opened(actor,id), userId=await account(actor,artifact), db=await getDb();
  if(!['join','invite','accept','approve','dismiss','leave'].includes(input.action))fail('Unknown membership action',400);
  if(input.includeAccess&&(input.action!=='invite'||!canEdit(role)))fail('Only owners and editors can include access with an invitation');
  const targets: string[]=[];
  if(input.action==='invite') {
    if(!canAnnotate(role))fail('Comment or edit access is required to invite people');
    if(!Array.isArray(input.usernames)||!input.usernames.length||input.usernames.length>30)fail('Select between 1 and 30 usernames',400);
    for(const raw of new Set(input.usernames)) {
      if(typeof raw!=='string'||!/^@?[a-z0-9_]+$/i.test(raw))fail('Use @username',400);
      const found=(await db.query<{id:string}>('SELECT id FROM users WHERE username=$1',[raw.replace(/^@/,'').toLowerCase()])).rows[0];
      if(!found)fail('Person is not eligible for an invitation');
      if(!(await testAccountMayReach(userId,found.id)))fail('A test account invites only test accounts');
      targets.push(found.id);
    }
  } else targets.push(input.userId??userId);
  for(const target of targets) {
    if((input.action==='join'||input.action==='accept'||input.action==='leave')&&target!==userId)fail('This action is only for yourself');
    if(input.action==='approve'&&!canEdit(role))fail('Only owners and editors can approve requests');
    if(input.action==='dismiss'&&target!==userId&&!canEdit(role))fail('Only owners and editors can dismiss other requests');
    if(['invite','approve','accept'].includes(input.action)) {
      if(!canRead(await effectiveRole(artifact,identityForUser(target))) && !(input.action==='invite'&&input.includeAccess&&canEdit(role)))fail('Give this person access before inviting or approving them');
      if(!(await can(identityForUser(target),'comment',artifact)))fail('Person is not eligible for this artifact');
    }
  }
  await db.transaction(async tx=>{
    const current=(await artifactQuery<ArtifactRow>(tx,'SELECT * FROM artifacts WHERE id=$1 AND deleted_at IS NULL FOR UPDATE',[id])).rows[0];
    if(!current||current.user_id!==artifact.user_id||current.token_id!==artifact.token_id||(current.sharing_revision??0)!==(artifact.sharing_revision??0))fail('Artifact access changed; try again',409);
    await lockMembershipUsers(tx,[userId,...targets]);
    for(const target of targets) {
      if(input.action==='invite'){
        if(input.includeAccess&&!(await readThrough(tx,current,identityForUser(target)))){
          const recipient=(await tx.query<{email:string|null}>("SELECT email FROM users WHERE id=$1 AND kind='account'",[target])).rows[0];
          if(!recipient?.email)fail('This person cannot receive shared access');
          await tx.query("INSERT INTO artifact_shares(artifact_id,user_id,email,role) VALUES($1,$2,$3,'viewer') ON CONFLICT(artifact_id,email) DO NOTHING",[id,target,recipient.email]);
          await tx.query('UPDATE artifacts SET sharing_revision=sharing_revision+1 WHERE id=$1',[id]);
        }
        await invitePeople(tx,current,actor,[target],undefined,true);continue;
      }
      if(await blocked(tx,userId,target))fail('Person is not eligible for this invitation');
      const previous=(await tx.query<StoredMember>(`SELECT status,direction,initiated_by,revision,explicit_join FROM ${JOIN_RELATIONS} WHERE artifact_id=$1 AND user_id=$2`,[id,target])).rows[0];
      let status:MembershipStatus, direction:MembershipDirection=previous?.direction??'request',initiator=previous?.initiated_by??userId;
      let explicitJoin=previous?.explicit_join??false;
      if(previous?.status==='accepted'&&!explicitJoin&&(input.action==='join'||input.action==='accept')){
        await setRelationState(tx,target,'join',id,{status:'accepted',direction,initiatedBy:initiator,revision:previous.revision+1,explicitJoin:true});
        continue;
      }
      if(input.action==='join') {
        explicitJoin=true;
        if(previous?.status==='accepted'||(previous?.status==='pending'&&!canEdit(role)))continue;
        initiator=userId;
        direction='request';
        status=canEdit(role)?'accepted':'pending';
        if(status==='pending') {
          const count=Number((await tx.query<{n:string}>(`SELECT count(*) AS n FROM ${JOIN_RELATIONS} WHERE initiated_by=$1 AND status='pending'`,[userId])).rows[0]!.n);
          if(count>=PENDING_MEMBERSHIP_LIMIT)fail(`You already have ${PENDING_MEMBERSHIP_LIMIT} pending requests`,409);
        }
      } else if(input.action==='accept'||input.action==='approve') {
        if(previous?.status==='accepted')continue;
        if(previous?.status!=='pending')fail('No pending request',409);
        if(previous.direction==='invitation' && (input.action!=='accept'||target!==userId))fail('Only the recipient can accept an invitation');
        if(previous.direction==='request' && (input.action!=='approve'||!canEdit(role)))fail('Only owners and editors can approve a request');
        status='accepted';
        explicitJoin=input.action==='accept'||explicitJoin;
      } else {
        if(!previous||previous.status==='left'||previous.status==='dismissed')continue;
        if(input.action==='dismiss'&&previous.status!=='pending')fail('Only pending requests can be dismissed',409);
        status=input.action==='dismiss'?'dismissed':'left';
      }
      if(previous?.status==='pending'&&previous.direction==='invitation'&&(status==='dismissed'||status==='left'))
        await tx.query("UPDATE member_notifications SET kind='dismissed' WHERE artifact_id=$1 AND user_id=$2 AND sender_id=$3 AND kind='invitation'",[id,target,previous.initiated_by]);
      const revision=(previous?.revision??0)+1;
      await setRelationState(tx,target,'join',id,{status,direction,initiatedBy:initiator,revision,explicitJoin});
      await recordEvent(tx,{kind:'user',id:userId},status==='pending'?'join_requested':status==='accepted'?'joined':status==='left'?'left':'invitation_dismissed',{kind:'artifact',id},{user_id:target,revision});
    }
    await tx.query(`SELECT ${notifyArtifactSql('$1',"'members'")}`,[id]);
  });
  return membershipState(actor,id);
}

/** The saved artifact is already locked by the caller. Shared by UI, CLI and saved mentions. */
export async function invitePeople(tx:Queryable,artifact:ArtifactRow,actor:AccessActor,targets:string[],source?:string,explicitInvitation=false):Promise<void>{
 const sender=actor.userId;if(!sender)return fail('Sign in to mention people');
 await lockMembershipUsers(tx,[sender,...targets]);
 const identities=(await tx.query<{id:string;kind:string;auto_accept_mentions:boolean}>('SELECT id,kind,auto_accept_mentions FROM users WHERE id=ANY($1::text[]) AND (expires_at IS NULL OR expires_at>now())',[[sender,...targets,artifact.user_id]])).rows;
 const initiator=identities.find(u=>u.id===sender);
 if(!initiator||initiator.kind==='guest'||(initiator.kind==='testuser'&&identities.find(u=>u.id===artifact.user_id)?.kind!=='testuser'))fail('Sign in to mention people');
 for(const target of new Set(targets)){
  if(target===sender)continue;
  const recipient=identities.find(u=>u.id===target);
  if(!recipient||recipient.kind==='guest'||(recipient.kind==='testuser'&&identities.find(u=>u.id===artifact.user_id)?.kind!=='testuser')||await blocked(tx,sender,target))return fail('Person is not eligible for this invitation');
  const previous=(await tx.query<StoredMember>(`SELECT status,direction,initiated_by,revision,explicit_join FROM ${JOIN_RELATIONS} WHERE artifact_id=$1 AND user_id=$2`,[artifact.id,target])).rows[0];
  const follower=await follows(tx,target,sender);
  if(!explicitInvitation&&!follower&&previous?.status!=='accepted')fail('Person is not eligible for this invitation');
  if(!(await readThrough(tx,artifact,identityForUser(target))))fail('Give this person access before mentioning them');
  if(source&&(await tx.query('SELECT 1 FROM member_notifications WHERE artifact_id=$1 AND recipient_id=$2 AND source=$3',[artifact.id,target,source])).rows.length)continue;
  if(previous?.status==='pending'||(previous?.status==='accepted'&&!source))continue;
  if(previous?.status!=='accepted'&&(await tx.query("SELECT 1 FROM member_notifications WHERE sender_id=$1 AND recipient_id=$2 AND kind='dismissed'",[sender,target])).rows.length)fail('This person declined an earlier invitation; they can request to join instead');
  let kind='mention';
  if(previous?.status!=='accepted'){
   const status=recipient.auto_accept_mentions&&follower?'accepted':'pending';
   if(status==='pending'&&Number((await tx.query<{n:string}>(`SELECT count(*) AS n FROM ${JOIN_RELATIONS} WHERE initiated_by=$1 AND status='pending'`,[sender])).rows[0]!.n)>=PENDING_MEMBERSHIP_LIMIT)fail('You already have 30 pending requests',409);
   await setRelationState(tx,target,'join',artifact.id,{status,direction:'invitation',initiatedBy:sender,revision:(previous?.revision??0)+1});
   kind=status==='pending'?'invitation':'joined';
  }
  await recordEvent(tx,{kind:'user',id:sender},kind==='invitation'?'invited':kind==='joined'?'joined':'mentioned',{kind:'artifact',id:artifact.id},{user_id:target,revision:previous?.status==='accepted'?previous.revision:(previous?.revision??0)+1,mention_ref:source});
 }
 await tx.query(`SELECT ${notifyArtifactSql('$1',"'members'")}`,[artifact.id]);
}

/** The people a document's source names: every `/people/<id>` in it. Stored with the prepared page (`prepared_pages.mentions`) so nothing rescans the document for them. */
function mentionedPeople(source:string):string[]{
 return [...new Set([...source.matchAll(/\/people\/([A-Za-z0-9_-]{1,128})/g)].map(m=>m[1]!))];
}
/**
 * Mention states for a caller that holds the artifact's header and no document: the people the HEAD version
 * names come from its prepared page (`prepared_pages.mentions`, written when that version was prepared), so listing
 * members never reads the document. A version whose page is not prepared yet, or was prepared before the people were
 * stored, is read as ever — and only if its stored text mentions "people" at all, a superset of the `/people/<id>` the
 * scan looks for, decided by the database over the stored value — and the answer is stored for the next list. Same
 * answer either way.
 */
async function mentionStatesFor(id:string,version:number){
 const db=await getDb();
 const stored=(await db.query<{mentions:string[]|null}>("SELECT mentions FROM prepared_pages WHERE artifact_id=$1 AND slot='head' AND page_key=$2",[id,`v:${version}`])).rows[0]?.mentions;
 if(stored)return mentionStatesOfPeople(id,stored);
 const scan=(await db.query<{named:boolean;version:number}>("SELECT strpos(coalesce(document::text,'')||coalesce(source,''),'people')>0 AS named, version FROM artifacts WHERE id=$1 AND deleted_at IS NULL",[id])).rows[0];
 const read=scan?.named?await getArtifactById(id):null;
 const people=mentionedPeople(read?.source??'');
 // Stored under the version whose text was read, which may be newer than the header's: only that version's page takes it.
 const scanned=read?.version??scan?.version;
 if(scanned!==undefined)await db.query("UPDATE prepared_pages SET mentions=$3::text[] WHERE artifact_id=$1 AND slot='head' AND page_key=$2 AND mentions IS NULL",[id,`v:${scanned}`,people]);
 return mentionStatesOfPeople(id,people);
}
async function mentionStatesOfPeople(id:string,sourcePeople:string[]){
 const db=await getDb();
 const commented=(await db.query<{body:string}>('SELECT body FROM annotations WHERE artifact_id=$1 AND deleted_at IS NULL',[id])).rows.flatMap(r=>mentionedPeople(r.body));
 const mentioned=[...new Set([...sourcePeople,...commented])];
 return Object.fromEntries((await db.query<{user_id:string;status:MembershipStatus}>(`SELECT user_id,status FROM ${JOIN_RELATIONS} WHERE artifact_id=$1 AND user_id=ANY($2::text[])`,[id,mentioned])).rows.map(m=>[m.user_id,m.status]));
}
