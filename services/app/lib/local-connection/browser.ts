import {LOCAL_CHROME_COLLAPSED_HEIGHT,LOCAL_CHROME_CANVAS_SCHEME} from './contracts';
import {runtimeId} from '@artifactbin/utils/runtime-id';
import {validLinkedDocument} from './registry';
import type {LinkedDocument,LocalConnection,LocalConnectionState,LocalOperation,SourceObservation} from './contracts';
export interface ConnectLocalDocumentOptions {
 win:Window;identity:LinkedDocument;privatePreview?:boolean;stayOffline?:boolean;
 onState(state:LocalConnectionState):void;
 onConnected?(value:{identity:LinkedDocument;role:string}):void;
 onMessage?(message:unknown):void;
 onSourceObservation?(observation:SourceObservation):void;
 /** Tests can shorten a transport deadline without changing production policy. */
 timeoutMs?:number;
}
export interface LocalDocumentConnection extends LocalConnection {post(message:unknown):void}
/** No credential enters this window. The remote broker owns normal browser authentication. */
export function connectLocalDocument(options:ConnectLocalDocumentOptions):LocalDocumentConnection{
 const {win,identity}=options;let disposed=false,stopped=false,connected=false;
 let iframe:HTMLIFrameElement|undefined,remote:Window|null=null,port:MessagePort|undefined,timer:ReturnType<typeof setTimeout>|undefined,nonce='';let call=0,generation=0;
 let chromeHeight:number|'viewport'=LOCAL_CHROME_COLLAPSED_HEIGHT;
 const resizeChrome=()=>{if(iframe)iframe.style.height=Math.max(40,Math.min(win.innerHeight||1000,chromeHeight==='viewport'?(win.innerHeight||1000):chromeHeight))+'px';};
 const pending=new Map<number,{resolve:(value:unknown)=>void;reject:(reason:Error)=>void;timer:ReturnType<typeof setTimeout>}>();
 const state=(value:LocalConnectionState)=>{if(!disposed)options.onState(value);};
 const failPending=()=>{for(const value of pending.values()){clearTimeout(value.timer);value.reject(Error('Connection ended; operation outcome may be unknown'));}pending.clear();};
 const cleanup=()=>{generation++;connected=false;clearTimeout(timer);port?.postMessage({kind:'disconnect'});port?.close();port=undefined;iframe?.remove();iframe=undefined;remote=null;failPending();};
 const receive=(event:MessageEvent)=>{
  if(disposed||stopped||event.source!==remote||event.origin!==identity.platformOrigin||!event.data||event.data.kind!=='af:local-ready'||event.data.nonce!==nonce||port)return;
  const epoch=generation,channel=new MessageChannel();port=channel.port1;
  port.onmessage=(message:MessageEvent)=>{
   if(disposed||stopped||epoch!==generation)return;
   const data=message.data;if(!data||typeof data!=='object')return;
   if(data.kind==='source-observation'){
    if(typeof data.remoteDigest==='string'&&/^[a-f0-9]{64}$/.test(data.remoteDigest)&&typeof data.remoteRevision==='string'&&/^[1-9]\d*$/.test(data.remoteRevision))options.onSourceObservation?.({remoteDigest:data.remoteDigest,remoteRevision:data.remoteRevision});return;
   }
   if(data.kind==='chrome-size'&&iframe){if(data.mode==='viewport')chromeHeight='viewport';else if(Number.isFinite(data.height))chromeHeight=Math.max(40,Math.min(1000,data.height));else return;resizeChrome();return;}
   if(data.kind==='state'){
    const valid:LocalConnectionState[]=['offline','connecting','connected','signin-required','permission-required','blocked','stale','unavailable','unknown-outcome'];
    if(!valid.includes(data.state))return;
    connected=data.state==='connected';clearTimeout(timer);state(data.state);
    if(connected&&typeof data.role==='string')options.onConnected?.({identity,role:data.role});
    if(!connected)failPending();
   }else if(data.kind==='result'&&Number.isSafeInteger(data.call)){
    const waiter=pending.get(data.call);if(!waiter)return;clearTimeout(waiter.timer);pending.delete(data.call);
    if(typeof data.error==='string')waiter.reject(Error(data.error));else waiter.resolve(data.value);
   }else if(data.kind==='bridge'&&connected)options.onMessage?.(data.message);
  };
  port.onmessageerror=()=>{cleanup();state('blocked');};port.start();
  remote!.postMessage({kind:'af:local-bind',nonce,identity,observeSource:options.onSourceObservation!==undefined},identity.platformOrigin,[channel.port2]);
 };
 const begin=()=>{
  if(disposed||options.privatePreview)return;
  if(!validLinkedDocument(identity)){state('unavailable');return;}
  stopped=false;cleanup();try{nonce=runtimeId(win.crypto??null);}catch(error){state('blocked');throw error;}state('connecting');
  const address=new URL('/local/connect',identity.platformOrigin);address.hash=new URLSearchParams({nonce}).toString();
  iframe=win.document.createElement('iframe');iframe.src=address.href;iframe.setAttribute('aria-label','Connected document controls');iframe.dataset.afLocalBroker='';
  iframe.style.cssText=`position:fixed;left:0;top:0;width:100%;height:${LOCAL_CHROME_COLLAPSED_HEIGHT}px;border:0;z-index:2147483646`;
  iframe.style.colorScheme=LOCAL_CHROME_CANVAS_SCHEME;chromeHeight=LOCAL_CHROME_COLLAPSED_HEIGHT;resizeChrome();win.document.documentElement.append(iframe);remote=iframe.contentWindow;
  timer=setTimeout(()=>{cleanup();state('blocked');},options.timeoutMs??15_000);
 };
 win.addEventListener('message',receive);win.addEventListener('resize',resizeChrome);
 const connection:LocalDocumentConnection={
  retry(){if(!options.privatePreview)begin();},
  disconnect(){stopped=true;cleanup();state('offline');},
  dispose(){if(disposed)return;stopped=true;cleanup();win.removeEventListener('message',receive);win.removeEventListener('resize',resizeChrome);disposed=true;},
  post(message){if(connected)port?.postMessage({kind:'bridge',message});},
  request(operation:LocalOperation){
   if(!connected||!port)return Promise.reject(Error('Document is disconnected'));
   const id=++call;
   return new Promise((resolve,reject)=>{
    const deadline=setTimeout(()=>{pending.delete(id);cleanup();state('unknown-outcome');reject(Error('Operation outcome is unknown; check the remote result before retrying'));},options.timeoutMs??30_000);
    pending.set(id,{resolve,reject,timer:deadline});port!.postMessage({kind:'operation',call:id,operation});
   });
  },
 };
 if(!validLinkedDocument(identity)){state('unavailable');}
 else if(options.privatePreview||options.stayOffline){state('offline');}
 else {try{begin();}catch(error){win.removeEventListener('message',receive);win.removeEventListener('resize',resizeChrome);disposed=true;throw error;}}
 return connection;
}
