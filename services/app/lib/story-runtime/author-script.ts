import type { DataflowStore } from './store';
import { createAuthorScriptBridge } from './author-script-bridge';
import { AUTHOR_SCRIPT_DOCUMENT } from './author-script-bootstrap';
import { AUTHOR_SCRIPT_FRAME_TITLE, AUTHOR_SCRIPT_INIT, type AuthorScriptSnapshot } from './author-script-contract';

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
export function startAuthorScript(source: string, store: DataflowStore, doc: Document = document): () => void {
  const frame = doc.createElement('iframe');
  frame.title = AUTHOR_SCRIPT_FRAME_TITLE;
  frame.hidden = true;
  frame.setAttribute('aria-hidden', 'true');
  frame.setAttribute('sandbox', 'allow-scripts');
  frame.setAttribute('referrerpolicy', 'no-referrer');
  frame.srcdoc = AUTHOR_SCRIPT_DOCUMENT;
  const bridge = createAuthorScriptBridge(store);
  let disposed = false;
  let port: MessagePort | null = null;
  let unsubscribe = () => {};
  const snapshot = () => {
    if (disposed || !port) return;
    port.postMessage({ type: 'state', state: store.getState(), pending: [...store.pending()] } satisfies AuthorScriptSnapshot);
  };
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    bridge.dispose();
    unsubscribe();
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
      void bridge.request(event.data).then(reply => { if (!disposed) port?.postMessage(reply); });
    };
    port.start();
    // '*' is necessary for an opaque target. The port goes only to this exact WindowProxy.
    frame.contentWindow.postMessage(AUTHOR_SCRIPT_INIT, '*', [channel.port2]);
    snapshot();
    unsubscribe = store.subscribe(snapshot);
    port.postMessage({ type: 'run', source });
  };
  doc.body.append(frame);
  return dispose;
}
