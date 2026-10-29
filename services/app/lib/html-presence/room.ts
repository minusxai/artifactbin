import type {PresenceFrame,PresenceViewer} from './contract';
import {PRESENCE_FRAME_INTERVAL_MS,PRESENCE_REAUTHORIZE_MS,presenceFrame,presenceRoster} from './model';
import {decodePresenceMessage} from './message';
interface PresenceRoomPorts {
 revision:string;
 authorize():Promise<boolean>;
 subscribe(receive:(payload:string)=>void,lost:()=>void):Promise<()=>Promise<void>>;
 subscribeAcl(changed:()=>void,lost:()=>void):Promise<()=>Promise<void>>;
 send(frame:PresenceFrame):void;
 close():void;
 clock:{now():number;setTimeout(work:()=>void,ms:number):unknown;clearTimeout(timer:unknown):void;setInterval(work:()=>void,ms:number):unknown;clearInterval(timer:unknown):void};
}
/**
 * Ephemeral fanout: geometry batches never query the database. Artifact (ACL) wakeups suspend delivery until revalidation; a slow safety interval catches a missed wakeup.
 * What one viewer receives is bounded independent of room size: the first frame on join goes at once, later ones at most once per PRESENCE_FRAME_INTERVAL_MS
 * (latest state wins), each capped by presenceFrame, and an unchanged frame is never resent.
 */
export async function createPresenceRoom(ports:PresenceRoomPorts){
 const entries=new Map<string,PresenceViewer>(),drops:Array<()=>Promise<void>>=[];
 let closed=false,checking=false,again=false,authorized=false,flushTimer:unknown,heartbeat:unknown,sentAt:number|undefined,lastFrame='';
 const dispose=()=>{if(closed)return;closed=true;ports.clock.clearTimeout(flushTimer);ports.clock.clearInterval(heartbeat);for(const drop of drops)void drop().catch(()=>{});entries.clear();ports.close();};
 const flush=()=>{
  flushTimer=undefined;if(closed||!authorized||checking)return;
  const now=ports.clock.now(),live=presenceRoster([...entries.values()],ports.revision,now);entries.clear();for(const entry of live)entries.set(entry.id,entry);
  const frame=presenceFrame(live,ports.revision,now),wire=JSON.stringify(frame);if(sentAt!==undefined&&wire===lastFrame)return;
  sentAt=now;lastFrame=wire;try{ports.send(frame);}catch{dispose();}
 };
 const schedule=()=>{
  if(closed||flushTimer!==undefined)return;
  const wait=sentAt===undefined?0:sentAt+PRESENCE_FRAME_INTERVAL_MS-ports.clock.now();
  if(wait<=0)flush();else flushTimer=ports.clock.setTimeout(flush,wait);
 };
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
  else{entries.delete(message.id);entries.set(message.id,message);if(entries.size>100)entries.delete(entries.keys().next().value!);}
  schedule();
 };
 try{for(const subscribe of [()=>ports.subscribe(receive,dispose),()=>ports.subscribeAcl(()=>void revalidate(),dispose)]){const drop=await subscribe();if(closed){await drop();return{dispose};}drops.push(drop);}}
 catch{dispose();throw new Error('Presence unavailable');}
 await revalidate();if(closed)return{dispose};
 heartbeat=ports.clock.setInterval(()=>void revalidate(),PRESENCE_REAUTHORIZE_MS);
 return{dispose};
}
