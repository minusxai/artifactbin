/** A service's consent for one schedule revision, fenced by the direct seat that granted it. */
import type { Queryable } from '@artifactbin/contracts/db';
import { IdentityError } from '@artifactbin/contracts/identity-module';
import type { ScheduleConsent, ServiceAudience } from '@artifactbin/contracts/service-audiences';
import { internalId } from './tables';

type Schedule = {id: string; revision: string; service: ServiceAudience};
type Consent = Schedule & {userId: string; groupId: string};

export function scheduleSeatSql(auth: string, alias: string): string {
  return `EXISTS (SELECT 1 FROM ${auth}.group_members seat JOIN ${auth}.groups g ON g.id=seat.group_id AND g.deleted_at IS NULL
    WHERE seat.group_id=${alias}.group_id AND seat.user_id=${alias}.subject_id AND seat.role IN ('member','admin') AND seat.seat_id::text=${alias}.payload->>'seat')`;
}

export async function recordScheduleConsent(db: Queryable, auth: string, read: string, input: Consent): Promise<ScheduleConsent> {
  const keys = [input.service.id, input.service.origin, input.id, input.revision, input.userId, input.groupId];
  const rows = await db.query<{grant_id: string | null}>(`WITH eligible AS (
      SELECT m.seat_id FROM ${auth}.group_members m JOIN ${auth}.groups g ON g.id=m.group_id AND g.deleted_at IS NULL
      JOIN ${read}.users u ON u.id=m.user_id AND u.active AND u.kind='account' AND NOT u.test_account
      JOIN ${auth}."user" verified ON verified.id=u.id AND verified."emailVerified"
      WHERE m.user_id=$5 AND m.group_id=$6 AND m.role IN ('member','admin')
    ), inserted AS (
      INSERT INTO ${auth}.credentials(kind,credential_hash,subject_id,group_id,payload,expires_at)
      SELECT 'schedule_consent',$7,$5,$6,jsonb_build_object('service',$1::text,'origin',$2::text,
        'schedule',$3::text,'revision',$4::text,'seat',eligible.seat_id),'infinity' FROM eligible
      WHERE NOT EXISTS (SELECT 1 FROM ${auth}.credentials prior WHERE prior.kind='schedule_consent'
        AND prior.payload->>'service'=$1 AND prior.payload->>'schedule'=$3
        AND (prior.group_id<>$6 OR prior.payload->>'origin'<>$2))
      ON CONFLICT DO NOTHING RETURNING credential_hash
    )
    SELECT (SELECT credential_hash FROM inserted) AS grant_id FROM eligible`, [...keys, `scg_${internalId()}`]);
  if (!rows.rows.length) throw new IdentityError('group_level_not_held', 403);
  // READ COMMITTED sees the winning concurrent insert after ON CONFLICT waited for it.
  const grantId = rows.rows[0]!.grant_id ?? (await db.query<{credential_hash:string}>(`SELECT c.credential_hash FROM ${auth}.credentials c
    WHERE c.kind='schedule_consent' AND c.payload->>'service'=$1 AND c.payload->>'origin'=$2 AND c.payload->>'schedule'=$3
      AND c.payload->>'revision'=$4 AND c.subject_id=$5 AND c.group_id=$6 AND c.deleted_at IS NULL AND ${scheduleSeatSql(auth, 'c')}`, keys)).rows[0]?.credential_hash;
  if (!grantId) throw new IdentityError('schedule_conflict', 409);
  return {grant_id:grantId,user_id:input.userId,group_id:input.groupId,group_role:'member'};
}

const grantScope = `kind='schedule_consent' AND credential_hash=$1 AND payload->>'service'=$2 AND payload->>'origin'=$3
  AND payload->>'schedule'=$4 AND payload->>'revision'=$5`;
const grantKeys = (input: Schedule & {grantId:string}) => [input.grantId,input.service.id,input.service.origin,input.id,input.revision];

export async function readScheduleConsent(db:Queryable,auth:string,input:Schedule & {grantId:string}): Promise<{subject_id:string;group_id:string}> {
  const row = (await db.query<{subject_id:string;group_id:string}>(`SELECT subject_id,group_id FROM ${auth}.credentials WHERE ${grantScope} AND deleted_at IS NULL`,grantKeys(input))).rows[0];
  if (!row) throw new IdentityError('grant_refused',403);
  return row;
}

export async function revokeScheduleConsent(db:Queryable,auth:string,input:Schedule & {grantId:string}):Promise<void> {
  const result = await db.query(`UPDATE ${auth}.credentials SET deleted_at=COALESCE(deleted_at,now()) WHERE ${grantScope} RETURNING credential_hash`,grantKeys(input));
  if (!result.rows.length) throw new IdentityError('grant_refused',403);
}
