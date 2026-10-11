import type {RemoteSessionInfo} from '../../../contracts/src/remote';
import { setHostedRequestAuthority } from '../accounts';
import type { HostedRemoteAgent } from '@artifactbin/contracts';
export type { HostedRemoteAgent } from '@artifactbin/contracts';
let hosted: HostedRemoteAgent | undefined;
export function setHostedRemoteAgent(value: HostedRemoteAgent | undefined) { hosted = value; snapshots.clear(); setHostedRequestAuthority(value); }
export const hostedRemoteAgent = () => hosted;

const snapshots=new Map<string,{agent:HostedRemoteAgent;session:RemoteSessionInfo|null;at:number}>();
/** Read-only status refresh occurs outside annotation transactions. Snapshot
 * projection performs no service calls and never wakes an idle default agent. */
export async function refreshHostedStatus(owner:string):Promise<void>{
 const agent=hosted;if(!agent?.status)return;
 let session:RemoteSessionInfo|null=null;
 try{session=await agent.status(owner);}catch{/* An unreachable agent is not online. */}
 if(hosted===agent)snapshots.set(owner,{agent,session,at:Date.now()});
}
const SNAPSHOT_TTL_MS=30000;
const fresh=(owner:string):{session:RemoteSessionInfo|null}|undefined=>{const item=snapshots.get(owner);return item&&item.agent===hosted&&Date.now()-item.at<SNAPSHOT_TTL_MS?item:undefined;};
/** Whether this owner's snapshot is still current — a caller that holds one never waits on `refreshHostedStatus`. */
export const hostedStatusFresh=(owner:string):boolean=>!!hosted?.status&&!!fresh(owner);
export function hostedStatusSnapshot(owner:string,id:string):RemoteSessionInfo|null|undefined{
 const agent=hosted;if(!agent?.status||!agent.owns(owner,id))return undefined;
 return fresh(owner)?.session??null;
}
