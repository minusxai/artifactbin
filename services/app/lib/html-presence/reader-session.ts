import type {PresenceFrame,PresenceGeometry,PresencePaint,PresencePublication,PresenceViewer,ReaderPreferences} from './contract';
import {PRESENCE_HEARTBEAT_MS,PRESENCE_POINTER_THROTTLE_MS,presenceGeometry,presenceRoster} from './model';
export interface ReaderPresencePorts {
 session:string; revision:string; nonce:string;
 readPreferences():ReaderPreferences;
 active():boolean;
 publish(input:PresencePublication):Promise<string|null>;
 connect(receive:(frame:PresenceFrame)=>void):()=>void;
 paint(input:PresencePaint):void;
 /** The other readers shown (capped by the room) and how many other readers the room holds in all. */
 changed(viewers:PresenceViewer[],total:number):void;
 clock:{now():number;setInterval(work:()=>void,ms:number):unknown;clearInterval(timer:unknown):void;setTimeout(work:()=>void,ms:number):unknown;clearTimeout(timer:unknown):void};
}
/**
 * Parent-owned session: frame geometry has no authority over identity, revision or reader choices.
 * A frame's total counts this tab while it is visible, whether or not the cap kept its entry, so the others' total leaves one out then.
 */
export function createReaderPresenceSession(ports:ReaderPresencePorts){
 let geometry:PresenceGeometry={cursor:null,selection:null},roster:PresenceFrame={viewers:[],total:0},ownId:string|null=null,shown=false,closed=false,busy=false,pending=false;
 let scheduled:unknown;
 const hide=()=>void ports.publish({session:ports.session,revision:ports.revision,visible:false,cursor:null,selection:null}).catch(()=>{});
 const paint=()=>{const current=presenceRoster(roster.viewers,ports.revision,ports.clock.now()).filter(viewer=>viewer.id!==ownId);const self=roster.viewers.some(viewer=>viewer.id===ownId)||(ownId!==null&&shown);ports.changed(current,Math.max(current.length,roster.total-(self?1:0)));ports.paint({viewers:ownId?current:[],preferences:ports.readPreferences()});};
 const publish=async()=>{if(closed)return;if(busy){pending=true;return;}busy=true;const prefs=ports.readPreferences(),visible=prefs.visible&&ports.active();try{const id=await ports.publish({session:ports.session,revision:ports.revision,visible,cursor:prefs.visible&&prefs.shareCursor&&ports.active()?geometry.cursor:null,selection:prefs.visible&&prefs.shareSelection&&ports.active()?geometry.selection:null});if(!closed&&id){ownId=id;shown=visible;paint();}}catch{/* Ephemeral state heals on the next heartbeat, never replays a mutation. */}finally{busy=false;if(closed){hide();return;}if(pending&&!closed){pending=false;void publish();}}};
 const disconnect=ports.connect(next=>{if(closed)return;roster=next;paint();});
 const timer=ports.clock.setInterval(()=>{paint();void publish();},PRESENCE_HEARTBEAT_MS);
 void publish();
 return {receive:(event:unknown)=>{const raw=event as {type?:string;nonce?:string;geometry?:unknown};if(raw?.type!=='mx:presence'||raw.nonce!==ports.nonce)return;geometry=presenceGeometry(raw.geometry);if(scheduled===undefined)scheduled=ports.clock.setTimeout(()=>{scheduled=undefined;void publish();},PRESENCE_POINTER_THROTTLE_MS);},preferencesChanged:()=>{paint();void publish();},activeChanged:()=>void publish(),dispose:()=>{if(closed)return;closed=true;disconnect();ports.clock.clearInterval(timer);ports.clock.clearTimeout(scheduled);ports.paint({viewers:[],preferences:ports.readPreferences()});if(!busy)hide();}};
}
