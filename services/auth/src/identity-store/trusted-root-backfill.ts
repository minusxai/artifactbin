/** Enabled identity-host boot. A current issuer seat must predate proof of verified sign-in, and the person
 * must already have been admitted at that time. Legacy handle bindings and issuer group creation can prove
 * this for some historical people. Other historical email subjects wait for their next verified sign-in.
 * Record completion with the grant so a boot retry cannot restore a root membership someone later removed.
 */
import type {TransactionalQueryable} from '@artifactbin/contracts/identity-module';
import {joinsCompanyRoot,trustedIssuersOf} from '../identity/trusted-issuers';
import {identityTables} from './tables';
import {companySignInRoot} from './company-group';
import {plainIdentifier} from './views';

export async function backfillTrustedRoot(db:TransactionalQueryable, env:Record<string,string|undefined>, authSchema:string, appSchema?:string) {
  if (!joinsCompanyRoot(env)) return;
  const issuers = [...trustedIssuersOf(env).keys()];
  if (!issuers.length) return;
  const t = identityTables(authSchema), prefix = appSchema ? plainIdentifier(appSchema,'app schema')+'.' : '';
  await db.transaction(async tx => {
    await tx.query("SELECT pg_advisory_xact_lock(hashtext('artifactbin.identity.trusted-sign-in'))");
    const company = await companySignInRoot(tx,t.groups,appSchema);
    if (!company) return;
    if (!company.rootId) throw new Error('Company root unavailable');
    await tx.query(`WITH eligible AS (
      SELECT DISTINCT u.id FROM ${t.users} u
      JOIN ${prefix}deployment_members d ON d.user_id=u.id
      JOIN ${t.group_members} m ON m.user_id=u.id
      JOIN ${t.groups} g ON g.id=m.group_id AND g.deleted_at IS NULL AND g.trusted_issuer=ANY($2::text[])
      WHERE u.kind='account' AND u.trusted_root_granted IS DISTINCT FROM $1 AND (
        (u.trusted_sign_in_group=g.id AND u.trusted_sign_in_at>=greatest(m.created_at,d.admitted_at))
        OR (g.created_by=u.id AND g.created_at>=greatest(m.created_at,d.admitted_at))
        OR EXISTS (SELECT 1 FROM ${authSchema}.account a WHERE a."userId"=u.id
          AND a."providerId"='trusted:'||g.trusted_issuer AND a."createdAt">=greatest(m.created_at,d.admitted_at)))
    ), recorded AS (
      UPDATE ${t.users} SET trusted_root_granted=$1 WHERE id IN (SELECT id FROM eligible) RETURNING id
    )
    INSERT INTO ${t.group_members}(group_id,user_id,role) SELECT $1,id,'member' FROM recorded
    ON CONFLICT (group_id,user_id) DO NOTHING`, [company.rootId,issuers]);
  });
}
