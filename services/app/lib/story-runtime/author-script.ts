import {connectManagedComments} from './managed-comment-host';
import type { DataflowStore } from './store';
import { createAuthorScriptBridge } from './author-script-bridge';
import { AUTHOR_SCRIPT_DOCUMENT } from './author-script-bootstrap';
import { AUTHOR_SCRIPT_FRAME_TITLE, AUTHOR_SCRIPT_INIT, type AuthorScriptSnapshot } from './author-script-contract';
import { authorStateDelta } from './author-state';
import type { DataflowState } from '@/lib/story/dataflow';
import { AUTHOR_FRAME_PATH } from './author-frame';
import type {ManagedIframeContent} from '@/lib/story/managed-iframe';
import {createManagedAssetResolver,type ManagedAssetsConfig,type ManagedAssetRelay} from './managed-assets';

/** Changed code revokes its old realm; unchanged code keeps its subscriptions. */
export function createAuthorScriptSession(store: DataflowStore, doc: Document = document): {
  replace(source: string | null): void;
  dispose(): void;
} {
  let previous: string | null = null;
  let stop = () => {};
  let disposed = false;
  return {
    replace(source) {
      if (disposed || source === previous) return;
      stop();
      previous = source;
      stop = source ? startAuthorScript(source, store, doc) : () => {};
    },
    dispose() { disposed = true; stop(); },
  };
}

/** Own one sandbox + port. Disposing revokes its capability and removes its frame. */
interface AuthorScriptMount {host: HTMLElement; title: string; html: string; document: string; scripts?: ManagedIframeContent['scripts']; assets?: ManagedAssetsConfig; importAsset?:ManagedAssetRelay; resolveArtifactId?:string}
export function startAuthorScript(source: string, store: DataflowStore, doc: Document = document, visible?: AuthorScriptMount): () => void {
  const frame = doc.createElement('iframe');
  frame.title = visible?.title ?? AUTHOR_SCRIPT_FRAME_TITLE;
  frame.hidden = !visible;
  if (!visible) frame.setAttribute('aria-hidden', 'true');
  else { frame.style.width='100%'; frame.style.height='100%'; frame.style.border='0'; frame.style.display='block'; }
  frame.setAttribute('sandbox', 'allow-scripts');
  frame.setAttribute('referrerpolicy', 'no-referrer');
  // Use the module's serving origin even when the containing raw document is
  // opaque. A real HTTP response does not inherit the main app's script CSP.
  const moduleUrl=new URL(import.meta.url);
  const wrapperUrl=new URL(AUTHOR_FRAME_PATH,/^https?:$/.test(moduleUrl.protocol)?moduleUrl:doc.baseURI);
  if(visible?.resolveArtifactId){
    if(!/^[A-Za-z0-9]{6}$/.test(visible.resolveArtifactId))throw new Error('Invalid author resolver scope');
    wrapperUrl.searchParams.set('artifact',visible.resolveArtifactId);
  }
  frame.src=wrapperUrl.href;
  const bridge = createAuthorScriptBridge(store);
  const assets=createManagedAssetResolver(visible?.assets,visible?.importAsset);
  let disposed = false;
  let port: MessagePort | null = null;
  let unsubscribe = () => {};
  let comments: ReturnType<typeof connectManagedComments> | null = null;
  let delivered: DataflowState | null = null;
  let deliveredPending: string[] = [];
  let timer: ReturnType<typeof setTimeout> | null = null;
  let awaitingState = false;
  let lastRequestId = 0;
  const fail=(message:string)=>{
    dispose();
    if(visible){const error=doc.createElement('p');error.setAttribute('role','alert');error.textContent=message;visible.host.append(error);}
  };
  const startup=setTimeout(()=>fail('Interactive content did not start. Reload to retry.'),15000);
  const navigation=(event:MessageEvent)=>{
    if(event.source===frame.contentWindow&&event.data==='mx:author:navigated')fail('Interactive content attempted navigation and was stopped.');
  };
  doc.defaultView?.addEventListener('message',navigation);
  const snapshot = () => {
    timer = null;
    if (disposed || !port || awaitingState) return;
    const next=store.getState(), pending=[...store.pending()];
    const reset=delivered===null;
    const delta=authorStateDelta(delivered,next);
    const pendingChanged=reset || pending.length!==deliveredPending.length || pending.some(name=>!deliveredPending.includes(name));
    delivered=next; deliveredPending=pending;
    if(reset || delta || pendingChanged) {
      awaitingState=true;
      port.postMessage({type:'state',state:delta??{},...(reset?{reset:true}:{}),...(pendingChanged?{pending}:{})} satisfies AuthorScriptSnapshot);
    }
  };
  // One timer, no queue of full snapshots; commands/replies never use this path.
  const schedule = () => { if(!disposed && !awaitingState && timer===null) timer=setTimeout(snapshot,16); };
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    comments?.dispose();
    bridge.dispose();
    assets.dispose();clearTimeout(startup);
    doc.defaultView?.removeEventListener('message',navigation);
    unsubscribe();
    if(timer!==null) clearTimeout(timer);
    timer=null;
    port?.close();
    frame.remove();
  };
  let loaded = false;
  frame.onload = () => {
    // Any subsequent navigation loses its port and may not acquire another.
    if (loaded) { dispose(); return; }
    loaded = true;
    if (disposed || !frame.contentWindow) return;
    const channel = new MessageChannel();
    port = channel.port1;
    port.onmessage = event => {
      if (disposed) return;
      if(event.data?.type==='author-ready'){clearTimeout(startup);frame.setAttribute('data-mx-author-ready','');return;}
      if(event.data?.type==='author-error'){fail(String(event.data.error).slice(0,500));return;}
      if(event.data?.type==='state-ack') {
        if(awaitingState) { awaitingState=false; schedule(); }
        return;
      }
      if(typeof event.data?.type==='string' && event.data.type.startsWith('comment-')) { comments?.receive(event.data); return; }
      const requestId = Number(event.data?.id);
      if (!Number.isSafeInteger(requestId) || requestId < 1 || requestId <= lastRequestId) {
        port?.postMessage({ id: Number.isSafeInteger(requestId) ? requestId : 0, ok: false, error: 'Invalid script request' });
        return;
      }
      lastRequestId = requestId;
      if(event.data?.op==='asset') {
        const request=event.data;
        if(!Number.isSafeInteger(request.id)||request.id<1)return;
        void assets.resolve(request.url,request.kind).then(value=>{if(!disposed)port?.postMessage({id:request.id,ok:true,value});},error=>{if(!disposed)port?.postMessage({id:request.id,ok:false,error:String(error.message).slice(0,500)});});
        return;
      }
      void bridge.request(event.data).then(reply => { if (!disposed) port?.postMessage(reply); });
    };
    port.start();
    // '*' is necessary for an opaque target. The port goes only to this exact WindowProxy.
    frame.contentWindow.postMessage({type:AUTHOR_SCRIPT_INIT,document:visible?.document??AUTHOR_SCRIPT_DOCUMENT}, '*', [channel.port2]);
    snapshot();
    unsubscribe = store.subscribe(schedule);
    port.postMessage({ type: 'run', source, ...(visible ? {html:visible.html,scripts:visible.scripts,assetOrigin:visible.assets?.origin,managed:visible.scripts!==undefined} : {}) });
    if(visible?.scripts!==undefined) {
      const owner=visible.host.closest<HTMLElement>('[data-mx-managed-frame]')??visible.host;
      comments=connectManagedComments(owner,state=>{if(!disposed)port?.postMessage(state);});
    }
  };
  (visible?.host ?? doc.body).append(frame);
  return dispose;
}
