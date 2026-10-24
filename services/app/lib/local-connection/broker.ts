import {startConnectionMonitor} from './monitor';
import {validLinkedDocument} from './registry';
import type {LinkedDocument,LocalConnectionState,SourceObservation} from './contracts';
export interface LocalBrokerOptions {
 win:Window;
 onState(state:LocalConnectionState):void;
 onIdentity?(identity:LinkedDocument):void;
 onConnected?(value:{identity:LinkedDocument;role:string}):void;
 onMessage?(message:unknown):void;
 onSourceObservation?(observation:SourceObservation):void;
}
export interface LocalConnectionBroker {post(message:unknown):void;authorize():void;retry():void;signIn():void;disconnect():void;resize(height:number):void;dispose():void}
/** Platform-origin only. Capabilities and authentication remain inside this document. */
export function installLocalConnectionBroker(options:LocalBrokerOptions):LocalConnectionBroker{
 const {win}=options,params=new URLSearchParams(win.location.hash.slice(1)),nonce=params.get('nonce');
 const source=win.parent;
 if(params.get('auth-return')==='1'){win.opener?.postMessage({kind:'af:local-authenticated',nonce},win.location.origin);return {post(){},authorize(){},retry(){},signIn(){},disconnect(){},resize(){},dispose(){}};}
 let port:MessagePort|undefined,identity:LinkedDocument|undefined,capability:string|undefined,disposed=false,connected=false,generation=0,authorized=false,sessionCheck=false,loginCompleted=false,observe=false;
 let monitor:ReturnType<typeof startConnectionMonitor>|undefined;
 let popup:Window|null=null,authNonce='',authTimer:ReturnType<typeof setTimeout>|undefined;
 const credentials=():RequestCredentials=>authorized||sessionCheck?'same-origin':'omit';
 const controllers=new Set<AbortController>(),calls=new Set<number>(),seen=new Set<number>();
 const state=(value:LocalConnectionState,role?:string)=>{if(disposed)return;connected=value==='connected';options.onState(value);port?.postMessage({kind:'state',state:value,...(role?{role}:{})});};
 const revoke=()=>{monitor?.dispose();monitor=undefined;const cap=capability;capability=undefined;authorized=false;connected=false;generation++;for(const controller of controllers)controller.abort();controllers.clear();calls.clear();if(cap)void win.fetch('/api/local-connection',{method:'DELETE',credentials:credentials(),headers:{'Content-Type':'application/json','X-Af-Local-Capability':cap},keepalive:true}).catch(()=>{});};
 const receive=async(event:MessageEvent)=>{
  if(event.source===popup&&popup&&event.origin===win.location.origin&&event.data?.kind==='af:local-authenticated'&&event.data.nonce===authNonce){
   clearTimeout(authTimer);popup.close();popup=null;loginCompleted=true;sessionCheck=true;void connect();return;
  }
  if(disposed||!nonce||nonce.length>128||event.source!==source||port||!event.data||event.data.kind!=='af:local-bind'||event.data.nonce!==nonce||event.ports.length!==1)return;
  // file:// is opaque. For HTTP local callers require loopback, not arbitrary websites.
  let local=event.origin==='null';try{const origin=new URL(event.origin);local||=origin.protocol==='http:'&&['localhost','127.0.0.1','[::1]'].includes(origin.hostname);}catch{/* Opaque file origin. */}
  if(!local||!validLinkedDocument(event.data.identity)||event.data.identity.platformOrigin!==win.location.origin)return;
  clearInterval(ready);observe=options.onSourceObservation!==undefined||event.data.observeSource===true;identity={...event.data.identity};options.onIdentity?.(identity!);port=event.ports[0];
  port.onmessage=async(message:MessageEvent)=>{
   const data=message.data;if(!data||typeof data!=='object')return;
   if(data.kind==='disconnect'){revoke();state('offline');port?.close();return;}
   if(data.kind==='bridge'){if(connected)options.onMessage?.(data.message);return;}
   if(data.kind!=='operation'||!connected||!capability||!identity||!Number.isSafeInteger(data.call)||data.call<1||seen.has(data.call))return;
   if(calls.size>=16||seen.size>=4096){port?.postMessage({kind:'result',call:data.call,error:'connection_busy'});return;}
   const operation=data.operation;
   if(!operation||typeof operation.query!=='string'||JSON.stringify(operation).length>1_000_000){port?.postMessage({kind:'result',call:data.call,error:'invalid_operation'});return;}
   seen.add(data.call);calls.add(data.call);const epoch=generation,controller=new AbortController();controllers.add(controller);
   try{
    const response=await win.fetch(`/api/local-connection/${encodeURIComponent(identity.artifactId)}/graphql`,{method:'POST',credentials:credentials(),signal:controller.signal,headers:{'Content-Type':'application/json','X-Af-Local-Capability':capability},body:JSON.stringify({...operation,revision:identity.baseRevision})});
    const text=await response.text();if(text.length>4_000_000)throw Error('response_too_large');
    const value=JSON.parse(text);if(disposed||epoch!==generation)return;
    if(!response.ok){if(response.status===401||response.status===403||response.status===404||response.status===409||response.status===410){revoke();state(response.status===409?'stale':response.status===404?'unavailable':'signin-required');}port?.postMessage({kind:'result',call:data.call,error:value.error??'operation_unavailable'});return;}
    port?.postMessage({kind:'result',call:data.call,value});
   }catch{if(!disposed&&epoch===generation){revoke();state('unknown-outcome');port?.postMessage({kind:'result',call:data.call,error:'Operation outcome is unknown; do not automatically retry'});}}
   finally{controllers.delete(controller);calls.delete(data.call);}
  };
  port.start();await connect();
 };
 const connect=async()=>{
  if(!identity||disposed)return;state('connecting');const epoch=generation,controller=new AbortController();controllers.add(controller);
  try{
   let response=await win.fetch('/api/local-connection',{method:'POST',credentials:credentials(),signal:controller.signal,headers:{'Content-Type':'application/json'},body:JSON.stringify({identity,authorizePrivate:authorized,checkSession:sessionCheck})});
   if(response.status===401&&!sessionCheck&&!authorized){sessionCheck=true;response=await win.fetch('/api/local-connection',{method:'POST',credentials:'same-origin',signal:controller.signal,headers:{'Content-Type':'application/json'},body:JSON.stringify({identity,checkSession:true})});}
   const value=await response.json();if(disposed||generation!==epoch)return;
   if(observe&&(response.ok||response.status===409)){
    const observed=await win.fetch('/api/local-connection/observe-source',{method:'POST',credentials:credentials(),signal:controller.signal,headers:{'Content-Type':'application/json'},body:JSON.stringify({identity,authorizePrivate:authorized,checkSession:sessionCheck})});
    if(observed.ok){
     const observation=await observed.json();if(disposed||generation!==epoch)return;
     if(typeof observation.remoteDigest==='string'&&/^[a-f0-9]{64}$/.test(observation.remoteDigest)&&typeof observation.remoteRevision==='string'&&/^[1-9]\d*$/.test(observation.remoteRevision)){
      const evidence:SourceObservation={remoteDigest:observation.remoteDigest,remoteRevision:observation.remoteRevision};options.onSourceObservation?.(evidence);port?.postMessage({kind:'source-observation',...evidence});
     }
    }
   }
   if(!response.ok){state(response.status===409?'stale':response.status===401?(loginCompleted?'blocked':'signin-required'):response.status===403?'permission-required':'unavailable');return;}
   if(typeof value.capability!=='string'||typeof value.role!=='string'){state('blocked');return;}
   capability=value.capability;state('connected',value.role);options.onConnected?.({identity:identity!,role:value.role});
   const activeCapability=capability!,activeIdentity=identity!,activeRole=value.role;
   monitor?.dispose();monitor=startConnectionMonitor({foreground:()=>win.document.visibilityState!=='hidden',
    async poll(signal){
     const response=await win.fetch(`/api/local-connection/${encodeURIComponent(activeIdentity.artifactId)}/status`,{method:'GET',credentials:credentials(),signal,headers:{'X-Af-Local-Capability':activeCapability}});
     if(!response.ok)throw Object.assign(Error('connection_unavailable'),{status:response.status});
     const status=await response.json();
     if(typeof status.compatible!=='boolean'||typeof status.role!=='string'||typeof status.remoteDigest!=='string'||!/^[a-f0-9]{64}$/.test(status.remoteDigest)||typeof status.remoteRevision!=='string'||!/^[1-9]\d*$/.test(status.remoteRevision))throw Error('invalid_connection_status');
     return status;
    },
    onStatus(status){
     if(disposed||epoch!==generation||capability!==activeCapability)return;
     const evidence:SourceObservation={remoteDigest:status.remoteDigest,remoteRevision:status.remoteRevision};
     if(!status.compatible||status.remoteDigest!==activeIdentity.sourceDigest||status.remoteRevision!==activeIdentity.baseRevision){
      options.onSourceObservation?.(evidence);port?.postMessage({kind:'source-observation',...evidence});revoke();state('stale');
     }else if(status.role!==activeRole){revoke();state('permission-required');}
    },
    onFailure(error){
     if(disposed||epoch!==generation||capability!==activeCapability)return;
     const status=error&&typeof error==='object'&&'status' in error?error.status:undefined;
     revoke();state(status===401||status===403||status===410?'signin-required':status===404?'unavailable':'blocked');
    },
   });
  }catch{if(!disposed&&generation===epoch)state('blocked');}finally{controllers.delete(controller);}
 };
 win.addEventListener('message',receive);
 const announce=()=>{if(!disposed&&nonce&&source&&source!==win)source.postMessage({kind:'af:local-ready',nonce},'*');};
 const ready=setInterval(announce,250);announce();
 const dispose=()=>{if(disposed)return;revoke();popup?.close();popup=null;clearTimeout(authTimer);disposed=true;clearInterval(ready);port?.close();win.removeEventListener('message',receive);win.removeEventListener('pagehide',dispose);win.removeEventListener('focus',wake);win.document.removeEventListener('visibilitychange',wake);};
 const wake=()=>monitor?.wake();
 win.addEventListener('focus',wake);win.document.addEventListener('visibilitychange',wake);
 win.addEventListener('pagehide',dispose);
 return {retry(){if(!connected){revoke();void connect();}},signIn(){
  if(disposed||!identity)return;popup?.close();authNonce=win.crypto.randomUUID();
  const target='/local/connect#'+new URLSearchParams({nonce:authNonce,'auth-return':'1'});
  popup=win.open('/login?callbackUrl='+encodeURIComponent(target),'_blank');
  if(!popup){state('blocked');return;}
  state('signin-required');clearTimeout(authTimer);authTimer=setTimeout(()=>{popup?.close();popup=null;state('blocked');},300_000);
 },disconnect(){revoke();state('offline');},resize(height){if(Number.isFinite(height))port?.postMessage({kind:'chrome-size',height:Math.max(40,Math.min(1000,height))});},authorize(){if(!disposed&&identity){revoke();authorized=true;void connect();}},post(message){if(connected)port?.postMessage({kind:'bridge',message});},dispose};
}
