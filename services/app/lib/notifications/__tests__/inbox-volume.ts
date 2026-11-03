/**
 * A PRODUCTION-SHAPED INBOX: one recipient with many artifacts, each carrying comment, mention,
 * and follow notifications across every access path the inbox decides — a named share
 * awaiting resolution, the link (viewer and commenter), a group, the recipient's own documents and no
 * access at all — plus deleted comments, deleted artifacts and blocked senders.
 * Ids and timestamps are deterministic, so two runs over the same range produce identical inboxes.
 */
import {nativeHtml} from '@/__tests__/native-html-fixture';
import { POST as create } from '@/app/api/artifacts/route';
import { mintAccountToken, request } from '@/__tests__/harness';
import type { Queryable } from '@artifactbin/contracts';

export const RECIPIENT = { id: 'vol-recipient', email: 'vol-recipient@example.com' };
const SENDERS = ['vol-s0', 'vol-s1', 'vol-s2', 'vol-s3'];
const BLOCKED = 'vol-blocked';
const GROUP = 'vol-group';

export interface InboxVolume { template: string }

/** Users, a group and a large template document. */
export async function inboxVolumeBase(db: Queryable): Promise<InboxVolume> {
  await db.query("INSERT INTO users(id,email,kind,username,name) VALUES($1,$2,'account','volrecipient','Recipient')", [RECIPIENT.id, RECIPIENT.email]);
  for (const [i, id] of [...SENDERS, BLOCKED].entries()) await db.query("INSERT INTO users(id,email,kind,username,name,image_key) VALUES($1,$2,'account',$3,$4,$5)", [id, `${id}@example.com`, `volsender${i}`, `Sender ${i}`, i % 2 ? `avatars/${id}` : null]);
  await db.query('INSERT INTO user_blocks(user_id,blocked_user_id) VALUES($1,$2)', [RECIPIENT.id, BLOCKED]);
  await db.query("INSERT INTO groups(id,handle,name,created_by) VALUES($1,'vol-group','Volume',$2)", [GROUP, SENDERS[0]]);
  await db.query("INSERT INTO group_members(group_id,user_id,role) VALUES($1,$2,'editor'),($1,$3,'viewer')", [GROUP, SENDERS[0], RECIPIENT.id]);
  const token = await mintAccountToken('volume', SENDERS[0]);
  const publish = async (body: object) => (await (await create(request('/api/artifacts', { method: 'POST', token: token.token, json: body }))).json()) as { id: string };
  const markup = Array.from({ length: 150 }, (_, i) => `<h2>Section ${i}</h2><p>Paragraph ${i} of a production-sized document, with <strong>inline</strong> markup and a <a href="https://example.com/${i}">link</a>.</p>`).join('');
  const template = await publish({ html:nativeHtml(markup), visibility: 'unlisted' });
  return { template: template.id };
}

/**
 * Artifacts `from`..`to` (inclusive) and their notifications, in set-based statements. Kinds rotate
 * by index: 0 unlisted, 1 private named commenter share (unresolved), 2 private group-owned
 * (recipient a group viewer), 3 private with no access, 4 public link commenter, 5 the recipient's own.
 */
export async function seedInboxVolume(db: Queryable, base: InboxVolume, from: number, to: number): Promise<void> {
  const params = [from, to, base.template, SENDERS, RECIPIENT.id, GROUP, BLOCKED];
  const series = 'generate_series($1::int,$2::int) i';
  const owner = `CASE WHEN i%6=5 THEN $5::text WHEN i%13=0 THEN $7::text ELSE ($4::text[])[1+i%4] END`;
  /** Every 13th notification comes from the sender the recipient blocked. */
  const senderOf = (blocked: string, senders: string) => `CASE WHEN i%13=0 THEN ${blocked}::text ELSE (${senders}::text[])[1+i%4] END`;
  await db.query(`INSERT INTO artifacts(id,token_id,user_id,group_id,visibility,link_role,format,document,meta,title,created_at,updated_at,deleted_at)
    SELECT 'vol-a'||i,t.token_id,CASE WHEN i%6=2 THEN NULL ELSE ${owner} END,CASE WHEN i%6=2 THEN $6::text END,
     CASE i%6 WHEN 0 THEN 'unlisted' WHEN 4 THEN 'public' ELSE 'private' END,CASE WHEN i%6=4 THEN 'commenter' END,
     'html',t.document,t.meta,'Volume '||i,timestamptz '2026-01-01'+i*interval '1 minute',timestamptz '2026-01-01'+i*interval '1 minute',
     CASE WHEN i%17=0 THEN timestamptz '2026-06-01' END
    FROM artifacts t,${series} WHERE t.id=$3`, params);
  await db.query(`INSERT INTO artifact_shares(artifact_id,email,role) SELECT 'vol-a'||i,$3,'commenter' FROM ${series} WHERE i%6=1`, [from, to, RECIPIENT.email]);
  await db.query(`INSERT INTO relations(subject_kind,subject_id,verb,object_kind,object_id,status,direction,initiated_by,accepted_at,explicit_join)
    SELECT 'user',$3,'join','artifact','vol-a'||i,CASE WHEN i%10=9 THEN 'pending' ELSE 'accepted' END,'request',$3,timestamptz '2026-01-01',i%10<>8 FROM ${series}`, [from, to, RECIPIENT.id]);
  await db.query(`INSERT INTO annotations(id,artifact_id,root_id,body,author_kind,author_user_id,author_label,deleted_at)
    SELECT 'vol-r'||i,'vol-a'||i,NULL,'Comment '||i,'human',($3::text[])[1+i%4],'Sender',CASE WHEN i%7=0 THEN timestamptz '2026-06-01' END FROM ${series}`, [from, to, SENDERS]);
  const sender = senderOf('$5', '$3');
  await db.query(`INSERT INTO member_notifications(id,artifact_id,user_id,recipient_id,sender_id,kind,source,revision,seen_revision,read_at,created_at)
    SELECT 'vol-c'||i,'vol-a'||i,$4,$4,${sender},'reply','comment:vol-r'||i,2,CASE WHEN i%3=0 THEN 2 ELSE 0 END,CASE WHEN i%3=0 THEN timestamptz '2026-07-01' END,timestamptz '2026-02-01'+i*interval '3 minutes' FROM ${series}
    UNION ALL SELECT 'vol-m'||i,'vol-a'||i,$4,$4,${sender},CASE WHEN i%8=0 THEN 'dismissed' ELSE 'mention' END,NULL,1,0,NULL,timestamptz '2026-02-01'+i*interval '3 minutes'+interval '1 minute' FROM ${series}
    UNION ALL SELECT 'vol-f'||i,NULL,$4,$4,${sender},'follow',NULL,1,0,NULL,timestamptz '2026-02-01'+i*interval '3 minutes' FROM ${series} WHERE i%5=0`, [from, to, SENDERS, RECIPIENT.id, BLOCKED]);
}
