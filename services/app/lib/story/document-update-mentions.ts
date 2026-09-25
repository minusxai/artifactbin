/** Saved-mention effects in the document's existing statement. Authorization of
 * recipients remains server-owned even though document semantics are trusted. */
import {PENDING_MEMBERSHIP_LIMIT,type DocumentUpdate} from '@artifactbin/contracts';
import type {TokenActor} from '../artifacts';
import {envelope} from '../events';
import {notificationChannel} from '../notifications';
import {JOIN_RELATIONS} from '../relation-state';
export function documentMentionSql(actor:TokenActor|null,id:string,mentions:DocumentUpdate['mentions'],param:(value:unknown)=>string,visibility:string,shares:string,dryRun:boolean){
 if(!mentions?.length)return {before:'',guard:'TRUE',after:'',refusal:'NULL::text'};
 const inputs=param(JSON.stringify(mentions.map(m=>{
  const source=`node:${m.nodeId}`,notificationId=`${id}:${m.userId}:${source}`;
  return {...m,source,notificationId,channel:notificationChannel(m.userId),
   event:envelope(actor?.userId?{kind:'user',id:actor.userId}:null,'mentioned',{kind:'artifact',id},{user_id:m.userId,revision:0,mention_ref:source}),
   notificationEvent:envelope({kind:'user',id:m.userId},'notification_changed',{kind:'user',id:m.userId},{notification_id:notificationId,revision:1,change:'updated'})};
 })));
 const before=`mention_input AS MATERIALIZED (SELECT DISTINCT ON(x->>'nodeId',x->>'userId') x FROM jsonb_array_elements(${inputs}::jsonb) x),
 mention_users AS MATERIALIZED (
  SELECT u.* FROM users u WHERE u.id=$4 OR u.id IN(SELECT x->>'userId' FROM mention_input) OR u.id=(SELECT user_id FROM locked)
  ORDER BY u.id ${dryRun?'':'FOR UPDATE OF u'}
 ), mention_candidates AS MATERIALIZED (
  SELECT i.x,t.id AS target,t.kind AS target_kind,t.expires_at AS target_expiry,s.id AS sender,s.kind AS sender_kind,s.expires_at AS sender_expiry,o.kind AS owner_kind,
   m.status AS previous_status,m.revision AS previous_revision,
   EXISTS(SELECT 1 FROM relations r WHERE r.subject_kind='user' AND r.subject_id=t.id AND r.verb='follow' AND r.object_kind='user' AND r.object_id=$4 AND r.deleted_at IS NULL AND r.status='accepted') AS follows,
   EXISTS(SELECT 1 FROM user_blocks b WHERE (b.user_id=$4 AND b.blocked_user_id=t.id) OR (b.user_id=t.id AND b.blocked_user_id=$4)) AS blocked,
   EXISTS(SELECT 1 FROM member_notifications n WHERE n.artifact_id=$1 AND n.recipient_id=t.id AND n.source=i.x->>'source') AS already_notified,
   EXISTS(SELECT 1 FROM member_notifications n WHERE n.sender_id=$4 AND n.recipient_id=t.id AND n.kind='dismissed') AS dismissed,
   (l.user_id=t.id OR COALESCE(${visibility}::text,l.visibility)<>'private' OR CASE WHEN ${shares}::jsonb IS NULL THEN
    EXISTS(SELECT 1 FROM artifact_shares sh WHERE sh.artifact_id=$1 AND (sh.user_id=t.id OR(sh.user_id IS NULL AND sh.email=t.email))) ELSE
    EXISTS(SELECT 1 FROM jsonb_array_elements(${shares}::jsonb) sh LEFT JOIN artifact_shares old ON old.artifact_id=$1 AND old.email=sh->>'email'
     WHERE old.user_id=t.id OR(old.user_id IS NULL AND sh->>'email'=t.email)) END) AS readable,
   t.auto_accept_mentions,row_number() OVER(PARTITION BY t.id ORDER BY i.x->>'nodeId') AS target_order
  FROM mention_input i CROSS JOIN locked l LEFT JOIN mention_users s ON s.id=$4 LEFT JOIN mention_users t ON t.id=i.x->>'userId'
   LEFT JOIN mention_users o ON o.id=l.user_id LEFT JOIN ${JOIN_RELATIONS} m ON m.artifact_id=l.id AND m.user_id=t.id
  WHERE i.x->>'userId' IS DISTINCT FROM $4
 ), mention_actions AS MATERIALIZED (
  SELECT c.*,CASE WHEN previous_status='accepted' OR(auto_accept_mentions AND follows) THEN 'accepted' ELSE 'pending' END AS next_status
  FROM mention_candidates c WHERE NOT already_notified AND previous_status IS DISTINCT FROM 'pending' AND (previous_status='accepted' OR target_order=1)
 ), mention_refusal AS MATERIALIZED (
  SELECT 'Sign in to mention people'::text AS reason WHERE EXISTS(SELECT 1 FROM mention_input) AND NOT EXISTS(SELECT 1 FROM mention_users s CROSS JOIN locked l LEFT JOIN mention_users o ON o.id=l.user_id
   WHERE s.id=$4 AND s.kind<>'guest' AND (s.kind<>'testuser' OR o.kind='testuser') AND(s.expires_at IS NULL OR s.expires_at>now()))
  UNION ALL SELECT 'Person is not eligible for this invitation' WHERE EXISTS(SELECT 1 FROM mention_candidates WHERE target IS NULL OR target_kind='guest'
   OR(target_kind='testuser' AND owner_kind IS DISTINCT FROM 'testuser') OR target_expiry<=now() OR blocked OR NOT COALESCE(readable,false)
   OR (NOT follows AND previous_status IS DISTINCT FROM 'accepted') OR(dismissed AND previous_status IS DISTINCT FROM 'accepted'))
  UNION ALL SELECT 'You already have ${PENDING_MEMBERSHIP_LIMIT} pending requests' WHERE
   (SELECT count(*) FROM ${JOIN_RELATIONS} m WHERE m.initiated_by=$4 AND m.status='pending')+(SELECT count(*) FROM mention_actions WHERE next_status='pending')>${PENDING_MEMBERSHIP_LIMIT}
 ),`;
 const after=`mention_relations AS (
  INSERT INTO relations(subject_kind,subject_id,verb,object_kind,object_id,status,direction,initiated_by,accepted_at,revision,deleted_at)
  SELECT 'user',a.target,'join','artifact',$1,a.next_status,'invitation',$4,CASE WHEN a.next_status='accepted' THEN now() END,COALESCE(a.previous_revision,0)+1,NULL
  FROM mention_actions a WHERE a.previous_status IS DISTINCT FROM 'accepted' AND EXISTS(SELECT 1 FROM updated)
  ON CONFLICT(subject_kind,subject_id,verb,object_kind,object_id) DO UPDATE SET status=EXCLUDED.status,direction=EXCLUDED.direction,initiated_by=EXCLUDED.initiated_by,accepted_at=EXCLUDED.accepted_at,revision=EXCLUDED.revision,deleted_at=NULL
 ), mention_events AS (
  INSERT INTO event_outbox(id,envelope)
  SELECT a.x#>>'{event,id}',(a.x->'event')||jsonb_build_object('verb',CASE WHEN a.previous_status='accepted' THEN 'mentioned' WHEN a.next_status='pending' THEN 'invited' ELSE 'joined' END,
   'payload',(a.x#>'{event,payload}')||jsonb_build_object('revision',CASE WHEN a.previous_status='accepted' THEN a.previous_revision ELSE COALESCE(a.previous_revision,0)+1 END))
  FROM mention_actions a WHERE EXISTS(SELECT 1 FROM updated) ON CONFLICT DO NOTHING
 ), mention_notifications AS (
  INSERT INTO member_notifications(id,artifact_id,user_id,recipient_id,sender_id,kind,source,source_event_id)
  SELECT a.x->>'notificationId',$1,a.target,a.target,$4,CASE WHEN a.previous_status='accepted' THEN 'mention' WHEN a.next_status='pending' THEN 'invitation' ELSE 'joined' END,a.x->>'source',a.x#>>'{event,id}'
  FROM mention_actions a WHERE EXISTS(SELECT 1 FROM updated) ON CONFLICT DO NOTHING RETURNING id,recipient_id,revision
 ), mention_notification_events AS (
  INSERT INTO event_outbox(id,envelope)
  SELECT a.x#>>'{notificationEvent,id}',a.x->'notificationEvent' FROM mention_notifications n JOIN mention_actions a ON n.id=a.x->>'notificationId' ON CONFLICT DO NOTHING
 ), mention_existing_seeds AS MATERIALIZED (
  SELECT a.x,n.id AS notification_id,n.revision,gen_random_uuid()::text AS event_id
  FROM mention_actions a JOIN member_notifications n ON n.artifact_id=$1 AND n.user_id=a.target
  WHERE a.next_status='accepted' AND a.previous_status IS DISTINCT FROM 'accepted' AND EXISTS(SELECT 1 FROM updated)
 ), mention_existing_events AS (
  INSERT INTO event_outbox(id,envelope)
  SELECT event_id,(x->'notificationEvent')||jsonb_build_object('id',event_id,'payload',(x#>'{notificationEvent,payload}')||jsonb_build_object('notification_id',notification_id,'revision',revision))
  FROM mention_existing_seeds ON CONFLICT DO NOTHING
 ), mention_wake AS MATERIALIZED (
  SELECT pg_notify(a.x->>'channel',a.x->>'notificationId') FROM mention_actions a WHERE EXISTS(SELECT 1 FROM updated)
 ),`;
 return {before,guard:'NOT EXISTS(SELECT 1 FROM mention_refusal)',after,refusal:'(SELECT reason FROM mention_refusal LIMIT 1)'};
}
