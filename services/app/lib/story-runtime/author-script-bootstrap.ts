import {MANAGED_FETCH_BOOTSTRAP} from './managed-fetch-bootstrap';
import {AUTHOR_REALM_LOCKDOWN} from './author-realm-lockdown';
/**
 * A deliberately self-contained classic-script bootstrap. It runs ONLY in
 * the opaque child; no bundler closure or parent globals may be referenced.
 * Author code arrives as data over a transferred port after the frame loads.
 */
export const AUTHOR_SCRIPT_BOOTSTRAP = `
${AUTHOR_REALM_LOCKDOWN}
(() => {
  let initialized = false;
  addEventListener('message', event => {
    if (initialized || event.source !== parent || event.data !== 'mx:author:init' || event.ports.length !== 1) return;
    initialized = true;
    const port = event.ports[0];
    const send = port.postMessage.bind(port);
    let state = { values: {}, tables: {}, errors: {} }, pending = [], sequence = 0, started = false;
    const waiting = new Map(), valuesListeners = new Set(), dataListeners = new Set();
    const own = (object, key) => Object.prototype.hasOwnProperty.call(object, key) ? object[key] : undefined;
    const copy = value => structuredClone(value);
    const request = payload => new Promise((resolve, reject) => {
      if (waiting.size >= 128) { reject(new Error('Too many pending script requests')); return; }
      const id = ++sequence;
      const timer = setTimeout(() => { waiting.delete(id); reject(new Error('Script request timed out')); }, 15000);
      waiting.set(id, { resolve, reject, timer });
      send({ id, ...payload });
    });
    ${MANAGED_FETCH_BOOTSTRAP}
    addEventListener('error', event => send({type:'author-error',error:event.message || 'Iframe script failed'}));
    addEventListener('unhandledrejection', event => send({type:'author-error',error:String(event.reason?.message || event.reason || 'Iframe script failed')}));
    addEventListener('pagehide', () => {
      assetAbort?.abort(); valuesListeners.clear(); dataListeners.clear();
      for (const task of waiting.values()) { clearTimeout(task.timer); task.reject(new Error('Iframe disposed')); }
      waiting.clear(); port.close();
    });
    const report = error => console.error('[artifact script]', error.message);
    const subscribe = listeners => (names, listener) => {
      if (typeof names === 'function' && listener === undefined) { listener = names; names = null; }
      if (typeof listener !== 'function') throw new TypeError('Expected a listener');
      if (names !== null && (!Array.isArray(names) || names.length > 128 || names.some(name => typeof name !== 'string' || !name.length || name.length > 128 || ['__proto__','prototype','constructor'].includes(name)))) throw new TypeError('Expected at most 128 valid names');
      if (listeners.size >= 128) throw new Error('Too many script subscriptions');
      const entry = { names: names === null ? null : [...new Set(names)], listener };
      listeners.add(entry); return () => listeners.delete(entry);
    };
    const select = (object, names) => names === null ? object : Object.fromEntries(names.filter(name => Object.prototype.hasOwnProperty.call(object, name)).map(name => [name, object[name]]));
    const relevant = (names, changed) => names === null ? changed.length > 0 : names.some(name => changed.includes(name));
    const mx = {
      params: {
        get: name => own(state.values, name) ?? null,
        set: (name, value) => { void request({ op: 'set', name, value }).catch(report); },
        subscribe: subscribe(valuesListeners)
      },
      data: {
        get: name => copy(own(state.tables, name)),
        pending: () => [...pending],
        subscribe: subscribe(dataListeners)
      },
      refresh: names => { void request({ op: 'refresh', ...(names === undefined ? {} : { names }) }).catch(report); },
      mutate: (name, values) => request({ op: 'mutate', name, ...(values === undefined ? {} : { values }) })
    };
    Object.defineProperty(window, 'mx', { value: mx, writable: false, configurable: false });
    port.onmessage = async event => {
      const message = event.data;
      if (message.type === 'state') {
        if (message.reset) state = { values: {}, tables: {}, errors: {} };
        const changed = { values: [], tables: [], errors: [] };
        for (const field of ['values', 'tables', 'errors']) {
          for (const [name, value] of Object.entries(message.state[field] || {})) {
            if (value === undefined) {
              if (Object.prototype.hasOwnProperty.call(state[field], name)) { delete state[field][name]; changed[field].push(name); }
            } else if (!Object.is(own(state[field], name), value)) {
              Object.defineProperty(state[field], name, { value, enumerable: true, configurable: true, writable: true });
              changed[field].push(name);
            }
          }
        }
        const nextPending = message.pending === undefined ? pending : message.pending;
        const pendingChanges = [...pending.filter(name => !nextPending.includes(name)), ...nextPending.filter(name => !pending.includes(name))];
        pending = nextPending;
        for (const {names, listener} of valuesListeners) {
          if (!relevant(names, changed.values)) continue;
          try { listener(copy(select(state.values, names))); } catch (error) { report(error); }
        }
        for (const {names, listener} of dataListeners) {
          const dataChanges = [...changed.tables, ...changed.errors, ...pendingChanges];
          if (!relevant(names, names === null ? [...dataChanges, ...changed.values] : dataChanges)) continue;
          const selected = names === null ? state : { values: {}, tables: select(state.tables, names), errors: select(state.errors, names) };
          try { listener(copy(selected), names === null ? [...pending] : pending.filter(name => names.includes(name))); } catch (error) { report(error); }
        }
        // Backpressure: the host keeps at most one unacknowledged state packet.
        // A slow child cannot accumulate snapshots; mutation commands stay FIFO.
        send({ type: 'state-ack' });
      } else if (message.type === 'run' && !started) {
        started = true;
        try {
          assetOrigin = message.assetOrigin || null;
          // Compatibility Sandbox retains its pinned-library/ref API policy.
          // Managed Iframe uses the generic cached-asset transport instead.
          if (!message.managed && nativeFetch) window.fetch = nativeFetch;
          if (!message.managed && nativeXHR) window.XMLHttpRequest = nativeXHR;
          if (message.managed) installAssetSources();
          // Only the isolated realm receives prepared author HTML. Scripts are
          // separate data, inserted with textContent, never HTML interpolation.
          if (typeof message.html === 'string') document.body.insertAdjacentHTML('afterbegin', message.html);
          const scripts = message.scripts || [{type:'classic',source:message.source}];
          for (const item of scripts) {
            const script = document.createElement('script');
            if (item.type === 'module') script.type = 'module';
            if (item.src) script.src = item.src; else script.textContent = item.source;
            if (item.src || item.type === 'module') await new Promise((resolve,reject) => {
              script.onload=resolve;script.onerror=()=>reject(new Error('Iframe script failed to load'));document.body.append(script);
            });
            else document.body.append(script);
          }
          send({type:'author-ready'});
        } catch (error) { send({type:'author-error',error:String(error.message || error)}); }
      } else if (waiting.has(message.id)) {
        const task = waiting.get(message.id); waiting.delete(message.id); clearTimeout(task.timer);
        if (message.ok) task.resolve(message.value); else task.reject(new Error(message.error));
      }
    };
    port.start();
  });
})();`;

/** No network, descendants, forms, objects, workers, or external code in the child. */
export const AUTHOR_SCRIPT_DOCUMENT = '<!doctype html><html><head>'
  + '<meta http-equiv="Content-Security-Policy" content="default-src \'none\'; script-src \'unsafe-inline\'; connect-src \'none\'; frame-src \'none\'; form-action \'none\'; base-uri \'none\'">'
  + '</head><body><script>' + AUTHOR_SCRIPT_BOOTSTRAP + '</script></body></html>';
