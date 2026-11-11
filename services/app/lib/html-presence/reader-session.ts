import type {PresenceIdentity,PresenceFrame,PresenceGeometry,PresencePaint,PresencePublication,PresenceViewer,ReaderPreferences} from './contract';
import type {RegionCaret} from '@artifactbin/contracts';
import {PRESENCE_HEARTBEAT_MS,PRESENCE_POINTER_THROTTLE_MS,presenceGeometry,presenceRoster,regionCaret} from './model';
export interface ReaderPresencePorts {
 session:string; revision:string; nonce:string;
 readPreferences():ReaderPreferences;
 active():boolean;
 publish(input:PresencePublication):Promise<PresenceIdentity|string|null>;
 connect(receive:(frame:PresenceFrame)=>void):()=>void;
 paint(input:PresencePaint):void;
 /** The other readers shown (capped by the room) and how many other readers the room holds in all. */
 changed(viewers:PresenceViewer[],total:number):void;
 clock:{now():number;setInterval(work:()=>void,ms:number):unknown;clearInterval(timer:unknown):void;setTimeout(work:()=>void,ms:number):unknown;clearTimeout(timer:unknown):void};
}
/**
 * Parent-owned session: frame geometry has no authority over identity, revision or reader choices.
 * Personalized reader statistics are independent of capped session geometry. Legacy servers supply only a visible, unique lower bound.
 */
export function createReaderPresenceSession(ports:ReaderPresencePorts){
 let geometry:PresenceGeometry={cursor:null,selection:null},roster:PresenceFrame={viewers:[],total:0},ownId:string|null=null,ownColor:string|null=null,closed=false,busy=false,pending=false;
 let scheduled:unknown,countExpiry:unknown;
 /** The editor's caret in a region (frame-bridge `region-caret`), kept apart from the frame's pointer geometry; null after `region-blur`. */
 let region:RegionCaret|null=null;
 const later=()=>{if(scheduled===undefined)scheduled=ports.clock.setTimeout(()=>{scheduled=undefined;void publish();},PRESENCE_POINTER_THROTTLE_MS);};
 const hide=()=>void ports.publish({session:ports.session,revision:ports.revision,visible:false,cursor:null,selection:null}).catch(()=>{});
 const paint=()=>{
  const now=ports.clock.now();
  const geometryViewers=presenceRoster(roster.viewers,ports.revision,now).filter(viewer=>viewer.id!==ownId);
  // Older publishers expose account identity only on the own session's trusted room entry.
  ownColor??=roster.viewers.find(viewer=>viewer.id===ownId)?.colorId??null;
  const identityKnown=ownColor!==null||!geometryViewers.some(viewer=>viewer.colorId);
  const current=geometryViewers.filter(viewer=>!ownColor||viewer.colorId!==ownColor);
  const stats=roster.readers;
  const total=stats&&Number.isInteger(stats.total)&&stats.total>=0&&Number.isFinite(stats.expiresAt)
   ? (now<stats.expiresAt?stats.total:0)
   : (identityKnown?new Set(current.map(viewer=>viewer.colorId??viewer.id)).size:0);
  ports.changed(ownId&&identityKnown?current:[],ownId?total:0);ports.paint({viewers:ownId?geometryViewers:[],preferences:ports.readPreferences()});
 };
 const publish=async()=>{if(closed)return;if(busy){pending=true;return;}busy=true;const prefs=ports.readPreferences(),visible=prefs.visible&&ports.active();try{const id=await ports.publish({session:ports.session,revision:ports.revision,visible,cursor:prefs.visible&&prefs.shareCursor&&ports.active()?geometry.cursor:null,selection:prefs.visible&&prefs.shareSelection&&ports.active()?geometry.selection:null,...(region&&prefs.visible&&prefs.shareCursor&&ports.active()?{region}:{})});if(!closed&&id){ownId=typeof id==='string'?id:id.id;ownColor=typeof id==='string'?ownColor:id.colorId;paint();}}catch{/* Ephemeral state heals on the next heartbeat, never replays a mutation. */}finally{busy=false;if(closed){hide();return;}if(pending&&!closed){pending=false;void publish();}}};
 const disconnect=ports.connect(next=>{if(closed)return;roster=next;ports.clock.clearTimeout(countExpiry);
  const expiry=next.readers?.expiresAt;
  if(typeof expiry==='number'&&Number.isFinite(expiry)&&expiry>ports.clock.now())countExpiry=ports.clock.setTimeout(paint,expiry-ports.clock.now());
  paint();});
 const timer=ports.clock.setInterval(()=>{paint();void publish();},PRESENCE_HEARTBEAT_MS);
 void publish();
 return {receive:(event:unknown)=>{const raw=event as {type?:string;nonce?:string;geometry?:unknown};if(raw?.type!=='mx:presence'||raw.nonce!==ports.nonce)return;const next=presenceGeometry(raw.geometry);geometry={cursor:next.cursor,selection:next.selection};later();},regionCaret:(caret:RegionCaret|null)=>{region=caret?regionCaret(caret):null;later();},preferencesChanged:()=>{paint();void publish();},activeChanged:()=>void publish(),dispose:()=>{if(closed)return;closed=true;disconnect();ports.clock.clearInterval(timer);ports.clock.clearTimeout(scheduled);ports.clock.clearTimeout(countExpiry);ports.changed([],0);ports.paint({viewers:[],preferences:ports.readPreferences()});if(!busy)hide();}};
}
