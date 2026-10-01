/**
 * THE REALM'S OWN GLOBALS, installed as trusted code before any author code runs. It is the only code
 * that touches the one host function (`__mxHost`, taken off the global here), and the only surface
 * author code sees: `mx` (lib/story-runtime/mx), `dom` (./dom-host), `console`, bounded timers, and
 * `window`/`self` as names for the realm's own global, so a stored script written against the former
 * frame keeps working. Everything crosses as JSON text: the host never reads an author object.
 *
 * Plain ES2020, no template literals: it is a string the realm evaluates (./realm).
 */
export const AUTHOR_REALM_PRELUDE = String.raw`(() => {
  const host = globalThis.__mxHost; delete globalThis.__mxHost;
  const stringify = JSON.stringify, parse = JSON.parse;
  const coded = (error) => { if (error && typeof error === 'object' && error.code === undefined && typeof error.name === 'string') { try { Object.defineProperty(error, 'code', { value: error.name, configurable: true, writable: true }); } catch (_) {} } return error; };
  const call = (op, ...args) => { try { return host(op, stringify(args)); } catch (error) { throw coded(error); } };
  const sync = (op, ...args) => { const r = call(op, ...args); return r === undefined ? undefined : parse(r); };
  const async = (op, ...args) => { let r; try { r = call(op, ...args); } catch (error) { return Promise.reject(error); } return Promise.resolve(r).then((text) => text === undefined ? undefined : parse(text), (error) => { throw coded(error); }); };
  const callbacks = new Map(); let next = 0;
  const keep = (fn, what) => { if (typeof fn !== 'function') throw new TypeError('Expected a ' + what + ' callback'); const id = ++next; callbacks.set(id, fn); return id; };
  const dispatch = (id, json, once) => { const fn = callbacks.get(id); if (!fn) return; if (once) callbacks.delete(id); return fn(...parse(json)); };
  const text = (value) => value == null ? '' : String(value);
  const mx = Object.freeze({
    describe: () => async('describe'),
    read: (names, options) => async('read', names, options === undefined ? {} : options),
    set: (values) => async('set', values),
    mutate: (name, args) => async('mutate', name, args === undefined ? {} : args),
    subscribe(names, callback) {
      const id = keep(callback, 'snapshot');
      try { sync('subscribe', names, id); } catch (error) { callbacks.delete(id); throw error; }
      let active = true;
      return () => { if (!active) return; active = false; callbacks.delete(id); sync('unsubscribe', id); };
    },
  });
  const dom = Object.freeze({
    query: (selector) => sync('query', text(selector)),
    queryAll: (selector) => sync('queryAll', text(selector)),
    text: (node) => sync('text', node),
    setText: (node, value) => { sync('setText', node, text(value)); },
    value: (node) => sync('value', node),
    setValue: (node, value) => { sync('setValue', node, typeof value === 'boolean' ? value : text(value)); },
    attr: (node, name) => sync('attr', node, text(name)),
    setAttr: (node, name, value) => { sync('setAttr', node, text(name), text(value)); },
    removeAttr: (node, name) => { sync('removeAttr', node, text(name)); },
    addClass: (node, ...classes) => { sync('addClass', node, classes.map(text)); },
    removeClass: (node, ...classes) => { sync('removeClass', node, classes.map(text)); },
    toggleClass: (node, name, force) => sync('toggleClass', node, text(name), force === undefined ? null : !!force),
    hasClass: (node, name) => sync('hasClass', node, text(name)),
    on(node, type, handler, options) {
      const id = keep(handler, 'event');
      try { sync('on', node, text(type), id, !!(options && options.prevent)); } catch (error) { callbacks.delete(id); throw error; }
      let active = true;
      return () => { if (!active) return; active = false; callbacks.delete(id); sync('off', id); };
    },
    create: (tag, value) => sync('create', text(tag), value == null ? null : text(value)),
    append: (parent, child) => { sync('append', parent, child); },
    remove: (node) => { sync('remove', node); },
    connected: (node) => sync('connected', node),
  });
  const part = (value) => { if (typeof value === 'string') return value; try { const json = stringify(value); return json === undefined ? String(value) : json; } catch (_) { return String(value); } };
  const level = (name) => (...args) => { sync('console', name, args.map(part)); };
  const console = Object.freeze({ log: level('log'), info: level('info'), warn: level('warn'), error: level('error'), debug: level('log') });
  const setTimeout = (fn, ms) => { const id = keep(fn, 'timer'); try { return sync('timeout', id, Number(ms) || 0); } catch (error) { callbacks.delete(id); throw error; } };
  const clearTimeout = (id) => { callbacks.delete(id); sync('clearTimeout', id); };
  const define = (name, value) => Object.defineProperty(globalThis, name, { value, writable: false, configurable: false, enumerable: false });
  define('mx', mx); define('dom', dom); define('console', console); define('setTimeout', setTimeout); define('clearTimeout', clearTimeout);
  Object.defineProperty(globalThis, 'window', { get: () => globalThis, configurable: false, enumerable: false });
  Object.defineProperty(globalThis, 'self', { get: () => globalThis, configurable: false, enumerable: false });
  return dispatch;
})()`;
