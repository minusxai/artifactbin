/**
 * THE AUTHOR REALM: the version's `<Helmet><script>` run in a QuickJS interpreter ON THIS THREAD,
 * never in this document's JavaScript realm. Author code sees only what ./prelude installs — `mx` over
 * the document's store (lib/story-runtime/mx), `dom` over the story root (./dom-host), `console`,
 * timers — through ONE host function whose arguments and replies are JSON text. The host never dumps
 * an author value and never hands author code a host object; a handle is an integer.
 *
 * What bounds it (./limits, measured in the planning spike): every entry into the interpreter runs
 * under an interrupt deadline and a nesting count, its memory is the bounded `WebAssembly.Memory` the
 * module was given (./module), and an interrupt or an exhausted memory ENDS the realm — it is not an
 * exception author code can catch. Teardown happens only at the top level (disposing inside a host call
 * aborts the interpreter), and releases every handle it kept first, because one leaked handle aborts
 * the runtime's dispose.
 *
 * Framework-free. Bundled into the compiled page's lazy `author-realm` chunk (lib/islands/author-realm).
 */
import { shouldInterruptAfterDeadline, type QuickJSContext, type QuickJSDeferredPromise, type QuickJSHandle, type QuickJSRuntime, type QuickJSWASMModule } from 'quickjs-emscripten-core';
import { createMx } from '../mx';
import type { DataflowStore } from '../store';
import { createDomHost } from './dom-host';
import { AUTHOR_REALM_LIMITS as L } from './limits';
import { AUTHOR_REALM_PRELUDE } from './prelude';

export interface AuthorRealmOptions {
  module: QuickJSWASMModule;
  source: string;
  store: DataflowStore;
  /** The story root: selectors run under it, and nothing outside it is reachable. */
  root: HTMLElement;
  doc: Document;
  /** A script error, a refused call, or the reason the realm ended; ≤ 500 characters. */
  onError(message: string): void;
  /** Where `console.*` goes; the page's console by default. */
  console?: Pick<Console, 'log' | 'info' | 'warn' | 'error'>;
}
export interface AuthorRealm {
  /** True once the realm has ended, for any reason. */
  readonly disposed: boolean;
  /** End the realm: handlers removed, created elements gone, subscriptions stopped, memory released. Idempotent; safe at any time. */
  dispose(): void;
  /** Resolves when the script body and every promise it started have settled (tests and the host's own bookkeeping). */
  settled(): Promise<void>;
}

type Phase = 'live' | 'closing' | 'disposed';
const codeOf = (error: unknown): string => (error && typeof error === 'object' && typeof (error as { code?: unknown }).code === 'string' ? (error as { code: string }).code : 'OPERATION_FAILED');
const messageOf = (error: unknown): string => String((error as { message?: unknown })?.message ?? error ?? 'failed').slice(0, 500);
/** JSON from the realm, with the keys a naive merge would turn into prototype pollution dropped on the way in. */
const parseArguments = (text: string): unknown[] => {
  if (text.length > L.argumentChars) throw Object.assign(new Error('Host call arguments too large'), { code: 'INVALID_REQUEST' });
  const parsed: unknown = JSON.parse(text, (key, value: unknown) => (key === '__proto__' || key === 'constructor' || key === 'prototype' ? undefined : value));
  return Array.isArray(parsed) ? parsed : [];
};

export function createAuthorRealm(options: AuthorRealmOptions): AuthorRealm {
  const { module, source, store, root, doc, onError } = options;
  const out = options.console ?? console;
  const runtime: QuickJSRuntime = module.newRuntime();
  runtime.setMaxStackSize(L.stackBytes);
  runtime.setMemoryLimit(L.softMemoryBytes);
  const vm: QuickJSContext = runtime.newContext();
  const mx = createMx(store);

  let phase: Phase = 'live';
  let depth = 0;
  let dispatch: QuickJSHandle | null = null;
  const deferreds = new Set<QuickJSDeferredPromise>();
  const subscriptions = new Map<number, () => void>();
  const timers = new Map<number, ReturnType<typeof setTimeout>>();
  const watched = new Set<Promise<void>>();
  let fail: (message: string) => void = () => {};

  /** A VM error as text, through TYPED reads only (never `dump`): the realm's `name` and `message` strings. */
  const describe = (error: QuickJSHandle): string => {
    const field = (key: string) => { const h = vm.getProp(error, key); const text = vm.typeof(h) === 'string' ? vm.getString(h) : ''; h.dispose(); return text; };
    try { return `${field('name') || 'Error'}: ${field('message')}`.slice(0, 500); } catch { return 'Error'; }
  };
  /** Report a failed VM result; an interrupt or exhausted memory ends the realm, anything else is the script's own error. */
  const report = (error: QuickJSHandle, what: string): void => {
    const text = describe(error);
    if (error.alive) error.dispose();
    if (/^InternalError: interrupted/.test(text)) fail(`Interactive script exceeded its time budget (${what})`);
    else if (/out of memory|stack overflow/i.test(text)) fail(`Interactive script exceeded its ${/memory/i.test(text) ? 'memory' : 'stack'} budget (${what})`);
    else onError(`${what}: ${text}`.slice(0, 500));
  };

  /** EVERY entry into the interpreter: one deadline per outermost entry, a nesting count, and a host failure ends the realm. */
  const enter = <T>(budgetMs: number, run: () => T): T | undefined => {
    if (phase !== 'live') return undefined;
    if (depth >= L.nestingDepth) { fail('Interactive script nested host calls too deeply'); return undefined; }
    depth++;
    if (depth === 1) runtime.setInterruptHandler(shouldInterruptAfterDeadline(Date.now() + budgetMs));
    try { return run(); }
    catch (error) { fail(`Interactive script runtime failed: ${messageOf(error)}`); return undefined; }
    finally { depth--; if (depth === 0 && phase === 'live') runtime.removeInterruptHandler(); }
  };
  /** Run the realm's pending promise jobs; always at the top level, never from inside a call. */
  const pump = (): void => {
    if (depth > 0) { queueMicrotask(pump); return; }
    enter(L.entryBudgetMs, () => {
      const result = runtime.executePendingJobs(L.jobsPerPump);
      if (result.error) report(result.error, 'async step'); else result.dispose();
    });
  };
  /** A value the realm returned: a promise is watched so its rejection is reported; anything else is let go. */
  const watch = (handle: QuickJSHandle, what: string): void => {
    const state = vm.getPromiseState(handle);
    if (state.type === 'fulfilled' && state.notAPromise) { if (state.value !== handle && state.value.alive) state.value.dispose(); handle.dispose(); return; }
    if (state.type === 'fulfilled' && state.value.alive) state.value.dispose();
    if (state.type === 'rejected' && state.error.alive) state.error.dispose();
    const done = vm.resolvePromise(handle).then((result) => {
      watched.delete(done);
      if (phase !== 'live') { const h = result.error ?? result.value; if (h?.alive) h.dispose(); return; }
      if (result.error) report(result.error, what); else result.value.dispose();
    }, () => { watched.delete(done); });
    watched.add(done);
    handle.dispose();
    pump();
  };
  /** Deliver to a realm callback by id (an event, a snapshot, a timer): queued when a call is already on the stack. */
  const fire = (id: number, args: unknown[], once = false): void => {
    if (phase !== 'live' || !dispatch) return;
    if (depth > 0) { queueMicrotask(() => fire(id, args, once)); return; }
    enter(L.entryBudgetMs, () => {
      const idHandle = vm.newNumber(id);
      const json = vm.newString(JSON.stringify(args));
      const result = vm.callFunction(dispatch!, vm.undefined, idHandle, json, once ? vm.true : vm.false);
      idHandle.dispose(); json.dispose();
      if (result.error) report(result.error, 'event handler'); else watch(result.value, 'event handler');
    });
    pump();
  };
  /** A host promise as a realm promise: resolved with JSON text, rejected with a coded Error, then the jobs run. */
  const deferred = (promise: Promise<unknown>): QuickJSHandle => {
    if (deferreds.size >= L.pendingHostCalls) throw Object.assign(new Error('Too many pending script requests'), { code: 'RATE_LIMIT' });
    const d = vm.newPromise();
    deferreds.add(d);
    void promise.then(
      (value) => { if (phase !== 'live' || !d.alive) return; const h = vm.newString(JSON.stringify(value ?? null)); d.resolve(h); h.dispose(); },
      (error: unknown) => { if (phase !== 'live' || !d.alive) return; const h = vm.newError({ name: codeOf(error), message: messageOf(error) }); d.reject(h); h.dispose(); },
    ).then(() => { deferreds.delete(d); if (d.alive) d.dispose(); if (phase === 'live') pump(); });
    return d.handle;
  };

  const dom = createDomHost({ root, doc, fire: (id, args) => fire(id, args) });
  /** One host call. Returns JSON text, undefined, or a realm promise handle; throws a coded Error to refuse. */
  const handle = (op: string, args: unknown[]): string | QuickJSHandle | undefined => {
    switch (op) {
      case 'describe': return deferred(mx.describe());
      case 'read': return deferred(mx.read(args[0] as string[], args[1] as Parameters<typeof mx.read>[1]));
      case 'set': return deferred(mx.set(args[0] as Record<string, never>));
      case 'mutate': return deferred(mx.mutate(args[0] as string, args[1] as Parameters<typeof mx.mutate>[1]));
      case 'subscribe': {
        const id = args[1];
        if (typeof id !== 'number' || subscriptions.has(id)) throw Object.assign(new Error('Invalid subscription'), { code: 'INVALID_REQUEST' });
        if (subscriptions.size >= L.subscriptions) throw Object.assign(new Error('Subscription limit exceeded'), { code: 'SUBSCRIPTION_LIMIT' });
        // mx delivers on its own timer, never inside the store's notification; `fire` still queues under a call.
        subscriptions.set(id, mx.subscribe(args[0] as string[], (snapshot) => fire(id, [snapshot])));
        return JSON.stringify(id);
      }
      case 'unsubscribe': { const id = args[0]; if (typeof id === 'number') { subscriptions.get(id)?.(); subscriptions.delete(id); } return undefined; }
      case 'console': {
        const level = args[0] === 'warn' || args[0] === 'error' || args[0] === 'info' ? args[0] : 'log';
        const parts = Array.isArray(args[1]) ? args[1].slice(0, 16).map((part) => String(part).slice(0, 2000)) : [];
        out[level]('[artifact script]', ...parts);
        return undefined;
      }
      case 'timeout': {
        const id = args[0];
        if (typeof id !== 'number' || timers.has(id)) throw Object.assign(new Error('Invalid timer'), { code: 'INVALID_REQUEST' });
        if (timers.size >= L.timers) throw Object.assign(new Error(`A script may hold up to ${L.timers} timers`), { code: 'LIMIT' });
        const ms = Math.min(Math.max(0, Number(args[1]) || 0), L.timerMaxMs);
        timers.set(id, setTimeout(() => { timers.delete(id); fire(id, [], true); }, ms));
        return JSON.stringify(id);
      }
      case 'clearTimeout': { const id = args[0]; if (typeof id === 'number') { const t = timers.get(id); if (t !== undefined) clearTimeout(t); timers.delete(id); } return undefined; }
      default: return dom.call(op, args);
    }
  };
  const hostFunction = vm.newFunction('__mxHost', (opHandle, argsHandle) => {
    if (phase !== 'live') return { error: vm.newError({ name: 'STALE_INSTANCE', message: 'Script session closed' }) };
    if (!opHandle || !argsHandle || vm.typeof(opHandle) !== 'string' || vm.typeof(argsHandle) !== 'string') return { error: vm.newError({ name: 'INVALID_REQUEST', message: 'Invalid host call' }) };
    try {
      const reply = handle(vm.getString(opHandle), parseArguments(vm.getString(argsHandle)));
      return reply === undefined ? vm.undefined : typeof reply === 'string' ? vm.newString(reply) : reply;
    } catch (error) {
      return { error: vm.newError({ name: codeOf(error), message: messageOf(error) }) };
    }
  });

  const dispose = (): void => {
    if (phase === 'disposed') return;
    if (depth > 0) { phase = 'closing'; queueMicrotask(dispose); return; }
    phase = 'disposed';
    for (const stop of subscriptions.values()) stop();
    subscriptions.clear();
    for (const t of timers.values()) clearTimeout(t);
    timers.clear();
    dom.dispose();
    try {
      for (const d of deferreds) if (d.alive) d.dispose();
      deferreds.clear();
      if (dispatch?.alive) dispatch.dispose();
      dispatch = null;
      runtime.removeInterruptHandler();
      vm.dispose();
      runtime.dispose();
    } catch (error) { out.error('[artifact script] the realm did not release cleanly', error); }
  };
  fail = (message) => { if (phase === 'live') { onError(message); phase = 'closing'; queueMicrotask(dispose); } };

  const realm: AuthorRealm = {
    get disposed() { return phase !== 'live'; },
    dispose,
    settled: async () => { while (watched.size) await Promise.all([...watched]); },
  };

  // The prelude: trusted, strict, hands back the dispatcher and leaves no host hook on the global.
  vm.setProp(vm.global, '__mxHost', hostFunction);
  hostFunction.dispose();
  const prelude = enter(L.startBudgetMs, () => vm.evalCode(AUTHOR_REALM_PRELUDE, 'mx-prelude.js', { type: 'global', strict: true }));
  if (!prelude) { dispose(); return realm; }
  if (prelude.error) { report(prelude.error, 'runtime'); dispose(); return realm; }
  dispatch = prelude.value;
  // The author's code as an async function body: top-level await works, and every rejection is seen.
  const started = enter(L.startBudgetMs, () => vm.evalCode(`(async () => {\n${source}\n})()`, 'artifact-script.js', { type: 'global' }));
  if (started) { if (started.error) report(started.error, 'script'); else watch(started.value, 'script'); }
  return realm;
}
