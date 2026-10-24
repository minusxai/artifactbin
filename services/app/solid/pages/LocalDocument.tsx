/* @jsxImportSource solid-js */
import {createEffect,createSignal,lazy,on,onCleanup,onMount,Show,Suspense} from 'solid-js';
import {installLocalConnectionBroker,type LocalConnectionBroker} from '@/lib/local-connection/broker';
import type {LinkedDocument,LocalConnectionState} from '@/lib/local-connection/contracts';
import {STORY_READER_MODE_MESSAGE,type StoryController,type FrameBridgeFramePayload} from '@/lib/story-runtime/contract';
import {chooseTheme,storedTheme} from '@/lib/story-runtime/reader-mode';
import {createAppAppearance} from '../ui/theme';
import type {DocumentRuntimeRef} from '@/lib/story-runtime/document-endpoint';
import {commentAccess} from '../document/comment-access';
import type {ArtifactRole} from '@artifactbin/contracts';
import {DocumentChrome} from '../document/DocumentChrome';
import type {Panel} from '../components/PageChrome';
import {Input} from '../ui/Field';
import {Button} from '../ui/Button';
import {serializePortableCopy,downloadPortableCopy} from '@/lib/html-runtime/browser-portable';
import {readPortableDocument} from '@/lib/html-runtime/portable';
import {useSession} from '../lib/session';
const AnnotationLayer=lazy(()=>import('../document/AnnotationLayer').then(module=>({default:module.AnnotationLayer})));
/** Shared platform chrome and comments; author HTML never runs on this origin. */
export function LocalDocumentPage(){
 const {session}=useSession();
 const [state,setState]=createSignal<LocalConnectionState>('connecting');
 const [identity,setIdentity]=createSignal<LinkedDocument>();
 const [role,setRole]=createSignal('viewer');
 const [authenticated,setAuthenticated]=createSignal(false);
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
 const commentPermissions=()=>commentAccess(role() as ArtifactRole,authenticated(),false);
 const upgradeAccount=()=>{if(session()?.kind==='account')broker?.authorize();else broker?.signIn();};
 const hosted=()=>identity()?`${identity()!.platformOrigin}/a/${encodeURIComponent(identity()!.artifactId)}`:null;
 const openHosted=()=>{const url=hosted();if(url)window.open(url,'_blank','noopener');};
 onMount(()=>{
  broker=installLocalConnectionBroker({win:window,onState:setState,onIdentity:setIdentity,onSourceObservation(observation){const current=identity();setRemoteChanged(Boolean(current&&observation.remoteDigest!==current.sourceDigest));},onConnected(value){
   setIdentity(value.identity);setRole(value.role);setAuthenticated(value.authenticated===true);
   const controller:StoryController={nonce:'local',send(command){broker!.post({kind:'frame',payload:{kind:'send',command}});},update(){},invalidate(datasets){controller.send({type:'mx:data',datasets});},subscribe(listener){listeners.add(listener);return()=>listeners.delete(listener);},getViewportRect(){return new DOMRect(0,0,window.innerWidth,window.innerHeight);},dispose(){listeners.clear();}};
   runtimeRef.current=controller;
   void fetch(`/api/page/artifact/${encodeURIComponent(value.identity.artifactId)}`,{credentials:'same-origin'}).then(response=>response.ok?response.json():null).then(page=>{if(page?.surface?.title)setTitle(page.surface.title);});
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
  <DocumentChrome id={identity()?.artifactId??'local'} title={title} author={null} like={{liked:false,count:0}} signedIn={()=>session()?.kind==='account'} comments={comments} canFork={false} owner={false} remoteAvailable={state()==='connected'}
   panel={panel} setPanel={setPanel} mode={appAppearance} onMode={chooseMode} onComment={()=>setRail(value=>!value)} onFork={openHosted} onShare={openHosted} onMembership={openHosted}
   controls={close=><div class="space-y-2"><Show when={state()==='connected'&&!authenticated()}><p>Connected as a guest. Use an account for permitted comments and shared changes.</p><Show when={session()?.kind==='account'} fallback={<Button variant="secondary" size="sm" onClick={()=>broker?.signIn()}>Sign in</Button>}><Button variant="secondary" size="sm" onClick={()=>broker?.authorize()}>Use my account</Button></Show></Show><Show when={state()==='permission-required'}><Button variant="secondary" size="sm" onClick={()=>broker?.authorize()}>Connect this file</Button><p>Allow this saved file to use this account for its original remote.</p></Show><Show when={state()==='signin-required'}><Button variant="secondary" size="sm" onClick={()=>broker?.signIn()}>Sign in</Button></Show><Button variant="ghost" size="sm" onClick={()=>state()==='connected'?broker?.post({kind:'local-action',action:'save-copy',includePrivateState:false}):picker.click()}>Save linked HTML</Button><Show when={state()!=='connected'}><Button variant="ghost" size="sm" onClick={()=>broker?.retry()}>Retry</Button></Show><p>Select the current HTML file to preserve edits on disk. Saving downloads a copy.</p><Show when={saveStatus()}><p role="status">{saveStatus()}</p></Show><p role="status">{state()==='connected'?'Connected to the saved remote.':state()}</p><Show when={hosted()}><Button variant="ghost" size="sm" onClick={openHosted}>Open hosted</Button></Show><Button variant="ghost" size="sm" onClick={()=>{close();disconnect();}}>Disconnect</Button><Button variant="ghost" size="sm" onClick={()=>{close();broker?.post({kind:'local-action',action:'stay-offline'});}}>Stay offline</Button></div>} />
  <div class="h-8 flex items-center px-3 text-xs border-b bg-surface text-muted" role="status">{remoteChanged()?'File changed remotely. Open hosted to review; local edits stay here.':state()==='connected'?'Connected to original remote · Save downloads a copy':state()==='stale'?'Saved revision changed. Open hosted to review.':'Local file · '+state()}</div>
  <Show when={state()==='connected'&&identity()&&nonce()}><Suspense><AnnotationLayer id={identity()!.artifactId} runtimeRef={runtimeRef} sessionNonce={nonce()} canCreateComment={commentPermissions().canCreateComment} onSignIn={!authenticated()?upgradeAccount:undefined} canDeleteAny={role()==='owner'} railOpen={rail()} onRailOpenChange={setRail} showViewComments onAnnotationsChange={items=>setComments(items.filter(item=>item.status==='open').length)} /></Suspense></Show>
 </>;
}
