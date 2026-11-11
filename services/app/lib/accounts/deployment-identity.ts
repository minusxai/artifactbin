/** Whether an account may act on this deployment: public deployments admit everyone, company deployments their admitted members and those members' test accounts. */
import { getDb, type Queryable, deploymentConfig } from '../platform';
import { liveTestuserWithParentSql } from '../user-kinds';

/**
 * SQL over the user whose id is the SQL expression `id`: an admitted member of a company deployment, directly or
 * as the live test user of one once setup is complete. The mode is NOT in it: a public deployment admits everyone
 * before asking. The ONE spelling `canUseDeploymentIdentity` runs and the shared `identity.users` view
 * (lib/groups identity-views) is built from.
 */
export const deploymentMemberSql = (id: string): string => `(EXISTS (SELECT 1 FROM deployment_members dm WHERE dm.user_id=${id})
  OR EXISTS (SELECT 1 FROM users tu JOIN deployment_members pm ON pm.user_id=tu.parent_user_id JOIN deployment_state ds ON ds.id='company' AND ds.setup_complete=true
   WHERE tu.id=${id} AND ${liveTestuserWithParentSql('tu')}))`;

/** Credential IDs already admitted remain valid when policy or defaults change. */
export async function canUseDeploymentIdentity(userId:string|null|undefined,query?:Queryable):Promise<boolean> {
 if(deploymentConfig().mode==='public')return true;
 if(!userId)return false;
 const db=query??await getDb();
 return (await db.query<{admitted:boolean}>(`SELECT ${deploymentMemberSql('$1::text')} AS admitted`,[userId])).rows[0]?.admitted===true;
}
