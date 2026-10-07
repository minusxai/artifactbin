import type {RunnerService} from '@artifactbin/contracts';
import type {RemoteSessionInfo} from '../../../contracts/src/remote';
import type {Db} from '../platform/db';
import {admitManagedRun} from './managed-runs';
import {isTerminalManagedRun} from './managed-status';
/** Work admission is durable; idle/expired compute is recreated only when there is pending work. */
export async function wakeManagedAgents(db:Db,runner:RunnerService){
 const rows=(await db.query<{owner:string;info:RemoteSessionInfo}>("SELECT a.owner,a.info FROM remote_agents a WHERE a.active=true AND a.info->>'hostedGeneration' IS NOT NULL AND EXISTS(SELECT 1 FROM remote_work w WHERE w.session_id=a.id AND w.owner=a.owner AND w.phase IN ('queued','dispatching','delivered','acknowledged','uncertain')) ORDER BY a.seen_at LIMIT 100")).rows;
 for(const {owner,info} of rows){
  if(!info.runId||!info.hostedConfig)continue;
  try{
   const run=await runner.getRun({userId:owner,runId:info.runId});
   if(!isTerminalManagedRun(run.status))continue;
   await admitManagedRun(owner,{...info.hostedConfig,name:info.name,requestId:'wake:'+info.runId},db,runner,info.runId);
  }catch{/* Admission and transport failures retain queued work for the next tick. */}
 }
}
