/** Whether an account may act on this deployment: public deployments admit everyone, company deployments their admitted members and those members' test accounts. */
import type {Queryable} from '@artifactbin/contracts/db';
import { getDb, deploymentConfig } from '../platform';
import { isDeploymentMember } from '@artifactbin/auth';

/** Read current admission for a credential’s account. */
export async function canUseDeploymentIdentity(userId:string|null|undefined,query?:Queryable):Promise<boolean> {
 if(deploymentConfig().mode==='public')return true;
 if(!userId)return false;
 return isDeploymentMember(query??await getDb(),userId);
}
