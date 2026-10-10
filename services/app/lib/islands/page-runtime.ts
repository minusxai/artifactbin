/**
 * THE AUTHOR SCRIPT'S RUNTIME (`@mx/page-runtime`), loaded by boot when a page carries a script or declares data.
 *
 *  - `bindPage(store)`: the document's declared names as Solid signals over the page's one store, created in one
 *    `createRoot` per store. The author binds them by the name the markup spells (`import { signal, query, mutation }
 *    from 'page'`): `signal('$region')` is a Value's `[accessor, setter]` whose setter writes the store;
 *    `query('$monthly')` is an accessor of rows with `loading` and `error` accessors and a `ready` promise beside it;
 *    `mutation('$rename')` is an async function that waits for the page's access check, resolves after commit and
 *    rejects with the server's message. One store subscription pushes every change into the signals in one `batch`.
 *  - `proxy(url)` (`import { proxy } from 'page'`): the document's own `/a/<id>/fetch?url=` door for an https URL, which
 *    the server fetches for the script when the document declares the host (`<meta name="csp-connect">`) and the reader
 *    allowed it — a document's policy connects only to its own origin and the module CDNs (lib/page-styles/document-csp).
 *  - `exposePage(win, store)`: the same bindings as `window.page` (`get`, `set`, `ready`, `mutation`) for browser sessions.
 *  - `startAuthorModule(...)`: loads the version's module (built at publish, lib/author-script/author-module.server)
 *    with its `solid-js` imports pointed at this build's chunks, hands it the bindings through the `page` module's
 *    global, and mounts every component it exports where the markup placed one (`data-mx-mount`) with Solid's `render`.
 *
 * Solid is the island build's one instance (lib/islands/vendor, lib/author-script/contract AUTHOR_VENDOR_EXPORTS): the script, this
 * runtime and the kit share one reactive graph.
 */
import { batch, createSignal as solidCreateSignal, untrack, type JSX, type SignalOptions } from 'solid-js';
import { createComponent, render } from 'solid-js/web';
import type { DataflowStore } from '@/lib/story-runtime/data';
import type { DatasetUploadResult } from '@artifactbin/contracts';
import type { Row, Scalar } from '@/lib/dataflow';
import { PAGE_GLOBAL } from '@/lib/author-script/contract';
import { bindPage, type PageBindings, type MutationFn } from '@/lib/story-runtime/page-bindings';
import { MountScope, commentSignal, commentStateKey } from './comment-state';
import { registerCommentState } from '@/lib/story-runtime/comment-state';
import { setCommentStateTransaction } from '@/lib/story-runtime/comment-state-io';
import { COMMENT_VALUES_KEY } from '../../../contracts/src/comment-view-state';
export { bindPage, type PageBindings, type MutationFn, type QueryAccessor, type ValueSetter } from '@/lib/story-runtime/page-bindings';
const bareName = (ref: string): string => (typeof ref === 'string' && ref.startsWith('$') ? ref.slice(1) : String(ref));


/**
 * What `window.page` holds, for a browser session to drive the page: plain data in and out, never a signal.
 *  - `get(name)`: a Value's current value or a Query's current rows (undefined for an undeclared name);
 *  - `set(name, value)`: write a Value (bound markup re-renders, dependent queries re-run);
 *  - `ready(name)`: a Query's next settled rows;
 *  - `mutation(name)`: a Mutation's async function (undefined for an undeclared name).
 */
interface PublicPage {
  get(name: string): Scalar | Row[] | undefined;
  set(name: string, value: Scalar): void;
  ready(name: string): Promise<Row[]>;
  mutation(name: string): MutationFn | undefined;
  upload(importName:string,file:File):Promise<DatasetUploadResult>;
  fileUrl(importName:string,ref:unknown):string;
  uploadImage(importName:string,file:File):Promise<{ref:string;url:string}>;
  imageUrl(importName:string,ref:unknown):string;
}
declare global { interface Window { page?: PublicPage } }

/**
 * Install `window.page` over this store's bindings (the same signals the script binds from `page`). Returns its
 * remover, which also drops the bindings (boot calls it on edit and dispose).
 */
export function exposePage(win: Window, store: DataflowStore): () => void {
  const bindings = bindPage(store);
  const api: PublicPage = Object.freeze({
    get: (name: string) => { const read = bindings.read(bareName(name)); return read ? untrack(read) : undefined; },
    set: (name: string, value: Scalar) => { bindings.signal(`$${bareName(name)}`)[1](value); },
    ready: (name: string) => bindings.query(`$${bareName(name)}`).ready,
    mutation: (name: string) => (bindings.has(bareName(name)) === 'mutation' ? bindings.mutation(`$${bareName(name)}`) : undefined),
    upload: bindings.upload,
    fileUrl: bindings.fileUrl,
    uploadImage: bindings.uploadImage,
    imageUrl: bindings.imageUrl,
  });
  win.page = api;
  const stopValues = exposeCommentValues(win.document, store);
  return () => { if (win.page === api) delete win.page; stopValues(); bindings.dispose(); };
}

/**
 * The declared Values are comment state as one group: what the link carries, a native comment carries and puts back
 * when its thread opens (lib/story-runtime/comment-state). The flow is read at each call: an agent's write may replace
 * the declarations under an open document. Here, not in boot: the registry and Solid's batch stay out of the boot chunk.
 */
export function exposeCommentValues(doc: Document, store: DataflowStore): () => void {
  setCommentStateTransaction(doc, batch);
  const linked = () => store.flow.values.filter((v) => v.kind === 'scalar' && v.type !== 'table' && v.url !== false).map((v) => v.name);
  return registerCommentState(doc, COMMENT_VALUES_KEY, {
    get: () => Object.fromEntries(linked().map((name) => [name, store.getState().values[name] ?? null])),
    set: (saved) => {
      if (!saved || typeof saved !== 'object' || Array.isArray(saved)) return;
      const known = new Set(linked());
      const values = Object.fromEntries(Object.entries(saved).filter(([name, value]) => known.has(name) && (value === null || typeof value !== 'object')));
      if (Object.keys(values).length) store.setValues(values as Record<string, Scalar>);
    },
  });
}

/** Where the markup placed a component the script exports (compiler `data-mx-mount`). */
const MOUNT_ATTR = 'data-mx-mount';
const PROPS_ATTR = 'data-mx-props';
const BIND_ATTR = 'data-mx-bind';

type ComponentModule = Record<string, unknown>;
type Component = (props: Record<string, unknown>) => JSX.Element;

/**
 * Render every exported component the markup placed, with Solid's `render`. Literal props arrive as values; a `$name`
 * prop is a GETTER on the props object over that Value's or Query's signal, so `props.rows` tracks where it is read
 * (Solid's own convention: do not destructure props). Returns the unmount: each root disposed, its fallback restored.
 */
export function mountComponents(root: ParentNode, mod: ComponentModule, bindings: PageBindings): () => void {
  const mounted: Array<[Element, ChildNode[], () => void]> = [];
  for (const el of root.querySelectorAll(`[${MOUNT_ATTR}]`)) {
    const name = el.getAttribute(MOUNT_ATTR) ?? '';
    const component = mod[name];
    if (typeof component !== 'function') { console.error(`[page] the script exports no component named ${name}`); continue; }
    const props: Record<string, unknown> = {};
    try { Object.assign(props, JSON.parse(el.getAttribute(PROPS_ATTR) || '{}') as Record<string, unknown>); } catch { /* a compiler writes valid JSON */ }
    let bind: Record<string, string> = {};
    try { bind = JSON.parse(el.getAttribute(BIND_ATTR) || '{}') as Record<string, string>; } catch { /* idem */ }
    for (const [prop, declared] of Object.entries(bind)) {
      const read = bindings.read(declared);
      if (read) Object.defineProperty(props, prop, { get: read, enumerable: true, configurable: true });
      else console.error(`[page] <${name} ${prop}> binds $${declared}, which is not declared`);
    }
    // The server-rendered children are the fallback: kept aside while the component renders, put back when it
    // unmounts (edit mode stops the script), so the mount never shows as a hole.
    const fallback = [...el.childNodes];
    el.replaceChildren();
    try {
      // The mount's node id scopes the component's named signals (./comment-state MountScope).
      const scope = el.id || null;
      const dispose = render(() => createComponent(MountScope.Provider, { value: scope, get children() { return createComponent(component as Component, props); } }), el);
      mounted.push([el, fallback, dispose]);
    } catch (error) {
      console.error(`[page] <${name}> failed to render`, error);
      el.replaceChildren(...fallback);
    }
  }
  return () => {
    for (const [el, fallback, dispose] of mounted) {
      dispose();
      if (el.isConnected) el.replaceChildren(...fallback);
    }
  };
}

/**
 * `page.proxy(url)`: where a document's script fetches another host — its own `/fetch` door on the origin it runs on
 * (its own origin when framed, else the app's). GET only; the door checks the host was declared and allowed.
 */
export function pageProxyUrl(id: string | null | undefined, url: unknown, origin: string = globalThis.location?.origin ?? ''): string {
  if (!id) throw new Error('page: proxy() runs only inside a published document');
  let target: URL | null = null;
  try { target = typeof url === 'string' ? new URL(url) : null; } catch { /* refused below */ }
  if (!target || target.protocol !== 'https:') throw new Error(`page: proxy(${JSON.stringify(url)}) takes an https:// URL, e.g. proxy('https://api.example.com/x')`);
  return `${origin}/a/${encodeURIComponent(id)}/fetch?url=${encodeURIComponent(target.href)}`;
}

export interface AuthorModuleStart {
  /** The module as built at publish: bare vendor specifiers, the `page` module inlined. */
  source: string;
  /** The document's id, for `proxy` (absent: `proxy` refuses). */
  id?: string | null;
  editId?:()=>string;
  store: DataflowStore | null;
  root: ParentNode;
  /** Vendor specifier → this build's chunk URL (IslandPageData.vendor). */
  vendor: Readonly<Record<string, string>>;
}

/** Point the module's bare vendor imports at this build's chunks, so the script, the runtime and the kit share one Solid. */
export function resolveVendorImports(source: string, vendor: Readonly<Record<string, string>>, base: string = typeof document === 'undefined' ? 'http://localhost/' : document.baseURI): string {
  // Absolute URLs: a blob: module has no hierarchical base, so a root-relative chunk path would not resolve from it.
  vendor = Object.fromEntries(Object.entries(vendor).map(([spec, url]) => [spec, new URL(url, base).href]));
  const specifiers = Object.keys(vendor).sort((a, b) => b.length - a.length).map((s) => s.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')).join('|');
  if (!specifiers) return source;
  return source.replace(new RegExp(`(["'])(${specifiers})\\1`, 'g'), (match, quote: string, spec: string) => (vendor[spec] ? `${quote}${vendor[spec]}${quote}` : match));
}

/**
 * The script's `createSignal` (author-module.server's solid-js shim): `{name}` makes it comment state, keyed by the
 * mount it renders in (`<node id>:<name>`), the bare name at module level. A component's signal goes with its owner;
 * a module-level one has none, so `registrations` collects its removal for the module's stop.
 */
export function scriptCreateSignal(registrations: Set<() => void>) {
  return (value: unknown, options?: SignalOptions<unknown> & { name?: unknown }) => {
    const name = typeof options?.name === 'string' && options.name ? options.name : null;
    if (!name) return solidCreateSignal(value, options);
    return commentSignal(commentStateKey(name) ?? name, value, options, registrations);
  };
}

/** Run the version's module in this document. Returns the stop function: unmounts its components and drops its bindings. */
export async function startAuthorModule(input: AuthorModuleStart): Promise<() => void> {
  const bindings = bindPage(input.store);
  const registrations = new Set<() => void>();
  // What the generated `page` module reads at import: the store's binders, `proxy` for this document, and `createSignal`.
  (globalThis as Record<string, unknown>)[PAGE_GLOBAL] = { ...bindings, createSignal: scriptCreateSignal(registrations), proxy: (url: unknown) => pageProxyUrl(input.id, url) };
  const code = resolveVendorImports(input.source, input.vendor);
  const url = URL.createObjectURL(new Blob([code], { type: 'text/javascript' }));
  let mod: ComponentModule;
  try { mod = (await import(/* @vite-ignore */ url)) as ComponentModule; }
  catch (error) { for (const remove of registrations) remove(); throw error; }
  finally { URL.revokeObjectURL(url); }
  const unmount = mountComponents(input.root, mod, bindings);
  return () => { unmount(); for (const remove of registrations) remove(); };
}
