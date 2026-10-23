import {createEffect,createSignal,on,onCleanup,type Accessor} from 'solid-js';
import {runtimeId} from '@artifactbin/utils/runtime-id';
import {createReaderPresenceSession} from '@/lib/html-presence/reader-session';
import {readerPreferences} from '@/lib/html-presence/preferences';
import type {PresenceViewer,ReaderPreferences} from '@/lib/html-presence/contract';
import type {DocumentRuntimeRef} from '@/lib/story-runtime/document-endpoint';
/** Platform-origin transport and private settings; frame messages enter through the original validated controller. */
export function createReaderPresence(options:{id:string;revision:string;enabled:Accessor<boolean>;nonce:Accessor<string|null>;runtimeRef:DocumentRuntimeRef}){
 const settings=readerPreferences((()=>{try{return window.localStorage;}catch{return null;}})());
 const [preferences,setPreferences]=createSignal(settings.read()),[viewers,setViewers]=createSignal<PresenceViewer[]>([]);
 let update=()=>{};
 createEffect(on([options.nonce,options.enabled],([nonce,enabled])=>{
  const controller=options.runtimeRef.current;if(!nonce||!controller||!enabled)return;
  const url=`/api/artifacts/${encodeURIComponent(options.id)}/presence`;
  const session=createReaderPresenceSession({session:runtimeId(),revision:options.revision,nonce,readPreferences:preferences,active:()=>!document.hidden,
   publish:async input=>{const response=await fetch(url,{method:'POST',credentials:'same-origin',headers:{'content-type':'application/json'},body:JSON.stringify(input),keepalive:!input.visible});if(!response.ok)return null;const body=await response.json();return typeof body.id==='string'?body.id:null;},
   connect:receive=>{const stream=new EventSource(url);stream.onmessage=event=>{try{const value=JSON.parse(event.data);if(Array.isArray(value))receive(value);}catch{}};return()=>stream.close();},
   paint:input=>controller.send({type:'mx:presence',...input}),changed:setViewers,
   clock:{now:Date.now,setInterval:(work,ms)=>setInterval(work,ms),clearInterval:timer=>clearInterval(timer as ReturnType<typeof setInterval>),setTimeout:(work,ms)=>setTimeout(work,ms),clearTimeout:timer=>clearTimeout(timer as ReturnType<typeof setTimeout>)}
  });
  update=session.preferencesChanged;
  const unsubscribe=controller.subscribe(session.receive),visibility=()=>session.activeChanged();document.addEventListener('visibilitychange',visibility);
  onCleanup(()=>{update=()=>{};unsubscribe();document.removeEventListener('visibilitychange',visibility);session.dispose();setViewers([]);});
 }));
 return {preferences,viewers,setPreference:(name:keyof ReaderPreferences,value:boolean)=>{setPreferences(settings.set(name,value));update();}};
}
