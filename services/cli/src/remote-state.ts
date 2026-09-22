import {State,HOME_SCOPE} from './state';
import type {HttpClient} from './http';
export interface RemoteLocalState {id:string;server:string;pid:number;directory:string;historyDigest:string;stopRequested:boolean;exitCode?:number}
export const remoteStateKey=(server:string,id:string)=>`${server}/${id}`;
/** Request cancellation through the worker-owned SQLite record, never a possibly reused PID. */
export async function stopLocalRemote(home:string,server:string,id:string,env?:NodeJS.ProcessEnv):Promise<boolean>{
 const state=await State.openIfPresent(home,env);if(!state)return false;
 try{return state.transaction(()=>{const key=remoteStateKey(server,id),record=state.get<RemoteLocalState>(HOME_SCOPE,'remote-agent',key);if(!record||record.value.exitCode!==undefined)return false;state.put(HOME_SCOPE,'remote-agent',key,{...record.value,stopRequested:true});return true;});}finally{state.close();}
}
/** Retained exit receipts release reservations after a relay outage; no runner secret is stored. */
export async function reconcileRemoteExits(home:string,client:HttpClient,env?:NodeJS.ProcessEnv){
 const state=await State.openIfPresent(home,env);if(!state)return;
 try{for(const row of state.list<RemoteLocalState>(HOME_SCOPE,'remote-agent')){
  if(row.value.server!==client.connection.server||row.value.exitCode===undefined)continue;
  await client.request(`/remote/sessions/${row.value.id}`,'POST',{type:'stopped',exitCode:row.value.exitCode});
  state.delete(HOME_SCOPE,'remote-agent',row.key);
 }}finally{state.close();}
}
