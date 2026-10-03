/**
 * THE ISLAND BOOT (`@mx/boot`, docs/phase2-architecture.md §2.3, §2.4): what a compiled page's
 * per-document module calls once, with its islands and its declarations.
 *
 *   import { boot } from '@mx/boot';
 *   boot({ ISLANDS, FLOW });
 *
 * 1. reads the page data island (`#mx-story-data`, contract `IslandPageData`);
 * 2. starts the EXISTING store (lib/story-runtime/store) over the EXISTING document transport,
 *    seeded from the snapshot's `results` and the reader's URL `values`;
 * 3. hydrates every island in place under the story root (rt `hydrateIsland`);
 * 4. installs the `IslandDocument` on the story root (handover.ts) for the SPA to adopt;
 * 5. marks `<html data-mx-ready>` and fires `mx:ready` on `document` — also when there are no
 *    islands, so a page with a module always signals ready;
 * 6. top-level only: holds the document's live stream (./live, from the snapshot's `since`) and
 *    re-runs exactly the queries reading a dataset a `data` frame names (`store.invalidateDatasets`);
 * 7. when the page data names the version's author script, loads the page runtime (`@mx/page-runtime`, the
 *    chunk the page data's `vendor` names) and runs the script in this document against this store, after
 *    the islands have hydrated. Edit mode and dispose stop it (the editor starts its own).
 * 7b. top-level only, whenever the page declares data: exposes the declared names as `window.page`
 *    (`value`, `query`, `mutation`, `signal`, the same signals the script imports from `page`) for browser
 *    sessions to drive the page. Edit mode and dispose remove it; reading again restores it.
 * 8. when the page may hold data (`hold`, `sqliteWasm`): gives the store the page's own SQLite engine
 *    (./sqlite-engine, bundled alone and loaded behind the first paint — the store asks for it once the
 *    first run is on its way), so what the reader holds is answered in the page, as the former reader does.
 * 9. top-level only: the link follows the reader — a moved `<Value>` rewrites the page's own `$` params
 *    (./url-sync), loaded after hydration.
 *
 * The viewer overlay, the write status feed and its indicator are wave-3 seams (viewer.ts,
 * writes.ts, kit/status.tsx): this file calls them and their owners replace those files.
 */
import type { Component } from 'solid-js';
import type { CompiledDataflow } from '@/lib/story/data/compiled-dataflow';
import { createDataflowStore } from '@/lib/story-runtime/store';
import { createDocumentTransport } from '@/lib/story-runtime/document-transport';
import { createFetchTransport } from '@/lib/story-runtime/fetch-transport';
import { STORY_DATA_HOOK } from '@/lib/story-runtime/contract';
import { ISLAND_DATA_ID, READER_READY_ATTR } from '@/lib/compiled-page/contract';
import { ISLAND_DOCUMENT_KEY, ISLANDS_READY_EVENT, LIVE_EDIT_ATTR, LIVE_ID_ATTR, STORY_ROOT_SELECTOR, type IslandDocument, type IslandDocumentMode, type IslandEvent, type IslandHost, type IslandPageData, type IslandViewer } from './contract';
import { createIslandRuntime, hydrateIsland } from './rt';
import { lazyEngine, normalizeIslandModule, type IslandModuleInput } from './module';
import { installIslandDocument } from './handover';
import { createWriteStatusFeed } from './writes';
import { loadChart } from './chart';

/**
 * One island of the per-document module: its hydration key prefix (`IslandRef.renderId`), its component,
 * and its KEY — a digest of the island's definition (the compiler's `islandKey`), equal across versions
 * exactly when the island is the same island, whatever its position. A new version keeps a running
 * island whose key it carries again (./morph/engine).
 */
export type IslandEntry = readonly [renderId: string, component: Component, key?: string];

/** What the per-document module hands `boot`. */
export interface IslandModule {
  /** Every island, in document order. */
  ISLANDS: readonly IslandEntry[];
  /** Single-tree modules expose their component for cached re-imports during a morph. */
  TREE?: Component;
  /** The version's compiled dataflow (the islands' data), or null/absent when they read none. */
  FLOW?: CompiledDataflow | null;
}

/**
 * THE MORPH SEAM (./morph/engine, framework-free): what a running document lends the engine that draws a
 * new version in place — never part of the SPA's contract (`IslandDocument`). The engine does the
 * matching and the DOM; the Solid work (hydrating) stays here, on this document's context.
 */
export interface IslandMorphSeam {
  /** Every running island by render id: its key and its disposer (which leaves its DOM as static markup). */
  readonly islands: Map<string, readonly [key: string | undefined, dispose: () => void]>;
  /** Hydrate one more island under the root on this document's context, and record it running. */
  hydrate(entry: IslandEntry): void;
  /** Every module this document has run, by its `ISLANDS` (a cached re-import runs no `boot`). */
  readonly modules: WeakMap<readonly IslandEntry[], IslandModule>;
  readonly trees: WeakMap<Component, IslandModule>;
  /** Set by the engine while it imports a newer version's module: that module's `boot` hands it in here. */
  take?: (module: IslandModule) => void;
  /** Replace only the sandboxed author realm after a version changes its source. */
  restartAuthor(source: string | null): Promise<void>;
}
export type MorphableIslandDocument = IslandDocument & { morph?: IslandMorphSeam };

const EMPTY_PAGE: IslandPageData = { values: {}, results: null, signedIn: false, hold: [], mermaidImages: {}, readOnly: null };

/** The page data island, or the empty page when it is absent or unreadable (the islands still hydrate). */
/**
 * This document's id, for the script's `proxy`: the live identity on `<body>`, else the id its doors name (a capture
 * carries no live identity but still has its assets door). Null when neither says.
 */
export function documentIdOf(doc: Document): string | null {
  const live = doc.body?.getAttribute(LIVE_ID_ATTR);
  if (live) return live;
  const data = readPageData(doc);
  for (const door of [data.queryUrl, data.assetsUrl, data.viewerUrl]) {
    const id = door ? /\/a\/([^/?#]+)\//.exec(door)?.[1] : null;
    if (id) return decodeURIComponent(id);
  }
  return null;
}

export function readPageData(doc: Document): IslandPageData {
  const text = doc.getElementById(ISLAND_DATA_ID)?.textContent;
  if (!text) return EMPTY_PAGE;
  try {
    const data = JSON.parse(text) as Partial<IslandPageData> | null;
    return data && typeof data === 'object' ? { ...EMPTY_PAGE, ...data } : EMPTY_PAGE;
  } catch {
    return EMPTY_PAGE;
  }
}

/**
 * `ISLANDS` alone is accepted for a module whose islands read no data (the compiler's first shape);
 * a module with data passes `{ ISLANDS, FLOW }`.
 */
export function boot(input: IslandModuleInput, win: Window = window): IslandDocument {
  const module = normalizeIslandModule(input);
  const doc = win.document;
  const root = doc.querySelector<HTMLElement>(STORY_ROOT_SELECTOR) ?? doc.body;
  // A newer version's module, imported by the morph engine: handed to the running document, never booted twice.
  const running = (root as IslandHost)[ISLAND_DOCUMENT_KEY] as MorphableIslandDocument | undefined;
  if (running?.morph?.take) { running.morph.take(module); return running; }
  const data = readPageData(doc);
  const flow = module.FLOW ?? null;
  // A signed-in reader's queries and writes are theirs: the transport carries the session to the
  // doors that read it. A guest page keeps the anonymous GET door (lib/story-runtime/fetch-transport).
  // A document on its OWN origin (APP__PAGES_HOST) calls its absolute doors directly, framed or not,
  // with its pages cookie (`credentials: 'include'`).
  const direct = !!data.direct && !!data.queryUrl;
  const transport = !flow ? null : direct
    ? createFetchTransport(data.queryUrl!, undefined, data.mutateUrl, { session: data.signedIn, credentials: 'include' })
    : createDocumentTransport(win, data.queryUrl, undefined, data.mutateUrl, { session: data.signedIn });
  /** What a top-level page holds itself — its stream and `window.page` — a document on its own origin holds framed too. */
  const holdsOwn = win.parent === win || direct;
  /*
   * The page's own engine, when this page may hold data and its door can fetch it (the relay cannot):
   * `$_me` is bound to the reader the door answers for — nobody on a guest page; on a signed-in page
   * whose data names the reader, the one the overlay names, and until it has, the server answers.
   */
  const readsMe = !!flow && [...flow.queries, ...flow.mutations].some((node) => node.reads.builtins.some((b) => b === '_me' || b.startsWith('_me.')));
  let identified = !(data.signedIn && readsMe);
  let viewerId: string | null = null;
  const page = flow && transport?.hold && data.sqliteWasm
    ? {
      engine: lazyEngine(() => import('./sqlite-engine').then((m) => m.pageEngine(data.sqliteWasm!, (name) => transport!.hold!(name))), () => identified),
      get userId() { return viewerId; },
    }
    : null;
  const runtime = createIslandRuntime(
    {
      dataflow: flow ? { flow, values: data.values ?? {}, hold: data.hold ?? [], ...(data.state ? { state: data.state } : {}), ...(data.results ? { results: data.results } : {}) } : null,
      assetsUrl: data.assetsUrl,
      mermaidImages: data.mermaidImages ?? {},
      viewer: data.signedIn ? { hinted: true } : null,
      readOnly: data.readOnly ?? null,
    },
    (input) => createDataflowStore(input, { transport, writesUnavailable: data.readOnly ?? null, page }),
    { writes: createWriteStatusFeed, loadChart },
  );
  const { context, store } = runtime;

  const listeners = new Set<(event: IslandEvent) => void>();
  const emit = (event: IslandEvent) => { for (const listener of [...listeners]) listener(event); };

  // Each island on its own: one that fails to hydrate stays static markup and the rest still run.
  const islands: IslandMorphSeam['islands'] = new Map();
  const hydrate = ([renderId, Component, key]: IslandEntry) => {
    try {
      const dispose = hydrateIsland(renderId, Component, context, root);
      if (dispose) islands.set(renderId, [key, dispose]);
    } catch (error) {
      console.error('[islands] hydrate failed', error);
    }
  };
  const disposeIslands = () => { const all = [...islands.values()]; islands.clear(); for (const [, dispose] of all) dispose(); };

  const stopWrites = context.writes.subscribe((statuses) => emit({ type: 'writes', statuses }));
  let stopStatus = () => {};

  // The document's own live stream, top-level only (framed, the page above holds it and posts in) — or on its own origin.
  const hooks = win as unknown as Record<string, unknown>;
  let stopLive = () => {};
  const liveId = doc.body?.getAttribute(LIVE_ID_ATTR);
  const liveEdit = doc.body?.getAttribute(LIVE_EDIT_ATTR);
  const holdsLive = holdsOwn && typeof (win as { EventSource?: unknown }).EventSource === 'function' && !!liveId && !!liveEdit;
  /** Open the stream from the version the page shows now (its `<body>` names it), picking up at `since`. */
  const openLive = (since: string | null) => {
    const edit = doc.body?.getAttribute(LIVE_EDIT_ATTR);
    if (!holdsLive || !liveId || !edit) return;
    void import('./live').then(({ startIslandLive }) => {
      if (!disposed && mode === 'read') { stopLive(); stopLive = startIslandLive(win, liveId, edit, since); }
    }).catch((error: unknown) => console.error('[islands] live failed', error));
  };
  if (holdsLive) {
    if (store) hooks[STORY_DATA_HOOK] = (datasets: string[]) => store.invalidateDatasets(datasets);
    // From the snapshot's marks: a dataset written since the snapshot was taken re-runs at once (live.ts).
    // Loaded after hydration, off the shared runtime's closure: the marks cover the gap, so nothing is missed.
    openLive(data.results?.since ?? null);
  }
  // The link follows the reader (./url-sync), top-level only: a framed document's address is its frame's.
  let stopUrl = () => {};
  /** The link follows the reader while reading; editing pauses it (no value moves) and reading again resumes it. */
  const followUrl = () => {
    if (store && win.parent === win) void import('./url-sync').then(({ startUrlSync }) => {
      if (!disposed && mode === 'read') { stopUrl(); stopUrl = startUrlSync(win, store); }
    }, () => {});
  };
  followUrl();

  let mode: IslandDocumentMode = 'read';
  let ready = false;
  let disposed = false;
  let stopAuthor = () => {};
  let authorGeneration = 0;
  /**
   * Run the version's script IN THIS DOCUMENT: the page runtime (`@mx/page-runtime`, a chunk of the serving build
   * named by the page data) binds the declared names as signals over this store, loads the module with its vendor
   * imports pointed at the same build, and mounts the components it exports where the markup placed them.
   */
  const restartAuthor = async (source: string | null) => {
    const generation = ++authorGeneration;
    stopAuthor();
    // `window.page` (top-level, a page that declares data) comes from the same runtime, script or not.
    const exposes = !!store && holdsOwn;
    if (!source && !exposes) return;
    const vendor = readPageData(doc).vendor ?? {};
    const runtimeUrl = vendor['@mx/page-runtime'];
    if (!runtimeUrl) { if (source) console.error('[islands] the page names a script but no runtime for it'); return; }
    const runtime = (await import(/* @vite-ignore */ runtimeUrl)) as typeof import('./page-runtime');
    if (generation !== authorGeneration || disposed || mode !== 'read') return;
    const hide = exposes ? runtime.exposePage(win, store!) : () => {};
    const stop = source ? await runtime.startAuthorModule({ source, store, root, vendor, id: documentIdOf(doc) }) : () => {};
    if (generation !== authorGeneration || disposed || mode !== 'read') { stop(); hide(); return; }
    stopAuthor = () => { stopAuthor = () => {}; stop(); hide(); };
  };
  const islandDocument: MorphableIslandDocument = {
    morph: { islands, hydrate, modules: new WeakMap([[module.ISLANDS, module]]), trees: new WeakMap(module.TREE ? [[module.TREE, module]] : []), restartAuthor },
    root,
    store,
    context,
    mode: () => mode,
    setMode: (next) => {
      if (disposed || next === mode) return;
      if (next === 'read') {
        /*
         * Back to reading IN PLACE (the page's controller has already drawn the saved version on this
         * context, lib/story-runtime/island-controller `restoreRead`, and synced the page's records): the
         * document's stream, `window.page` and the version's author script resume as boot started them.
         * The stream opens from the snapshot's marks, so a dataset written while editing re-runs at once.
         */
        mode = 'read';
        runtime.setPaused(false);
        openLive(data.results?.since ?? null);
        followUrl();
        const script = readPageData(doc).authorScript;
        void restartAuthor(typeof script === 'string' && script ? script : null).catch((error: unknown) => console.error('[islands] author host failed', error));
        emit({ type: 'mode', mode });
        return;
      }
      stopAuthor();
      // The interpreter owns edits and their live updates. A version ping from this compiled
      // lifetime must not reload the page while its editor is saving a new source.
      stopLive();
      stopUrl();
      stopUrl = () => {};
      // PAUSED, never disposed: the islands keep their DOM and state (a chart stays drawn, nothing hydrates
      // again), and the editor's first draft keeps the running tree when it keeps every component in it.
      runtime.setPaused(true);
      mode = next;
      emit({ type: 'mode', mode });
    },
    ready: () => ready,
    subscribe: (listener) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
    dispose: () => {
      if (disposed) return;
      disposed = true;
      stopAuthor();
      disposeIslands();
      stopLive();
      stopUrl();
      if (store && hooks[STORY_DATA_HOOK]) delete hooks[STORY_DATA_HOOK];
      stopStatus();
      stopWrites();
      runtime.dispose();
      listeners.clear();
    },
  };
  installIslandDocument(root, islandDocument);

  {
    module.ISLANDS.forEach(hydrate);
    ready = true;
    doc.documentElement.setAttribute(READER_READY_ATTR, '');
    emit({ type: 'ready' });
    doc.dispatchEvent(new Event(ISLANDS_READY_EVENT));
    store?.start();
    // Identity and viewer-scoped rows arrive after the guest page is ready.
    void import('./viewer').then(({ loadViewerOverlay }) => {
      if (disposed) return;
      loadViewerOverlay(context, data, {
        setViewer: (viewer: IslandViewer) => {
          viewerId = viewer && 'id' in viewer ? viewer.id : null;
          identified = true;
          runtime.setViewer(viewer);
          emit({ type: 'overlay', viewer: viewer && 'id' in viewer ? viewer : null });
        },
      });
    }).catch((error: unknown) => console.error('[islands] viewer overlay did not load', error));
    void import('./kit/status').then(({ installStatus }) => {
      if (!disposed) stopStatus = installStatus(context.writes, root);
    }).catch((error: unknown) => console.error('[islands] write status did not load', error));
    if (page && !data.hold?.length) page.engine.prepare(flow!, []);
    const authorScript = typeof data.authorScript === 'string' && data.authorScript ? data.authorScript : null;
    void restartAuthor(authorScript).catch((error: unknown) => console.error('[islands] author host failed', error));
  }
  return islandDocument;
}
