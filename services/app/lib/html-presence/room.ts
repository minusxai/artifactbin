import type {PresenceViewer} from './contract';
import {PRESENCE_REAUTHORIZE_MS,presenceRoster} from './model';
import {decodePresenceMessage} from './message';
interface PresenceRoomPorts {
 revision:string;
 authorize():Promise<boolean>;
 subscribe(receive:(payload:string)=>void,lost:()=>void):Promise<()=>Promise<void>>;
 subscribeAcl(changed:()=>void,lost:()=>void):Promise<()=>Promise<void>>;
 send(viewers:PresenceViewer[]):void;
 close():void;
 clock:{now():number;setTimeout(work:()=>void,ms:number):unknown;clearTimeout(timer:unknown):void;setInterval(work:()=>void,ms:number):unknown;clearInterval(timer:unknown):void};
}
/** Ephemeral fanout: geometry batches never query the database. Artifact (ACL) wakeups suspend delivery until revalidation; a slow safety interval catches a missed wakeup. */
export async function createPresenceRoom(ports:PresenceRoomPorts){
 const entries=new Map<string,PresenceViewer>(),drops:Array<()=>Promise<void>>=[];
 let closed=false,checking=false,again=false,authorized=false,flushTimer:unknown,heartbeat:unknown;
 const dispose=()=>{if(closed)return;closed=true;ports.clock.clearTimeout(flushTimer);ports.clock.clearInterval(heartbeat);for(const drop of drops)void drop().catch(()=>{});entries.clear();ports.close();};
 const flush=()=>{flushTimer=undefined;if(closed||!authorized||checking)return;const roster=presenceRoster([...entries.values()],ports.revision,ports.clock.now());entries.clear();for(const entry of roster)entries.set(entry.id,entry);try{ports.send(roster);}catch{dispose();}};
 const schedule=()=>{if(!closed&&flushTimer===undefined)flushTimer=ports.clock.setTimeout(flush,75);};
 const revalidate=async()=>{
  if(closed)return;authorized=false;if(checking){again=true;return;}checking=true;
  try{do{again=false;const allowed=await ports.authorize();if(closed)return;if(!allowed)return dispose();}while(again);authorized=true;}
  catch{dispose();}
  finally{checking=false;if(!closed&&authorized)schedule();}
 };
 const receive=(payload:string)=>{
  if(closed)return;
  const message=decodePresenceMessage(payload,ports.revision);if(!message)return;
  if('gone' in message)entries.delete(message.id);
  else{entries.set(message.id,message);if(entries.size>100)entries.delete(entries.keys().next().value!);}
  schedule();
 };
 try{for(const subscribe of [()=>ports.subscribe(receive,dispose),()=>ports.subscribeAcl(()=>void revalidate(),dispose)]){const drop=await subscribe();if(closed){await drop();return{dispose};}drops.push(drop);}}
 catch{dispose();throw new Error('Presence unavailable');}
 await revalidate();if(closed)return{dispose};
 heartbeat=ports.clock.setInterval(()=>void revalidate(),PRESENCE_REAUTHORIZE_MS);schedule();
 return{dispose};
}
