/** Whether an account may act on this deployment: public deployments admit everyone, company deployments their admitted members and those members' test accounts. */
import { getDb, type Queryable, deploymentConfig } from '../platform';
import { deploymentMemberSql } from '@artifactbin/auth/identity-store/rules';

/** An admitted member of a company deployment (directly or as a member's live test user): the identity module's one spelling. */
export { deploymentMemberSql } from '@artifactbin/auth/identity-store/rules';

/** Credential IDs already admitted remain valid when policy or defaults change. */
export async function canUseDeploymentIdentity(userId:string|null|undefined,query?:Queryable):Promise<boolean> {
 if(deploymentConfig().mode==='public')return true;
 if(!userId)return false;
 const db=query??await getDb();
 return (await db.query<{admitted:boolean}>(`SELECT ${deploymentMemberSql('$1::text')} AS admitted`,[userId])).rows[0]?.admitted===true;
}
