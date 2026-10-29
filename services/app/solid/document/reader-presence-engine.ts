import {runtimeId} from '@artifactbin/utils/runtime-id';
import {createReaderPresenceSession} from '@/lib/html-presence/reader-session';
import type {PresenceFrame,ReaderPreferences,PresenceViewer} from '@/lib/html-presence/contract';
import type {DocumentRuntimeRef} from '@/lib/story-runtime/document-endpoint';
import type {ArtifactBackend} from '@/lib/artifact-backend/types';
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
 const session=createReaderPresenceSession({session:runtimeId(),revision:options.revision,nonce:options.nonce,readPreferences:options.preferences,active:()=>active,
  publish:input=>options.backend.publishPresence(input),
  connect:receive=>{receivePeers=receive;return()=>{receivePeers=()=>{};};},
  paint:input=>options.controller.send({type:'mx:presence',...input}),changed:options.changed,
  clock:{now:Date.now,setInterval:(work,ms)=>setInterval(work,ms),clearInterval:timer=>clearInterval(timer as ReturnType<typeof setInterval>),setTimeout:(work,ms)=>setTimeout(work,ms),clearTimeout:timer=>clearTimeout(timer as ReturnType<typeof setTimeout>)}
 });
 const unsubscribe=options.controller.subscribe(session.receive);
 const leave=()=>{active=false;session.activeChanged();},restore=()=>{active=true;session.activeChanged();};
 window.addEventListener('pagehide',leave);window.addEventListener('pageshow',restore);
 return {receive:(frame:PresenceFrame)=>receivePeers(frame),update:session.preferencesChanged,
  dispose:()=>{unsubscribe();window.removeEventListener('pagehide',leave);window.removeEventListener('pageshow',restore);session.dispose();options.changed([],0);}};
}
