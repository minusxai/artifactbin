import type {PresenceGeometry,PresencePaint,PresencePublication,PresenceViewer,ReaderPreferences} from './contract';
import {presenceGeometry,presenceRoster} from './model';
export interface ReaderPresencePorts {
 session:string; revision:string; nonce:string;
 readPreferences():ReaderPreferences;
 active():boolean;
 publish(input:PresencePublication):Promise<string|null>;
 connect(receive:(viewers:PresenceViewer[])=>void):()=>void;
 paint(input:PresencePaint):void;
 changed(viewers:PresenceViewer[]):void;
 clock:{now():number;setInterval(work:()=>void,ms:number):unknown;clearInterval(timer:unknown):void;setTimeout(work:()=>void,ms:number):unknown;clearTimeout(timer:unknown):void};
}
/** Parent-owned session: frame geometry has no authority over identity, revision or reader choices. */
export function createReaderPresenceSession(ports:ReaderPresencePorts){
 let geometry:PresenceGeometry={cursor:null,selection:null},viewers:PresenceViewer[]=[],ownId:string|null=null,closed=false,busy=false,pending=false;
 let scheduled:unknown;
 const hide=()=>void ports.publish({session:ports.session,revision:ports.revision,visible:false,cursor:null,selection:null}).catch(()=>{});
 const paint=()=>{const current=presenceRoster(viewers,ports.revision,ports.clock.now()).filter(viewer=>viewer.id!==ownId);ports.changed(current);ports.paint({viewers:ownId?current:[],preferences:ports.readPreferences()});};
 const publish=async()=>{if(closed)return;if(busy){pending=true;return;}busy=true;const prefs=ports.readPreferences();try{const id=await ports.publish({session:ports.session,revision:ports.revision,visible:prefs.visible&&ports.active(),cursor:prefs.visible&&prefs.shareCursor&&ports.active()?geometry.cursor:null,selection:prefs.visible&&prefs.shareSelection&&ports.active()?geometry.selection:null});if(!closed&&id){ownId=id;paint();}}catch{/* Ephemeral state heals on the next heartbeat, never replays a mutation. */}finally{busy=false;if(closed){hide();return;}if(pending&&!closed){pending=false;void publish();}}};
 const disconnect=ports.connect(next=>{if(closed)return;viewers=next;paint();});
 const timer=ports.clock.setInterval(()=>{paint();void publish();},3000);
 void publish();
 return {receive:(event:unknown)=>{const raw=event as {type?:string;nonce?:string;geometry?:unknown};if(raw?.type!=='mx:presence'||raw.nonce!==ports.nonce)return;geometry=presenceGeometry(raw.geometry);if(scheduled===undefined)scheduled=ports.clock.setTimeout(()=>{scheduled=undefined;void publish();},75);},preferencesChanged:()=>{paint();void publish();},activeChanged:()=>void publish(),dispose:()=>{if(closed)return;closed=true;disconnect();ports.clock.clearInterval(timer);ports.clock.clearTimeout(scheduled);ports.paint({viewers:[],preferences:ports.readPreferences()});if(!busy)hide();}};
}
