/** Whether an account may act on this deployment: public deployments admit everyone, company deployments their admitted members and those members' test accounts. */
import { getDb, type Queryable, deploymentConfig } from '../platform';
import { authenticatingTestParent } from '../user-kinds';

/** Credential IDs already admitted remain valid when policy or defaults change. */
export async function canUseDeploymentIdentity(userId:string|null|undefined,query?:Queryable):Promise<boolean> {
 if(deploymentConfig().mode==='public')return true;
 if(!userId)return false;
 const db=query??await getDb();
 return (await db.query('SELECT user_id FROM deployment_members WHERE user_id=$1',[userId])).rows.length>0||await canUseDelegatedDeploymentIdentity(userId,db);
}

async function canUseDelegatedDeploymentIdentity(userId:string,db:Queryable):Promise<boolean> {
 const parent=await authenticatingTestParent(userId,db);
 if(!parent)return false;
 return (await db.query("SELECT m.user_id FROM deployment_members m JOIN deployment_state s ON s.id='company' WHERE m.user_id=$1 AND s.setup_complete=true",[parent])).rows.length>0;
}
