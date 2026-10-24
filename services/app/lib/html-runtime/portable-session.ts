import { connectLocalDocument } from '../local-connection/browser';
import type { LocalDocumentConnection } from '../local-connection/browser';
import type { PortableDocument } from './portable-contract';
import type { FrameBridgeFramePayload, FrameBridgeParentPayload } from '../story-runtime/contract';
interface PortableSessionOptions {
 win:Window;
 attach(post:(payload:FrameBridgeFramePayload)=>void):{receive(payload:FrameBridgeParentPayload):void;dispose():void};
 online(value:boolean,request?:LocalDocumentConnection['request']):void;
}
/** Thin transport only. Account, comments, dialogs and chrome stay on the platform origin. */
export function startPortableSession(options:PortableSessionOptions):()=>void {
 const {win}=options;
 const block=win.document.querySelector('script[data-af="portable"]');
 if(!block)return ()=>{};
 let portable:PortableDocument;
 try{portable=JSON.parse(block.textContent??'');}catch{return ()=>{};}
 if(!portable.identity)return ()=>{};
 let frame:ReturnType<PortableSessionOptions['attach']>|undefined;
 let connection:LocalDocumentConnection|undefined;
 let stayOffline=false;
 const key=`af:offline:${portable.identity.platformOrigin}:${portable.identity.artifactId}`;
 try{stayOffline=win.localStorage.getItem(key)==='true';}catch{/* Storage denied: session preference remains local. */}
 connection=connectLocalDocument({win,identity:portable.identity,privatePreview:win.document.documentElement.hasAttribute('data-af-private-preview'),stayOffline,
  onState(state){win.document.documentElement.setAttribute('data-af-connection',state);options.online(state==='connected',connection?.request);if(state!=='connected'){frame?.dispose();frame=undefined;}},
  onConnected(){options.online(true,connection!.request);frame=options.attach(payload=>connection!.post({kind:'frame',payload}));},
  onMessage(message){
   if(!message||typeof message!=='object')return;
   const data=message as {kind?:string;payload?:FrameBridgeParentPayload;expanded?:boolean;action?:string};
   if(data.kind==='frame'&&data.payload)frame?.receive(data.payload);
   if(data.kind==='chrome-size') {const iframe=win.document.querySelector<HTMLIFrameElement>('iframe[data-af-local-broker]');if(iframe)iframe.style.height=data.expanded?'100vh':'56px';}
   if(data.kind==='local-action'&&data.action==='disconnect'){connection!.disconnect();}
   if(data.kind==='local-action'&&data.action==='stay-offline'){try{win.localStorage.setItem(key,'true');}catch{/* optional preference */}connection!.disconnect();}
  },
 });
 return ()=>{frame?.dispose();connection?.dispose();options.online(false);};
}
