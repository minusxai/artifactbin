/* @jsxImportSource solid-js */
import {createEffect,createSignal,lazy,on,onCleanup,onMount,Show,Suspense} from 'solid-js';
import {installLocalConnectionBroker,type LocalConnectionBroker} from '@/lib/local-connection/broker';
import type {LinkedDocument,LocalConnectionState} from '@/lib/local-connection/contracts';
import {STORY_READER_MODE_MESSAGE,type StoryController,type FrameBridgeFramePayload} from '@/lib/story-runtime/contract';
import {chooseTheme,storedTheme} from '@/lib/story-runtime/reader-mode';
import {createAppAppearance} from '../ui/theme';
import type {DocumentRuntimeRef} from '@/lib/story-runtime/document-endpoint';
import {DocumentChrome} from '../document/DocumentChrome';
import type {Panel} from '../components/PageChrome';
import {Input} from '../ui/Field';
import {Button} from '../ui/Button';
import {serializePortableCopy,downloadPortableCopy} from '@/lib/html-runtime/browser-portable';
import {readPortableDocument} from '@/lib/html-runtime/portable';
import {createLocalReader} from '../document/create-local-reader';
const ReaderPresenceControls=lazy(()=>import('../document/ReaderPresenceControls').then(module=>({default:module.ReaderPresenceControls})));
const AnnotationLayer=lazy(()=>import('../document/AnnotationLayer').then(module=>({default:module.AnnotationLayer})));
/** Shared platform chrome and comments; author HTML never runs on this origin. */
export function LocalDocumentPage(){
 const [state,setState]=createSignal<LocalConnectionState>('connecting');
 const [identity,setIdentity]=createSignal<LinkedDocument>();
 const [title,setTitle]=createSignal('Local file');
 const [panel,setPanel]=createSignal<Panel>(null);
 // A missing reader choice leaves the authored HTML mode unchanged. The platform panel follows app chrome.
 const [pick,setPick]=createSignal(storedTheme());
 const appAppearance=createAppAppearance();
 const chooseMode=(next:'light'|'dark')=>{chooseTheme(next);setPick(next);};
 const [rail,setRail]=createSignal(false);
 const [nonce,setNonce]=createSignal<string|null>(null);
 const [comments,setComments]=createSignal(0);
 const [saveStatus,setSaveStatus]=createSignal('');
 const [remoteChanged,setRemoteChanged]=createSignal(false);
 let picker!:HTMLInputElement;
 const saveSelected=async(file:File|undefined)=>{
  if(!file)return;
  try{const sourceBytes=await file.text();const portable=readPortableDocument(sourceBytes);const current=identity();if(current&&(portable.identity?.artifactId!==current.artifactId||portable.identity.platformOrigin!==current.platformOrigin))throw Error('Choose this document’s current HTML file');const sourceDocument=new DOMParser().parseFromString(sourceBytes,'text/html');const html=serializePortableCopy({document:sourceDocument,sourceBytes,portable});downloadPortableCopy(window,html,file.name);setSaveStatus('Download started. Original disk file unchanged.');}catch(error){setSaveStatus(error instanceof Error?error.message:'Cannot save this file');}
 };
 const listeners=new Set<(event:unknown)=>void>();
 const runtimeRef:DocumentRuntimeRef={current:null};
 let broker:LocalConnectionBroker|undefined;
 const reader=createLocalReader({identity,state,nonce,runtimeRef,sourceChanged(){setRemoteChanged(true);broker?.sourceChanged();}});
 const hosted=()=>identity()?`${identity()!.platformOrigin}/a/${encodeURIComponent(identity()!.artifactId)}`:null;
 const openHosted=()=>{const url=hosted();if(url)window.open(url,'_blank','noopener');};
 onMount(()=>{
  broker=installLocalConnectionBroker({win:window,onState(next){if(next!=='connected'){setNonce(null);runtimeRef.current?.dispose();runtimeRef.current=null;}setState(next);},onIdentity:setIdentity,onSourceObservation(observation){const current=identity();setRemoteChanged(Boolean(current&&observation.remoteDigest!==current.sourceDigest));},onConnected(value){
   setIdentity(value.identity);
   const controller:StoryController={nonce:'local',send(command){broker!.post({kind:'frame',payload:{kind:'send',command}});},update(){},invalidate(datasets){controller.send({type:'mx:data',datasets});},subscribe(listener){listeners.add(listener);return()=>listeners.delete(listener);},getViewportRect(){return new DOMRect(0,0,window.innerWidth,window.innerHeight);},dispose(){listeners.clear();}};
   runtimeRef.current=controller;
   void fetch(`/api/page/artifact/${encodeURIComponent(value.identity.artifactId)}`,{credentials:'omit'}).then(response=>response.ok?response.json():null).then(page=>{if(page?.surface?.title)setTitle(page.surface.title);});
  },onMessage(message){
   if(!message||typeof message!=='object')return;
   const data=message as {kind?:string;payload?:FrameBridgeFramePayload};
   if(data.kind!=='frame'||!data.payload)return;
   if(data.payload.kind==='ready')setNonce(data.payload.nonce);
   if(data.payload.kind==='event')for(const listener of listeners)listener(data.payload.event);
  }});
  onCleanup(()=>{runtimeRef.current?.dispose();runtimeRef.current=null;broker?.dispose();});
 });
 createEffect(on([nonce,pick],([signed,mode])=>{if(signed&&mode)runtimeRef.current?.send({type:STORY_READER_MODE_MESSAGE,mode});}));
 createEffect(()=>{if(state()==='permission-required'||state()==='signin-required'||state()==='blocked')setPanel('controls');});
 createEffect(()=>{broker?.resize(panel()||rail()?window.innerHeight:76);});
 const disconnect=()=>{broker?.disconnect();setState('offline');};
 return <>
  <Input ref={picker} type="file" accept=".html,.htm,text/html" aria-label="Choose current HTML file" class="sr-only" onChange={event=>void saveSelected(event.currentTarget.files?.[0])} />
  <DocumentChrome id={identity()?.artifactId??'local'} title={title} author={null} like={{liked:false,count:0}} signedIn={()=>false} onOpenOriginal={openHosted} comments={comments} canFork={false} owner={false} remoteAvailable={state()==='connected'}
   panel={panel} setPanel={setPanel} mode={appAppearance} onMode={chooseMode} onComment={()=>setRail(value=>!value)} onFork={openHosted} onShare={openHosted} onMembership={openHosted}
   controls={close=><div class="space-y-2"><ReaderPresenceControls preferences={reader.presence.preferences()} onChange={reader.presence.setPreference} viewers={reader.presence.viewers()} /><p>Remote access is read-only. Open original to post comments, change shared data or use your account.</p><Button variant="ghost" size="sm" onClick={()=>state()==='connected'?broker?.post({kind:'local-action',action:'save-copy',includePrivateState:false}):picker.click()}>Save linked HTML</Button><Show when={state()!=='connected'}><Button variant="ghost" size="sm" onClick={()=>broker?.retry()}>Retry</Button></Show><p>{state()==='connected'?'Save downloads a copy of this open page. Original disk file unchanged.':'Select the current HTML file to preserve disk edits; Save downloads a copy.'}</p><Show when={saveStatus()}><p role="status">{saveStatus()}</p></Show><p role="status">{state()==='connected'?'Connected read-only to the saved remote.':state()}</p><Button variant="ghost" size="sm" onClick={()=>{close();disconnect();}}>Disconnect</Button><Button variant="ghost" size="sm" onClick={()=>{close();broker?.post({kind:'local-action',action:'stay-offline'});}}>Stay offline</Button></div>} />
  <div class="h-8 flex items-center px-3 text-xs border-b bg-surface text-muted" role="status">{remoteChanged()?'File changed remotely. Open original to review; local edits stay here.':state()==='connected'?'Read-only remote · Save downloads a copy':state()==='stale'?'Saved revision changed. Open original to review.':'Local file · '+state()}</div>
  <Show when={state()==='connected'&&identity()&&nonce()}><Suspense><AnnotationLayer id={identity()!.artifactId} runtimeRef={runtimeRef} sessionNonce={nonce()} backend={reader.backend()} liveAnnotations={reader.annotations()} canCreateComment={false} canDeleteAny={false} railOpen={rail()} onRailOpenChange={setRail} showViewComments onAnnotationsChange={items=>setComments(items.filter(item=>item.status==='open').length)} /></Suspense></Show>
 </>;
}
