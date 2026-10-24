import { connectLocalDocument } from '../local-connection/browser';
import type { LocalDocumentConnection } from '../local-connection/browser';
import type { PortableDocument,PortableIdentity } from './portable-contract';
import type { PortableChromeHandle,PortableChromeState } from './portable-chrome-contract';
import {compareSource} from './source-relationship';
import {sha256Hex} from '@artifactbin/utils/sha256';
import type {HtmlJsonObject} from '@artifactbin/contracts';
import type { FrameBridgeFramePayload, FrameBridgeParentPayload } from '../story-runtime/contract';
interface PortableSessionOptions {
 win:Window;
 publishOrigin?:string;
 loadChrome?:()=>Promise<{stylesheet:string;mountPortableChrome(options:import('./portable-chrome-contract').PortableChromeOptions):PortableChromeHandle}>;
 connect?:typeof connectLocalDocument;
 attach(post:(payload:FrameBridgeFramePayload)=>void):{receive(payload:FrameBridgeParentPayload):void;dispose():void};
 adoptIdentity?(identity:PortableIdentity,source:string):void;
 online(value:boolean,request?:LocalDocumentConnection['request'],pending?:boolean):void;
}
/** Shared local chrome persists independently of the trusted remote connection. */
export function startPortableSession(options:PortableSessionOptions):()=>void {
 const {win}=options;
 let portable:PortableDocument={version:1,source:''};
 try{const raw=win.document.querySelector('script[data-af="portable"]')?.textContent;if(raw)portable=JSON.parse(raw);}catch{/* Invalid provenance never grants a connection. */}
 let identity:PortableIdentity|undefined=portable.identity;
 let frame:ReturnType<PortableSessionOptions['attach']>|undefined;
 let connection:LocalDocumentConnection|undefined;
 let chrome:PortableChromeHandle|undefined;
 let cancelFrameMount:()=>void=()=>{};
 let state:PortableChromeState='offline',disposed=false,attempt=0;
 let localDigest:string|undefined;
 let publishedSource:{source:string;localSourceDigest:string}|undefined;
 let remoteObservation:{remoteDigest:string;remoteRevision:string}|undefined;
 const privatePreview=win.document.documentElement.hasAttribute('data-af-private-preview');
 const preferenceKey=()=>identity?`af:offline:${identity.platformOrigin}:${identity.artifactId}`:null;
 const sourceStatus=()=>{
  const value=compareSource({baseDigest:identity?.sourceDigest,baseRevision:identity?.baseRevision,localDigest,...remoteObservation});
  const labels:Record<typeof value.state,string>={match:'Source matches the saved remote.',behind:'Remote source is newer. Local file preserved.','local-edits':'Local source has edits. Publish changes explicitly.',diverged:'Local and remote source changed. Review both copies.',converged:'Local and remote source match a newer revision.','unknown-base':'No verified common source base.','local-unverified':'Current file bytes have not been verified.','network-unknown':'Current remote source is unavailable.'};
  return labels[value.state];
 };
 const update=()=>{chrome?.update({state,kind:identity?'linked':'unpublished',...(identity?{identity}:{}),sourceStatus:sourceStatus()});chrome?.setVisible(!(win.document.querySelector('iframe[data-af-local-broker]')&&['connected','permission-required','signin-required','stale','unavailable','blocked'].includes(state)));};
 const disconnect=(remember=false)=>{
  if(remember){const key=preferenceKey();if(key)try{win.localStorage.setItem(key,'true');}catch{/* Optional browser preference. */}}
  attempt++;cancelFrameMount();connection?.dispose();connection=undefined;frame?.dispose();frame=undefined;options.online(false);state='offline';update();
 };
 const save=async(includePrivateState:boolean)=>{
  try{
   let privateState:HtmlJsonObject|undefined;
   if(includePrivateState){const name='@afbin/apollo';const author=await import(name) as {readViewerDocument():HtmlJsonObject};privateState=author.readViewerDocument();}
   const {saveLocalDocument}=await import('./save-local');
   const saved=await saveLocalDocument({win,identity,privateState,publishedSource,onSource(source){localDigest=sha256Hex(source);update();}});
   if(saved)chrome?.update({state,notice:'Download started. Original disk file unchanged.'});
  }catch(error){chrome?.update({state,notice:error instanceof Error?error.message:'Save failed. Original disk file unchanged.'});}
 };
 const connect=()=>{
  if(!identity||disposed)return;
  if(privatePreview){chrome?.update({state,notice:'Private preview stays local. Open the saved file outside private preview to connect.'});return;}
  const key=preferenceKey();if(key)try{win.localStorage.removeItem(key);}catch{/* Optional browser preference. */}
  const epoch=++attempt;cancelFrameMount();connection?.dispose();frame?.dispose();frame=undefined;
  let current:LocalDocumentConnection|undefined,ready=false,active=false;
  const activate=()=>{
   if(disposed||epoch!==attempt||!ready||!current||active)return;
   active=true;const transport=current;
   const attachFrame=()=>{
    if(disposed||epoch!==attempt||!active||!win.document.body)return;
    frame=options.attach(payload=>transport.post({kind:'frame',payload}));
   };
   if(win.document.body)attachFrame();
   else{win.document.addEventListener('DOMContentLoaded',attachFrame,{once:true});cancelFrameMount=()=>win.document.removeEventListener('DOMContentLoaded',attachFrame);}
   options.online(true,transport.request);
  };
  current=(options.connect??connectLocalDocument)({win,identity,onSourceObservation(value){if(epoch!==attempt||disposed)return;remoteObservation=value;update();},
   onState(next){if(epoch!==attempt||disposed)return;state=next;win.document.documentElement.setAttribute('data-af-connection',next);if(next!=='connected'){ready=false;active=false;cancelFrameMount();options.online(false,undefined,next==='connecting');frame?.dispose();frame=undefined;}update();},
   onConnected(){if(epoch!==attempt||disposed)return;ready=true;activate();},
   onMessage(message){
    if(epoch!==attempt||disposed)return;
    if(!message||typeof message!=='object')return;
    const data=message as {kind?:string;payload?:FrameBridgeParentPayload;action?:string;includePrivateState?:boolean};
    if(data.kind==='frame'&&data.payload)frame?.receive(data.payload);
    if(data.kind==='local-action'){
     if(data.action==='disconnect')disconnect();
     if(data.action==='stay-offline')disconnect(true);
     if(data.action==='save-copy')void save(data.includePrivateState===true);
    }
   },
  });
  connection=current;activate();
 };
 const publish=async(platformOrigin:string)=>{
  try{const {publishLocalDocument}=await import('../local-publication');publishLocalDocument({win,platformOrigin,onPublished(receipt){identity=receipt.identity;if(receipt.localSourceDigest)publishedSource={source:receipt.source,localSourceDigest:receipt.localSourceDigest};options.adoptIdentity?.(identity,receipt.source);remoteObservation={remoteDigest:identity.sourceDigest,remoteRevision:identity.baseRevision};update();chrome?.update({state,notice:'Published—Save linked HTML and reopen to load its saved identity and any new comment anchors.'});connect();}});}catch(error){chrome?.update({state,notice:error instanceof Error?error.message:'Publication could not open.'});}
 };
 const previewStatus=(event:Event)=>{const detail=(event as CustomEvent<{changed:boolean;connected:boolean;error?:string}>).detail;if(detail)chrome?.update({state,previewStatus:detail});};
 win.addEventListener('af:preview-status',previewStatus);
 let bodyPadding:string|undefined;
 let cancelChromeMount:()=>void=()=>{};
 const mount=async()=>{
  const name='@afbin/chrome';
  const module=options.loadChrome?await options.loadChrome():await import(name) as {stylesheet:string;mountPortableChrome(options:import('./portable-chrome-contract').PortableChromeOptions):PortableChromeHandle};
  if(disposed)return;
  if(!win.document.body)await new Promise<void>(resolve=>{const ready=()=>resolve();win.document.addEventListener('DOMContentLoaded',ready,{once:true});cancelChromeMount=()=>{win.document.removeEventListener('DOMContentLoaded',ready);resolve();};});
  if(disposed)return;
  bodyPadding=win.document.body.style.paddingTop;
  let mode:'light'|'dark'=win.document.documentElement.hasAttribute('data-af-dark')?'dark':'light';
  try{const stored=win.localStorage.getItem('af:local-color-mode');if(stored==='light'||stored==='dark')mode=stored;}catch{/* Optional viewer preference. */}
  chrome=module.mountPortableChrome({mode,onMode(next){try{win.localStorage.setItem('af:local-color-mode',next);}catch{/* Optional viewer preference. */}},onReloadPreview(){win.dispatchEvent(new Event('af:preview-reload'));},win,stylesheet:module.stylesheet,title:win.document.title||'Local file',kind:identity?'linked':'unpublished',identity,state,publishOrigin:options.publishOrigin,onConnect:connect,onDisconnect:()=>disconnect(),onStayOffline:()=>disconnect(true),onSave:request=>save(request.includePrivateState),onPublish:request=>void publish(request.platformOrigin),onOpenHosted(){if(identity)win.open(`${identity.platformOrigin}/a/${encodeURIComponent(identity.artifactId)}`,'_blank','noopener');}});
  win.document.body.style.paddingTop=`calc(${win.getComputedStyle(win.document.body).paddingTop} + 76px)`;
  win.document.documentElement.setAttribute('data-af-local-chrome-ready','true');
  update();
 };
 let stayOffline=false;const key=preferenceKey();if(key)try{stayOffline=win.localStorage.getItem(key)==='true';}catch{/* Session only. */}
 if(identity&&!privatePreview&&!stayOffline)connect();else options.online(false);
 void mount().catch(()=>{win.document.documentElement.setAttribute('data-af-connection','unavailable');});
 return ()=>{disposed=true;cancelChromeMount();disconnect();chrome?.dispose();if(bodyPadding!==undefined&&win.document.body)win.document.body.style.paddingTop=bodyPadding;win.document.documentElement.removeAttribute('data-af-local-chrome-ready');win.removeEventListener('af:preview-status',previewStatus);};
}
