/** Operator-run company root backfill. The account binding proves a handle sign-in. For an email subject
 * only creating an issuer group leaves comparable provenance. Membership, admission and sessions alone
 * can all come from a manual invitation. Other email subjects join on their next verified sign-in.
 * Older handlers committed identity before admission. Only count evidence at or after company admission.
 */
import type {TransactionalQueryable} from '@artifactbin/contracts/identity-module';
import {identityTables} from './tables';
import {companySignInRoot} from './company-group';
import {plainIdentifier} from './views';

export function backfillTrustedRoot(db:TransactionalQueryable, authSchema:string, appSchema:string) {
  const t = identityTables(authSchema), app = plainIdentifier(appSchema,'app schema');
  return db.transaction(async tx => {
    await tx.query("SELECT pg_advisory_xact_lock(hashtext('artifactbin.identity.trusted-sign-in'))");
    const company = await companySignInRoot(tx,t.groups,app);
    if (!company) return 0;
    if (!company.rootId) throw new Error('Company root unavailable');
    const result = await tx.query<{added:number}>(`WITH signed_in(user_id,verified_at) AS (
      SELECT "userId","createdAt" FROM ${authSchema}.account WHERE "providerId" LIKE 'trusted:%'
      UNION ALL SELECT created_by,created_at FROM ${t.groups} WHERE trusted_issuer IS NOT NULL
    ), added AS (INSERT INTO ${t.group_members}(group_id,user_id,role)
      SELECT DISTINCT $1::text,u.id,'member' FROM signed_in s JOIN ${t.users} u ON u.id=s.user_id
      JOIN ${app}.deployment_members m ON m.user_id=u.id WHERE u.kind='account' AND m.admitted_at<=s.verified_at
      ON CONFLICT (group_id,user_id) DO NOTHING RETURNING 1) SELECT count(*)::int AS added FROM added`,[company.rootId]);
    return result.rows[0]!.added;
  });
}
