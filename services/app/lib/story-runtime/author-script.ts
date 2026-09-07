import type { DataflowStore } from './store';
import { createAuthorScriptBridge } from './author-script-bridge';
import { AUTHOR_SCRIPT_DOCUMENT } from './author-script-bootstrap';
import { AUTHOR_SCRIPT_FRAME_TITLE, AUTHOR_SCRIPT_INIT, type AuthorScriptSnapshot } from './author-script-contract';
import { authorStateDelta } from './author-state';
import type { DataflowState } from '@/lib/story/dataflow';

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
export interface AuthorScriptMount {host: HTMLElement; title: string; html: string; document: string}
export function startAuthorScript(source: string, store: DataflowStore, doc: Document = document, visible?: AuthorScriptMount): () => void {
  const frame = doc.createElement('iframe');
  frame.title = visible?.title ?? AUTHOR_SCRIPT_FRAME_TITLE;
  frame.hidden = !visible;
  if (!visible) frame.setAttribute('aria-hidden', 'true');
  else { frame.style.width='100%'; frame.style.height='100%'; frame.style.border='0'; frame.style.display='block'; }
  frame.setAttribute('sandbox', 'allow-scripts');
  frame.setAttribute('referrerpolicy', 'no-referrer');
  frame.srcdoc = visible?.document ?? AUTHOR_SCRIPT_DOCUMENT;
  const bridge = createAuthorScriptBridge(store);
  let disposed = false;
  let port: MessagePort | null = null;
  let unsubscribe = () => {};
  let delivered: DataflowState | null = null;
  let deliveredPending: string[] = [];
  let timer: ReturnType<typeof setTimeout> | null = null;
  let awaitingState = false;
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
    bridge.dispose();
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
      if(event.data?.type==='state-ack') {
        if(awaitingState) { awaitingState=false; schedule(); }
        return;
      }
      void bridge.request(event.data).then(reply => { if (!disposed) port?.postMessage(reply); });
    };
    port.start();
    // '*' is necessary for an opaque target. The port goes only to this exact WindowProxy.
    frame.contentWindow.postMessage(AUTHOR_SCRIPT_INIT, '*', [channel.port2]);
    snapshot();
    unsubscribe = store.subscribe(schedule);
    port.postMessage({ type: 'run', source, ...(visible ? {html:visible.html} : {}) });
  };
  (visible?.host ?? doc.body).append(frame);
  return dispose;
}
