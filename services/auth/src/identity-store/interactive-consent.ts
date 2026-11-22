/**
 * An explicit interactive grant binds a unique context to one service, group, authorizing account and personal
 * credential. The proof keeps the Admin tenure and the edges that reached it. Rejoining, promotion after
 * demotion, company readmission and moving a group back cannot recreate the original proof.
 */
import type {Queryable} from '@artifactbin/contracts/db';
import {IdentityError} from '@artifactbin/contracts/identity-module';
import type {ChatConsent, ServiceAudience, ServiceTokenParent} from '@artifactbin/contracts/service-audiences';
import {internalId} from './tables';

type Target = {contextId: string; groupId: string; service: ServiceAudience};
type Grant = Target & {grantId: string};
type Owner = {userId: string; parent: ServiceTokenParent};

function adminProofSql(auth: string, user: string, group: string): string {
  return `WITH RECURSIVE up(id, parent_id, edge, path) AS (
    SELECT id,parent_id,parent_edge_id,ARRAY[]::uuid[] FROM ${auth}.groups WHERE id=${group} AND deleted_at IS NULL
    UNION ALL
    SELECT p.id,p.parent_id,p.parent_edge_id,up.path || up.edge FROM up
      JOIN ${auth}.groups p ON p.id=up.parent_id WHERE p.deleted_at IS NULL AND cardinality(up.path)<10000
  )
  SELECT m.admin_tenure_id AS tenure,to_jsonb(up.path) AS path FROM up JOIN ${auth}.group_members m
    ON m.group_id=up.id AND m.user_id=${user} AND m.role='admin'`;
}

export function interactiveAdminHeldSql(auth: string, consent: string): string {
  return `EXISTS (SELECT 1 FROM (${adminProofSql(auth, `${consent}.subject_id`, `${consent}.group_id`)}) held
    JOIN ${auth}.users owner ON owner.id=${consent}.subject_id AND owner.interactive_authority_id::text=${consent}.payload->>'authority'
    WHERE held.tenure::text=${consent}.payload->>'tenure' AND held.path=${consent}.payload->'path')`;
}

export function interactiveParentLiveSql(read: string, kind: string, id: string, user: string): string {
  return `CASE WHEN ${kind}='token' THEN EXISTS (SELECT 1 FROM ${read}.tokens p
      WHERE p.id=${id} AND p.group_id IS NULL AND p.user_id=${user} AND p.issued_by IS NULL AND p.live)
    ELSE EXISTS (SELECT 1 FROM ${read}.sessions p WHERE p.id=${id} AND p."userId"=${user} AND p.live) END`;
}

export async function recordInteractiveConsent(db: Queryable, auth: string, read: string, input: Target & Owner): Promise<ChatConsent> {
  const keys = [input.service.id, input.service.origin, input.contextId, input.userId, input.parent.kind, input.parent.id, input.groupId];
  const liveParent = interactiveParentLiveSql(read, '$5::text', '$6', '$4');
  const result = await db.query<{grant_id: string | null}>(`WITH eligible AS (
      SELECT proof.tenure,proof.path,owner.interactive_authority_id FROM (${adminProofSql(auth, '$4', '$7')}) proof
      JOIN ${read}.users u ON u.id=$4 AND u.active AND u.kind='account' AND NOT u.test_account
      JOIN ${auth}.users owner ON owner.id=u.id
      JOIN ${auth}."user" verified ON verified.id=u.id AND verified."emailVerified"
      WHERE ${liveParent} ORDER BY jsonb_array_length(proof.path) LIMIT 1
    ), inserted AS (
      INSERT INTO ${auth}.credentials(kind,credential_hash,subject_id,group_id,payload,expires_at)
      SELECT 'interactive_consent',$8,$4,$7,jsonb_build_object('service',$1::text,'origin',$2::text,
        'context',$3::text,'parent_kind',$5::text,'parent_id',$6::text,'tenure',eligible.tenure,'path',eligible.path,
        'authority',eligible.interactive_authority_id),'infinity'
      FROM eligible ON CONFLICT DO NOTHING RETURNING credential_hash
    )
    SELECT (SELECT credential_hash FROM inserted) AS grant_id FROM eligible`, [...keys, `icg_${internalId()}`]);
  if (!result.rows.length) throw new IdentityError('group_level_not_held', 403);
  // A concurrently inserted consent is visible in this new statement after ON CONFLICT has waited for it.
  const grantId = result.rows[0]!.grant_id ?? (await db.query<{credential_hash: string}>(`SELECT c.credential_hash FROM ${auth}.credentials c
    WHERE c.kind='interactive_consent' AND c.payload->>'service'=$1 AND c.payload->>'origin'=$2 AND c.payload->>'context'=$3
      AND c.subject_id=$4 AND c.payload->>'parent_kind'=$5 AND c.payload->>'parent_id'=$6 AND c.group_id=$7
      AND c.deleted_at IS NULL AND ${liveParent} AND ${interactiveAdminHeldSql(auth, 'c')}`, keys)).rows[0]?.credential_hash;
  if (!grantId) throw new IdentityError('context_conflict', 409);
  return {grant_id:grantId,user_id:input.userId,group_id:input.groupId,group_role:'admin'};
}

export async function revokeInteractiveConsent(db: Queryable, auth: string, input: Grant): Promise<void> {
  const result = await db.query(`UPDATE ${auth}.credentials SET deleted_at=COALESCE(deleted_at,now())
    WHERE kind='interactive_consent' AND credential_hash=$1 AND payload->>'service'=$2 AND payload->>'origin'=$3
      AND payload->>'context'=$4 AND group_id=$5 RETURNING credential_hash`,
    [input.grantId,input.service.id,input.service.origin,input.contextId,input.groupId]);
  if (!result.rows.length) throw new IdentityError('grant_refused',403);
}
