import { COMMENT_PRESENTATION } from './comment-presentation';
import {createManagedCommentRuntime} from './managed-comment-runtime';
import {MANAGED_FETCH_BOOTSTRAP} from './managed-fetch-bootstrap';
import {AUTHOR_REALM_LOCKDOWN} from './author-realm-lockdown';
import {MUTATION_REPLY_TIMEOUT_MS} from '@artifactbin/contracts';
/**
 * A deliberately self-contained classic-script bootstrap. It runs ONLY in
 * the opaque child; no bundler closure or parent globals may be referenced.
 * Author code arrives as data over a transferred port after the frame loads.
 */
export const AUTHOR_SCRIPT_BOOTSTRAP = `
${AUTHOR_REALM_LOCKDOWN}
(() => {
  // esbuild keepNames may annotate inner functions; supply its name helper in this realm.
  const __name = (fn, name) => Object.defineProperty(fn, 'name', {value:name, configurable:true});
  const createComments = ${createManagedCommentRuntime.toString()};
  let initialized = false;
  addEventListener('message', event => {
    if (initialized || event.source !== parent || event.data !== 'mx:author:init' || event.ports.length !== 1) return;
    initialized = true;
    const port = event.ports[0];
    const send = port.postMessage.bind(port);
    let comments = null, commentState = null;
    let sequence = 0, started = false;
    const waiting = new Map(), subscriptions = new Map();
    const copy = value => structuredClone(value);
    const request = payload => new Promise((resolve, reject) => {
      if (waiting.size >= 128) { reject(new Error('Too many pending script requests')); return; }
      const id = ++sequence;
      const timer = setTimeout(() => { waiting.delete(id); reject(new Error('Script request timed out')); }, payload.op === 'mutate' ? ${MUTATION_REPLY_TIMEOUT_MS} : 15000);
      waiting.set(id, { resolve, reject, timer });
      send({ id, ...payload });
    });
    ${MANAGED_FETCH_BOOTSTRAP}
    addEventListener('error', event => send({type:'author-error',error:event.message || 'Iframe script failed'}));
    addEventListener('unhandledrejection', event => send({type:'author-error',error:String(event.reason?.message || event.reason || 'Iframe script failed')}));
    addEventListener('pagehide', () => {
      comments?.dispose();
      assetAbort?.abort(); subscriptions.clear();
      for (const task of waiting.values()) { clearTimeout(task.timer); task.reject(new Error('Iframe disposed')); }
      waiting.clear(); port.close();
    });
    const report = error => console.error('[artifact script]', error.message);
    const mx = Object.freeze({
      describe: () => request({ op: 'describe' }),
      read: (names, options) => request({ op: 'read', names, options }),
      set: values => request({ op: 'set', values }),
      mutate: (name, args) => request({ op: 'mutate', name, args }),
      subscribe: (names, callback) => {
        if (!Array.isArray(names) || names.length > 256 || names.some(name => typeof name !== 'string')) throw new TypeError('Expected declared signal names');
        if (typeof callback !== 'function') throw new TypeError('Expected a snapshot callback');
        if (subscriptions.size >= 128) throw new Error('Too many script subscriptions');
        const id = sequence + 1;
        let active = true;
        subscriptions.set(id, callback);
        void request({ op: 'subscribe', names }).catch(error => { subscriptions.delete(id); report(error); });
        return () => {
          if (!active) return;
          active = false; subscriptions.delete(id);
          void request({ op: 'unsubscribe', subscription: id }).catch(report);
        };
      }
    });
    Object.defineProperty(window, 'mx', { value: mx, writable: false, configurable: false });
    port.onmessage = async event => {
      const message = event.data;
      if (message.type === 'comment-state') {
        commentState = message; comments?.update(message);
      } else if (message.type === 'signals') {
        for (const {subscription, snapshot} of message.updates) {
          const callback = subscriptions.get(subscription);
          if (callback) { try { callback(copy(snapshot)); } catch (error) { report(error); } }
        }
        send({ type: 'signals-ack' });
      } else if (message.type === 'run' && !started) {
        started = true;
        try {
          assetOrigin = message.assetOrigin || null;
          // Hidden Helmet scripts retain native APIs under their deny-network
          // CSP. Visible managed Iframes use the cached-asset transport.
          if (!message.managed && nativeFetch) window.fetch = nativeFetch;
          if (!message.managed && nativeXHR) window.XMLHttpRequest = nativeXHR;
          if (message.managed) installAssetSources();
          // Only the isolated realm receives prepared author HTML. Scripts are
          // separate data, inserted with textContent, never HTML interpolation.
          if (typeof message.html === 'string') document.body.insertAdjacentHTML('afterbegin', message.html);
          if (message.managed) { comments = createComments(window, send, ${JSON.stringify(COMMENT_PRESENTATION)}); if(commentState) comments.update(commentState); }
          const scripts = message.scripts || [{type:'classic',source:message.source}];
          for (const item of scripts) {
            const script = document.createElement('script');
            if (item.type === 'module') script.type = 'module';
            if (item.src) script.src = item.src;
            else if(item.type==='module'){
              const done='__mx_module_done_'+Math.random().toString(36).slice(2);
              await new Promise((resolve,reject)=>{
                Object.defineProperty(globalThis,done,{value:resolve,configurable:true});
                script.textContent=item.source+'\\n;globalThis['+JSON.stringify(done)+']();';
                script.onerror=()=>reject(new Error('Iframe script failed to load'));document.body.append(script);
              }).finally(()=>{delete globalThis[done];});
              continue;
            } else script.textContent = item.source;
            if (item.src) await new Promise((resolve,reject) => {
              script.onload=resolve;script.onerror=()=>reject(new Error('Iframe script failed to load'));document.body.append(script);
            });
            else document.body.append(script);
          }
          send({type:'author-ready'});
        } catch (error) { send({type:'author-error',error:String(error.message || error)}); }
      } else if (waiting.has(message.id)) {
        const task = waiting.get(message.id); waiting.delete(message.id); clearTimeout(task.timer);
        if (message.ok) task.resolve(message.value); else task.reject(Object.assign(new Error(message.error?.message || message.error), {code: message.error?.code || 'OPERATION_FAILED', ...(message.snapshot ? {snapshot: message.snapshot} : {})}));
      }
    };
    port.start();
  });
})();`;

/** No network, descendants, forms, objects, workers, or external code in the child. */
export const AUTHOR_SCRIPT_DOCUMENT = '<!doctype html><html><head>'
  + '<meta http-equiv="Content-Security-Policy" content="default-src \'none\'; script-src \'unsafe-inline\'; connect-src \'none\'; frame-src \'none\'; form-action \'none\'; base-uri \'none\'">'
  + '</head><body><script>' + AUTHOR_SCRIPT_BOOTSTRAP + '</script></body></html>';
