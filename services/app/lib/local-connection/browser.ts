import {validLinkedDocument} from './registry';
import type {LinkedDocument,LocalConnection,LocalConnectionState,LocalOperation} from './contracts';
export interface ConnectLocalDocumentOptions {
 win:Window;identity:LinkedDocument;privatePreview?:boolean;stayOffline?:boolean;
 onState(state:LocalConnectionState):void;
 onConnected?(value:{identity:LinkedDocument;role:string}):void;
 onMessage?(message:unknown):void;
 /** Tests can shorten a transport deadline without changing production policy. */
 timeoutMs?:number;
}
export interface LocalDocumentConnection extends LocalConnection {post(message:unknown):void}
/** No credential enters this window. The remote broker owns normal browser authentication. */
export function connectLocalDocument(options:ConnectLocalDocumentOptions):LocalDocumentConnection{
 const {win,identity}=options;let disposed=false,stopped=false,connected=false;
 let iframe:HTMLIFrameElement|undefined,popup:Window|null=null,remote:Window|null=null,port:MessagePort|undefined,timer:ReturnType<typeof setTimeout>|undefined,nonce='';let call=0;
 const pending=new Map<number,{resolve:(value:unknown)=>void;reject:(reason:Error)=>void;timer:ReturnType<typeof setTimeout>}>();
 const state=(value:LocalConnectionState)=>{if(!disposed)options.onState(value);};
 const failPending=()=>{for(const value of pending.values()){clearTimeout(value.timer);value.reject(Error('Connection ended; operation outcome may be unknown'));}pending.clear();};
 const cleanup=()=>{connected=false;clearTimeout(timer);port?.postMessage({kind:'disconnect'});port?.close();port=undefined;iframe?.remove();iframe=undefined;popup?.close();popup=null;remote=null;failPending();};
 const receive=(event:MessageEvent)=>{
  if(disposed||stopped||event.source!==remote||event.origin!==identity.platformOrigin||!event.data||event.data.kind!=='af:local-ready'||event.data.nonce!==nonce||port)return;
  const channel=new MessageChannel();port=channel.port1;
  port.onmessage=(message:MessageEvent)=>{
   const data=message.data;if(!data||typeof data!=='object')return;
   if(data.kind==='state'){
    const valid:LocalConnectionState[]=['offline','connecting','connected','signin-required','blocked','stale','unavailable','unknown-outcome'];
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
  remote!.postMessage({kind:'af:local-bind',nonce,identity},identity.platformOrigin,[channel.port2]);
 };
 const begin=(signIn=false)=>{
  if(disposed||options.privatePreview)return;
  if(!validLinkedDocument(identity)){state('unavailable');return;}
  stopped=false;cleanup();nonce=win.crypto.randomUUID();state('connecting');
  const address=new URL('/local/connect',identity.platformOrigin);address.hash=new URLSearchParams({nonce,...(signIn?{popup:'1'}:{})}).toString();
  if(signIn){
   const login=new URL('/login',identity.platformOrigin);login.searchParams.set('callbackUrl',address.pathname+address.hash);
   popup=win.open(login.href,'_blank');remote=popup;if(!popup){state('blocked');return;}
  }else{
   iframe=win.document.createElement('iframe');iframe.src=address.href;iframe.setAttribute('aria-label','Connected document controls');iframe.dataset.afLocalBroker='';
   // Chrome remains platform-owned; the shell can style this frame without inspecting its document.
   iframe.style.cssText='position:fixed;left:0;top:0;width:100%;height:56px;border:0;z-index:2147483646';
   win.document.documentElement.append(iframe);remote=iframe.contentWindow;
  }
  timer=setTimeout(()=>{cleanup();state('blocked');},options.timeoutMs??15_000);
 };
 win.addEventListener('message',receive);
 const connection:LocalDocumentConnection={
  retry(){if(!options.privatePreview)begin();},signIn(){if(!options.privatePreview)begin(true);},
  disconnect(){stopped=true;cleanup();state('offline');},
  dispose(){if(disposed)return;stopped=true;cleanup();win.removeEventListener('message',receive);disposed=true;},
  post(message){if(connected)port?.postMessage({kind:'bridge',message});},
  request(operation:LocalOperation){
   if(!connected||!port)return Promise.reject(Error('Document is disconnected'));
   const id=++call;
   return new Promise((resolve,reject)=>{
    const deadline=setTimeout(()=>{pending.delete(id);state('unknown-outcome');reject(Error('Operation outcome is unknown; check the remote result before retrying'));},options.timeoutMs??30_000);
    pending.set(id,{resolve,reject,timer:deadline});port!.postMessage({kind:'operation',call:id,operation});
   });
  },
 };
 if(!validLinkedDocument(identity)){state('unavailable');}
 else if(options.privatePreview||options.stayOffline){state('offline');}
 else begin();
 return connection;
}
