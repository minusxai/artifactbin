import {runtimeId} from '@artifactbin/utils/runtime-id';
import {createReaderPresenceSession} from '@/lib/html-presence/reader-session';
import type {PresenceFrame,ReaderPreferences,PresenceViewer} from '@/lib/html-presence';
import type {DocumentRuntimeRef} from '@/lib/html-reader/document-endpoint';
import type {ArtifactBackend} from '@/lib/artifact-backend';
import type {FrameBridgeParent} from '@/lib/html-reader/frame-bridge/parent';
import type {PresencePaint} from '@/lib/html-presence';
/** The bridge's region channel, when the controller is a frame bridge (frame-bridge/parent). */
type RegionChannel=Pick<FrameBridgeParent,'subscribeRegion'|'sendRegion'|'regionsEnabled'>;
const regionChannel=(controller:object):RegionChannel|null=>'subscribeRegion' in controller&&'sendRegion' in controller&&'regionsEnabled' in controller?controller as RegionChannel:null;
/** Collaborators' region carets for the frame's editor (contract `region-paint`): only those a reader chose to see. */
const regionCarets=(input:PresencePaint)=>input.preferences.showCursors?input.viewers.flatMap(viewer=>viewer.region?[{...viewer.region,id:viewer.id,label:viewer.label}]:[]):[];
export interface ReaderPresenceEngineOptions {
 revision:string; nonce:string; active:boolean;
 controller:NonNullable<DocumentRuntimeRef['current']>;
 backend:Pick<ArtifactBackend,'publishPresence'>;
 preferences:()=>ReaderPreferences;
 changed:(viewers:PresenceViewer[],total:number)=>void;
}
/** The optional presence lifecycle starts after the frame bridge is ready, outside the shell's eager payload. */
export function startReaderPresence(options:ReaderPresenceEngineOptions){
 let active=options.active,receivePeers=(_frame:PresenceFrame)=>{};
 const regions=regionChannel(options.controller);
 const session=createReaderPresenceSession({session:runtimeId(),revision:options.revision,nonce:options.nonce,readPreferences:options.preferences,active:()=>active,
  publish:input=>options.backend.publishPresence(input),
  connect:receive=>{receivePeers=receive;return()=>{receivePeers=()=>{};};},
  // Region carets go to the frame's editor on the region channel, and only into a frame with regions enabled.
  paint:input=>{options.controller.send({type:'mx:presence',...input,viewers:input.viewers.map(({region:_region,...viewer})=>viewer)});if(regions?.regionsEnabled())regions.sendRegion({kind:'region-paint',carets:regionCarets(input)});},changed:options.changed,
  clock:{now:Date.now,setInterval:(work,ms)=>setInterval(work,ms),clearInterval:timer=>clearInterval(timer as ReturnType<typeof setInterval>),setTimeout:(work,ms)=>setTimeout(work,ms),clearTimeout:timer=>clearTimeout(timer as ReturnType<typeof setTimeout>)}
 });
 const unsubscribe=options.controller.subscribe(session.receive);
 // A session started again (a new revision) shares the caret the editor already reported: it resends only when it moves.
 const caret='regionCaret' in options.controller?(options.controller as Pick<FrameBridgeParent,'regionCaret'>).regionCaret():null;
 if(regions&&caret)session.regionCaret(caret);
 const stopRegions=regions?.subscribeRegion(message=>{if(message.kind==='region-caret')session.regionCaret({regionId:message.regionId,anchor:message.anchor,head:message.head});else if(message.kind==='region-blur')session.regionCaret(null);})??(()=>{});
 const leave=()=>{active=false;session.activeChanged();},restore=()=>{active=true;session.activeChanged();};
 window.addEventListener('pagehide',leave);window.addEventListener('pageshow',restore);
 return {receive:(frame:PresenceFrame)=>receivePeers(frame),update:session.preferencesChanged,
  dispose:()=>{unsubscribe();stopRegions();window.removeEventListener('pagehide',leave);window.removeEventListener('pageshow',restore);session.dispose();options.changed([],0);}};
}
