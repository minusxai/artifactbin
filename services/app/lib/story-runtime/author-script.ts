import { mxFlowKey } from './mx';
import {connectManagedComments} from './managed-comment-host';
import type { DataflowStore } from './store';
import { createAuthorScriptBridge } from './author-script-bridge';
import { AUTHOR_SCRIPT_INIT } from './author-script-contract';
import { AUTHOR_FRAME_PATH } from './author-frame';
import type {ManagedIframeContent} from '@/lib/story/reader/managed-iframe';
import {createManagedAssetResolver,type ManagedAssetsConfig,type ManagedAssetRelay} from './managed-assets';

/**
 * THE MANAGED `<Iframe>`'S REALM: one visible sandboxed frame on the fixed `/author-frame` wrapper, its
 * prepared content and scripts sent as data over a transferred port after load, bound to the document's
 * store through the author-script bridge. (The version's own `<Helmet><script>` no longer runs in a frame:
 * it runs in the page's QuickJS realm, lib/story-runtime/author-realm.)
 */
export interface AuthorScriptMount {host: HTMLElement; title: string; html: string; document: string; scripts: ManagedIframeContent['scripts']; assets?: ManagedAssetsConfig; importAsset?:ManagedAssetRelay; resolveArtifactId?:string}

/** Mount the frame; a changed set of declarations remounts it, so its `mx` instance is never stale. Disposing revokes its capability and removes its frame. */
export function startAuthorScript(store: DataflowStore, mount: AuthorScriptMount, doc: Document = document): () => void {
  let key = mxFlowKey(store.flow);
  let stop = mountAuthorScript(store, mount, doc);
  const unsubscribe = store.subscribe(() => {
    const next = mxFlowKey(store.flow);
    if (next === key) return;
    key = next; stop();
    stop = mountAuthorScript(store, mount, doc);
  });
  return () => { unsubscribe(); stop(); };
}

function mountAuthorScript(store: DataflowStore, mount: AuthorScriptMount, doc: Document): () => void {
  const frame = doc.createElement('iframe');
  frame.title = mount.title;
  frame.style.width='100%'; frame.style.height='100%'; frame.style.border='0'; frame.style.display='block';
  frame.setAttribute('sandbox', 'allow-scripts');
  frame.setAttribute('referrerpolicy', 'no-referrer');
  // Use the module's serving origin even when the containing raw document is
  // opaque. A real HTTP response does not inherit the main app's script CSP.
  const moduleUrl=new URL(import.meta.url);
  const wrapperUrl=new URL(AUTHOR_FRAME_PATH,/^https?:$/.test(moduleUrl.protocol)?moduleUrl:doc.baseURI);
  if(mount.resolveArtifactId){
    if(!/^[A-Za-z0-9]{6}$/.test(mount.resolveArtifactId))throw new Error('Invalid author resolver scope');
    wrapperUrl.searchParams.set('artifact',mount.resolveArtifactId);
  }
  frame.src=wrapperUrl.href;
  const bridge = createAuthorScriptBridge(store, packet => { if (!disposed) port?.postMessage(packet); });
  const assets=createManagedAssetResolver(mount.assets,mount.importAsset);
  let disposed = false;
  let port: MessagePort | null = null;
  let comments: ReturnType<typeof connectManagedComments> | null = null;
  let lastRequestId = 0;
  const fail=(message:string)=>{
    dispose();
    const error=doc.createElement('p');error.setAttribute('role','alert');error.textContent=message;mount.host.append(error);
  };
  const startup=setTimeout(()=>fail('Interactive content did not start. Reload to retry.'),15000);
  const navigation=(event:MessageEvent)=>{
    if(event.source===frame.contentWindow&&event.data==='mx:author:navigated')fail('Interactive content attempted navigation and was stopped.');
  };
  doc.defaultView?.addEventListener('message',navigation);
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    comments?.dispose();
    bridge.dispose();
    assets.dispose();clearTimeout(startup);
    doc.defaultView?.removeEventListener('message',navigation);
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
      if(event.data?.type==='signals-ack') { bridge.acknowledge(); return; }
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
    frame.contentWindow.postMessage({type:AUTHOR_SCRIPT_INIT,document:mount.document}, '*', [channel.port2]);
    port.postMessage({ type: 'run', html:mount.html, scripts:mount.scripts, assetOrigin:mount.assets?.origin, managed:true });
    const owner=mount.host.closest<HTMLElement>('[data-mx-managed-frame]')??mount.host;
    comments=connectManagedComments(owner,state=>{if(!disposed)port?.postMessage(state);});
  };
  mount.host.append(frame);
  return dispose;
}
