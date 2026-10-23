import type {ArtifactBackend} from '@/lib/artifact-backend/types';
import {createEffect,createSignal,on,onCleanup,type Accessor} from 'solid-js';
import {runtimeId} from '@artifactbin/utils/runtime-id';
import {createReaderPresenceSession} from '@/lib/html-presence/reader-session';
import {readerPreferences} from '@/lib/html-presence/preferences';
import type {PresenceViewer,ReaderPreferences} from '@/lib/html-presence/contract';
import type {DocumentRuntimeRef} from '@/lib/story-runtime/document-endpoint';
/** Platform-origin transport and private settings; frame messages enter through the original validated controller. */
export function createReaderPresence(options:{id:string;revision:string;enabled:Accessor<boolean>;nonce:Accessor<string|null>;runtimeRef:DocumentRuntimeRef;backend:Pick<ArtifactBackend,'publishPresence'>|null}){
 const settings=readerPreferences((()=>{try{return window.localStorage;}catch{return null;}})());
 const [preferences,setPreferences]=createSignal(settings.read()),[viewers,setViewers]=createSignal<PresenceViewer[]>([]);
 let update=()=>{},receivePeers=(_viewers:PresenceViewer[])=>{};
 createEffect(on([options.nonce,options.enabled],([nonce,enabled])=>{
  const controller=options.runtimeRef.current;if(!nonce||!controller||!enabled||!options.backend)return;
  let active=true;
  const session=createReaderPresenceSession({session:runtimeId(),revision:options.revision,nonce,readPreferences:preferences,active:()=>active,
   publish:input=>options.backend!.publishPresence(input),
   connect:receive=>{receivePeers=receive;return()=>{receivePeers=()=>{};};},
   paint:input=>controller.send({type:'mx:presence',...input}),changed:setViewers,
   clock:{now:Date.now,setInterval:(work,ms)=>setInterval(work,ms),clearInterval:timer=>clearInterval(timer as ReturnType<typeof setInterval>),setTimeout:(work,ms)=>setTimeout(work,ms),clearTimeout:timer=>clearTimeout(timer as ReturnType<typeof setTimeout>)}
  });
  update=session.preferencesChanged;
  const unsubscribe=controller.subscribe(session.receive),leave=()=>{active=false;session.activeChanged();},restore=()=>{active=true;session.activeChanged();};window.addEventListener('pagehide',leave);window.addEventListener('pageshow',restore);
  onCleanup(()=>{update=()=>{};unsubscribe();window.removeEventListener('pagehide',leave);window.removeEventListener('pageshow',restore);session.dispose();setViewers([]);});
 }));
 return {preferences,viewers,receive:(peers:PresenceViewer[])=>receivePeers(peers),setPreference:(name:keyof ReaderPreferences,value:boolean)=>{setPreferences(settings.set(name,value));update();}};
}
