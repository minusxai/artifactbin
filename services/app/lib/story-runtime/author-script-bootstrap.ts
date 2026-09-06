/**
 * A deliberately self-contained classic-script bootstrap. It runs ONLY in
 * the opaque child; no bundler closure or parent globals may be referenced.
 * Author code arrives as data over a transferred port after the frame loads.
 */
export const AUTHOR_SCRIPT_BOOTSTRAP = `
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
    const report = error => console.error('[artifact script]', error.message);
    const subscribe = listeners => listener => {
      if (typeof listener !== 'function') throw new TypeError('Expected a listener');
      listeners.add(listener); return () => listeners.delete(listener);
    };
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
    port.onmessage = event => {
      const message = event.data;
      if (message.type === 'state') {
        const previous = JSON.stringify(state.values);
        state = message.state; pending = message.pending;
        if (previous !== JSON.stringify(state.values)) for (const listener of valuesListeners) {
          try { listener(copy(state.values)); } catch (error) { report(error); }
        }
        for (const listener of dataListeners) {
          try { listener(copy(state), [...pending]); } catch (error) { report(error); }
        }
      } else if (message.type === 'run' && !started) {
        started = true;
        const script = document.createElement('script');
        script.textContent = message.source;
        document.body.append(script);
      } else if (waiting.has(message.id)) {
        const task = waiting.get(message.id); waiting.delete(message.id); clearTimeout(task.timer);
        if (message.ok) task.resolve(); else task.reject(new Error(message.error));
      }
    };
    port.start();
  });
})();`;

/** No network, descendants, forms, objects, workers, or external code in the child. */
export const AUTHOR_SCRIPT_DOCUMENT = '<!doctype html><html><head>'
  + '<meta http-equiv="Content-Security-Policy" content="default-src \'none\'; script-src \'unsafe-inline\'; connect-src \'none\'; frame-src \'none\'; form-action \'none\'; base-uri \'none\'">'
  + '</head><body><script>' + AUTHOR_SCRIPT_BOOTSTRAP + '</script></body></html>';
