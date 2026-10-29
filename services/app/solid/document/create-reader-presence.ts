import type {ArtifactBackend} from '@/lib/artifact-backend';
import {createEffect,createSignal,on,onCleanup,type Accessor} from 'solid-js';
import type {startReaderPresence} from './reader-presence-engine';
import {readerPreferences} from '@/lib/html-presence/preferences';
import type {PresenceFrame,PresenceViewer,ReaderPreferences} from '@/lib/html-presence';
import type {DocumentRuntimeRef} from '@/lib/story-runtime/document-endpoint';
/** Presence starts only after the document bridge is ready; its geometry/session engine is an intentional lazy browser chunk. */
export type ReaderPresenceLoader=()=>Promise<{startReaderPresence:typeof startReaderPresence}>;
const loadReaderPresence:ReaderPresenceLoader=()=>import('./reader-presence-engine');
/** Platform-origin transport and private settings; frame messages enter through the original validated controller. */
export function createReaderPresence(options:{id:string;revision:string|Accessor<string>;enabled:Accessor<boolean>;nonce:Accessor<string|null>;runtimeRef:DocumentRuntimeRef;backend:Pick<ArtifactBackend,'publishPresence'>|null},load:ReaderPresenceLoader=loadReaderPresence){
 const settings=readerPreferences((()=>{try{return window.localStorage;}catch{return null;}})());
 const [preferences,setPreferences]=createSignal(settings.read()),[viewers,setViewers]=createSignal<PresenceViewer[]>([]),[total,setTotal]=createSignal(0);
 let update=()=>{},receivePeers=(_frame:PresenceFrame)=>{};
 let latestPeers:PresenceFrame={viewers:[],total:0};
 const revisionOf=typeof options.revision==='function'?options.revision:()=>options.revision as string;
 // A version drawn in place moves the revision: presence starts again on it.
 createEffect(on([options.nonce,options.enabled,revisionOf],([nonce,enabled,revision])=>{
  const controller=options.runtimeRef.current;if(!nonce||!controller||!enabled||!options.backend)return;
  let disposed=false,active=true,dispose=()=>{};
  const leave=()=>{active=false;},restore=()=>{active=true;};
  const stopPending=()=>{window.removeEventListener('pagehide',leave);window.removeEventListener('pageshow',restore);};
  window.addEventListener('pagehide',leave);window.addEventListener('pageshow',restore);
  const start=()=>{void load().then(({startReaderPresence})=>{
   stopPending();if(disposed)return;
   const engine=startReaderPresence({revision,nonce,controller,backend:options.backend!,preferences,changed:(shown,others)=>{setViewers(shown);setTotal(others);},active});
   receivePeers=engine.receive;receivePeers(latestPeers);update=engine.update;
   dispose=()=>{update=()=>{};receivePeers=()=>{};engine.dispose();};
  }).catch(()=>{stopPending();/* Optional presence can recover when the bridge reconnects. */});};
  onCleanup(()=>{disposed=true;document.removeEventListener('DOMContentLoaded',start);stopPending();dispose();});
  // A fast frame bridge can connect while the host HTML is still parsing.
  // Optional geometry/session work must not compete with building that DOM.
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start,{once:true});else start();
 }));
 return {preferences,viewers,total,receive:(frame:PresenceFrame)=>{latestPeers=frame;receivePeers(frame);},setPreference:(name:keyof ReaderPreferences,value:boolean)=>{setPreferences(settings.set(name,value));update();}};
}
