import type {ArtifactBackend} from '@/lib/artifact-backend/types';
import {createEffect,createSignal,on,onCleanup,type Accessor} from 'solid-js';
import type {startReaderPresence} from './reader-presence-engine';
import {readerPreferences} from '@/lib/html-presence/preferences';
import type {PresenceViewer,ReaderPreferences} from '@/lib/html-presence/contract';
import type {DocumentRuntimeRef} from '@/lib/story-runtime/document-endpoint';
/** Presence starts only after the document bridge is ready; its geometry/session engine is an intentional lazy browser chunk. */
export type ReaderPresenceLoader=()=>Promise<{startReaderPresence:typeof startReaderPresence}>;
const loadReaderPresence:ReaderPresenceLoader=()=>import('./reader-presence-engine');
/** Platform-origin transport and private settings; frame messages enter through the original validated controller. */
export function createReaderPresence(options:{id:string;revision:string;enabled:Accessor<boolean>;nonce:Accessor<string|null>;runtimeRef:DocumentRuntimeRef;backend:Pick<ArtifactBackend,'publishPresence'>|null},load:ReaderPresenceLoader=loadReaderPresence){
 const settings=readerPreferences((()=>{try{return window.localStorage;}catch{return null;}})());
 const [preferences,setPreferences]=createSignal(settings.read()),[viewers,setViewers]=createSignal<PresenceViewer[]>([]);
 let update=()=>{},receivePeers=(_viewers:PresenceViewer[])=>{};
 let latestPeers:PresenceViewer[]=[];
 createEffect(on([options.nonce,options.enabled],([nonce,enabled])=>{
  const controller=options.runtimeRef.current;if(!nonce||!controller||!enabled||!options.backend)return;
  let disposed=false,active=true,dispose=()=>{};
  const leave=()=>{active=false;},restore=()=>{active=true;};
  const stopPending=()=>{window.removeEventListener('pagehide',leave);window.removeEventListener('pageshow',restore);};
  window.addEventListener('pagehide',leave);window.addEventListener('pageshow',restore);
  const start=()=>{void load().then(({startReaderPresence})=>{
   stopPending();if(disposed)return;
   const engine=startReaderPresence({revision:options.revision,nonce,controller,backend:options.backend!,preferences,changed:setViewers,active});
   receivePeers=engine.receive;receivePeers(latestPeers);update=engine.update;
   dispose=()=>{update=()=>{};receivePeers=()=>{};engine.dispose();};
  }).catch(()=>{stopPending();/* Optional presence can recover when the bridge reconnects. */});};
  onCleanup(()=>{disposed=true;document.removeEventListener('DOMContentLoaded',start);stopPending();dispose();});
  // A fast frame bridge can connect while the host HTML is still parsing.
  // Optional geometry/session work must not compete with building that DOM.
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start,{once:true});else start();
 }));
 return {preferences,viewers,receive:(peers:PresenceViewer[])=>{latestPeers=peers;receivePeers(peers);},setPreference:(name:keyof ReaderPreferences,value:boolean)=>{setPreferences(settings.set(name,value));update();}};
}
