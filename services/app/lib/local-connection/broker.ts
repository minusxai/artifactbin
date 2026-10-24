import {validLinkedDocument} from './registry';
import type {LinkedDocument,LocalConnectionState} from './contracts';
export interface LocalBrokerOptions {
 win:Window;
 onState(state:LocalConnectionState):void;
 onIdentity?(identity:LinkedDocument):void;
 onConnected?(value:{identity:LinkedDocument;role:string}):void;
 onMessage?(message:unknown):void;
}
export interface LocalConnectionBroker {post(message:unknown):void;authorize():void;retry():void;signIn():void;disconnect():void;resize(height:number):void;dispose():void}
/** Platform-origin only. Capabilities and authentication remain inside this document. */
export function installLocalConnectionBroker(options:LocalBrokerOptions):LocalConnectionBroker{
 const {win}=options,params=new URLSearchParams(win.location.hash.slice(1)),nonce=params.get('nonce');
 const source=params.get('popup')==='1'?win.opener:win.parent;
 let port:MessagePort|undefined,identity:LinkedDocument|undefined,capability:string|undefined,disposed=false,connected=false,generation=0,authorized=false;
 const credentials=():RequestCredentials=>authorized||params.get('popup')==='1'?'same-origin':'omit';
 const controllers=new Set<AbortController>(),calls=new Set<number>();
 const state=(value:LocalConnectionState,role?:string)=>{if(disposed)return;connected=value==='connected';options.onState(value);port?.postMessage({kind:'state',state:value,...(role?{role}:{})});};
 const revoke=()=>{const cap=capability;capability=undefined;connected=false;generation++;for(const controller of controllers)controller.abort();controllers.clear();calls.clear();if(cap)void win.fetch('/api/local-connection',{method:'DELETE',credentials:credentials(),headers:{'Content-Type':'application/json','X-Af-Local-Capability':cap},keepalive:true}).catch(()=>{});};
 const receive=async(event:MessageEvent)=>{
  if(disposed||!nonce||nonce.length>128||event.source!==source||port||!event.data||event.data.kind!=='af:local-bind'||event.data.nonce!==nonce||event.ports.length!==1)return;
  // file:// is opaque. For HTTP local callers require loopback, not arbitrary websites.
  let local=event.origin==='null';try{const origin=new URL(event.origin);local||=origin.protocol==='http:'&&['localhost','127.0.0.1','[::1]'].includes(origin.hostname);}catch{/* Opaque file origin. */}
  if(!local||!validLinkedDocument(event.data.identity)||event.data.identity.platformOrigin!==win.location.origin)return;
  clearInterval(ready);identity={...event.data.identity};options.onIdentity?.(identity!);port=event.ports[0];
  port.onmessage=async(message:MessageEvent)=>{
   const data=message.data;if(!data||typeof data!=='object')return;
   if(data.kind==='disconnect'){revoke();state('offline');port?.close();return;}
   if(data.kind==='bridge'){if(connected)options.onMessage?.(data.message);return;}
   if(data.kind!=='operation'||!connected||!capability||!identity||!Number.isSafeInteger(data.call)||data.call<1||calls.has(data.call))return;
   const operation=data.operation;
   if(!operation||typeof operation.query!=='string'||operation.query.length>1_000_000){port?.postMessage({kind:'result',call:data.call,error:'invalid_operation'});return;}
   calls.add(data.call);const epoch=generation,controller=new AbortController();controllers.add(controller);
   try{
    const response=await win.fetch(`/api/local-connection/${encodeURIComponent(identity.artifactId)}/graphql`,{method:'POST',credentials:credentials(),signal:controller.signal,headers:{'Content-Type':'application/json','X-Af-Local-Capability':capability},body:JSON.stringify({...operation,revision:identity.baseRevision})});
    const value=await response.json();if(disposed||epoch!==generation)return;
    if(!response.ok){if(response.status===401||response.status===403||response.status===409||response.status===410){revoke();state(response.status===409?'stale':'signin-required');}port?.postMessage({kind:'result',call:data.call,error:value.error??'operation_unavailable'});return;}
    port?.postMessage({kind:'result',call:data.call,value});
   }catch{if(!disposed&&epoch===generation){state('unknown-outcome');port?.postMessage({kind:'result',call:data.call,error:'Operation outcome is unknown; do not automatically retry'});}}
   finally{controllers.delete(controller);calls.delete(data.call);}
  };
  port.start();await connect();
 };
 const connect=async()=>{
  if(!identity||disposed)return;state('connecting');const epoch=generation,controller=new AbortController();controllers.add(controller);
  try{
   const response=await win.fetch('/api/local-connection',{method:'POST',credentials:credentials(),signal:controller.signal,headers:{'Content-Type':'application/json'},body:JSON.stringify({identity,authorizePrivate:authorized,checkSession:params.get('popup')==='1'})});
   const value=await response.json();if(disposed||generation!==epoch)return;
   if(!response.ok){state(response.status===409?'stale':response.status===401?'signin-required':response.status===403?'permission-required':'unavailable');return;}
   if(typeof value.capability!=='string'||typeof value.role!=='string'){state('blocked');return;}
   capability=value.capability;state('connected',value.role);options.onConnected?.({identity:identity!,role:value.role});
  }catch{if(!disposed&&generation===epoch)state('blocked');}finally{controllers.delete(controller);}
 };
 win.addEventListener('message',receive);
 const announce=()=>{if(!disposed&&nonce&&source&&source!==win)source.postMessage({kind:'af:local-ready',nonce},'*');};
 const ready=setInterval(announce,250);announce();
 const dispose=()=>{if(disposed)return;revoke();disposed=true;clearInterval(ready);port?.close();win.removeEventListener('message',receive);win.removeEventListener('pagehide',dispose);};
 win.addEventListener('pagehide',dispose);
 return {retry(){void connect();},signIn(){port?.postMessage({kind:'signin'});},disconnect(){revoke();state('offline');},resize(height){if(Number.isFinite(height))port?.postMessage({kind:'chrome-size',height:Math.max(40,Math.min(1000,height))});},authorize(){if(!disposed&&identity){authorized=true;void connect();}},post(message){if(connected)port?.postMessage({kind:'bridge',message});},dispose};
}
