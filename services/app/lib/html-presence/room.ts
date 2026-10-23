import type {PresenceViewer} from './contract';
import {presenceGeometry,presenceRoster} from './model';
interface PresenceRoomPorts {
 revision:string;
 authorize():Promise<boolean>;
 subscribe(receive:(payload:string)=>void,lost:()=>void):Promise<()=>Promise<void>>;
 subscribeAcl(changed:()=>void,lost:()=>void):Promise<()=>Promise<void>>;
 send(viewers:PresenceViewer[]):void;
 close():void;
 clock:{now():number;setTimeout(work:()=>void,ms:number):unknown;clearTimeout(timer:unknown):void;setInterval(work:()=>void,ms:number):unknown;clearInterval(timer:unknown):void};
}
/** Ephemeral fanout: geometry batches never query the database. Artifact wakeups suspend delivery until ACL revalidation. */
export async function createPresenceRoom(ports:PresenceRoomPorts){
 const entries=new Map<string,PresenceViewer>(),drops:Array<()=>Promise<void>>=[];
 let closed=false,checking=false,again=false,authorized=true,flushTimer:unknown,heartbeat:unknown;
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
  try{const entry=JSON.parse(payload) as PresenceViewer&{gone?:boolean};if(!/^[a-f0-9]{64}$/.test(entry.id))return;
   if(entry.gone)entries.delete(entry.id);
   else if(entry.revision===ports.revision&&typeof entry.label==='string'&&entry.label.length<=100&&Number.isFinite(entry.seen)){
    entries.set(entry.id,{id:entry.id,label:entry.label,revision:ports.revision,seen:entry.seen,...presenceGeometry(entry)});
    if(entries.size>100)entries.delete(entries.keys().next().value!);
   }else return;
   schedule();
  }catch{/* Invalid or old notifications never enter the roster. */}
 };
 try{for(const subscribe of [()=>ports.subscribe(receive,dispose),()=>ports.subscribeAcl(()=>void revalidate(),dispose)]){const drop=await subscribe();if(closed){await drop();return{dispose};}drops.push(drop);}}
 catch{dispose();throw new Error('Presence unavailable');}
 heartbeat=ports.clock.setInterval(()=>void revalidate(),3000);schedule();
 return{dispose};
}
