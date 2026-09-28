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
 * 6. top-level only: holds the document's live stream (lib/story-runtime/live-entry, by import) and
 *    re-runs exactly the queries reading a dataset a `data` frame names (`store.invalidateDatasets`).
 *
 * The viewer overlay, the write status feed and its indicator are wave-3 seams (viewer.ts,
 * writes.ts, kit/status.tsx): this file calls them and their owners replace those files.
 */
import type { Component } from 'solid-js';
import type { CompiledDataflow } from '@/lib/story/compiled-dataflow';
import { createDataflowStore } from '@/lib/story-runtime/store';
import { createDocumentTransport } from '@/lib/story-runtime/document-transport';
import { startDocumentLive } from '@/lib/story-runtime/live-entry';
import { STORY_DATA_HOOK } from '@/lib/story-runtime/contract';
import { ISLAND_DATA_ID, READER_READY_ATTR } from '@/lib/compiled-page/contract';
import { ISLANDS_READY_EVENT, type IslandDocument, type IslandDocumentMode, type IslandEvent, type IslandPageData, type IslandViewer } from './contract';
import { createIslandRuntime, hydrateIsland } from './rt';
import { installIslandDocument } from './handover';
import { loadViewerOverlay } from './viewer';
import { createWriteStatusFeed } from './writes';
import { installStatus } from './kit/status';
import { loadChart } from './chart';

/** One island of the per-document module: its hydration key prefix (`IslandRef.renderId`) and its component. */
export type IslandEntry = readonly [renderId: string, component: Component];

/** What the per-document module hands `boot`. */
export interface IslandModule {
  /** Every island, in document order. */
  ISLANDS: readonly IslandEntry[];
  /** The version's compiled dataflow (the islands' data), or null/absent when they read none. */
  FLOW?: CompiledDataflow | null;
}

/** The story element the islands live in (the assembler's `inlineStoryElement`). */
const STORY_ROOT_SELECTOR = '[data-mx-inline-story]';
/** The document's live identity on `<body>` (lib/story/document's convention, read as anchor-entry reads it). */
const LIVE_ID_ATTR = 'data-mx-live-id';
const LIVE_EDIT_ATTR = 'data-mx-live-edit';

const EMPTY_PAGE: IslandPageData = { values: {}, results: null, signedIn: false, mermaidImages: {}, readOnly: null };

/** The page data island, or the empty page when it is absent or unreadable (the islands still hydrate). */
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

/** The app's origin: where this chunk was served from (a `/raw` copy's own origin is opaque). */
const appOrigin = (): string => {
  try { return new URL(import.meta.url).origin; } catch { return ''; }
};

/**
 * `ISLANDS` alone is accepted for a module whose islands read no data (the compiler's first shape);
 * a module with data passes `{ ISLANDS, FLOW }`.
 */
export function boot(input: IslandModule | readonly IslandEntry[], win: Window = window): IslandDocument {
  const module: IslandModule = Array.isArray(input) ? { ISLANDS: input as readonly IslandEntry[] } : (input as IslandModule);
  const doc = win.document;
  const root = doc.querySelector<HTMLElement>(STORY_ROOT_SELECTOR) ?? doc.body;
  const data = readPageData(doc);
  const flow = module.FLOW ?? null;

  const transport = flow ? createDocumentTransport(win, data.queryUrl, appOrigin(), undefined, data.mutateUrl) : null;
  const runtime = createIslandRuntime(
    {
      dataflow: flow ? { flow, values: data.values ?? {}, ...(data.results ? { results: data.results } : {}) } : null,
      mermaidImages: data.mermaidImages ?? {},
      viewer: data.signedIn ? { hinted: true } : null,
      readOnly: data.readOnly ?? null,
    },
    (input) => createDataflowStore(input, { transport, writesUnavailable: data.readOnly ?? null }),
    { writes: createWriteStatusFeed, loadChart },
  );
  const { context, store } = runtime;
  store?.start();

  const listeners = new Set<(event: IslandEvent) => void>();
  const emit = (event: IslandEvent) => { for (const listener of [...listeners]) listener(event); };

  // Each island on its own: one that fails to hydrate stays static markup and the rest still run.
  let islands: Array<() => void> = [];
  for (const [renderId, Component] of module.ISLANDS) {
    try {
      const dispose = hydrateIsland(renderId, Component, context, root);
      if (dispose) islands.push(dispose);
    } catch (error) {
      console.error(`[islands] ${renderId} did not hydrate`, error);
    }
  }
  const disposeIslands = () => { const all = islands; islands = []; for (const dispose of all) dispose(); };

  const stopWrites = context.writes.subscribe((statuses) => emit({ type: 'writes', statuses }));
  const stopStatus = installStatus(context.writes, root);

  // The document's own live stream, top-level only (framed, the page above holds it and posts in).
  const hooks = win as unknown as Record<string, unknown>;
  let stopLive = () => {};
  const liveId = doc.body?.getAttribute(LIVE_ID_ATTR);
  const liveEdit = doc.body?.getAttribute(LIVE_EDIT_ATTR);
  if (win.parent === win && typeof (win as { EventSource?: unknown }).EventSource === 'function' && liveId && liveEdit) {
    if (store) hooks[STORY_DATA_HOOK] = (datasets: string[]) => store.invalidateDatasets(datasets);
    stopLive = startDocumentLive(win, liveId, liveEdit);
  }

  let mode: IslandDocumentMode = 'read';
  let ready = false;
  let disposed = false;
  const islandDocument: IslandDocument = {
    root,
    store,
    context,
    mode: () => mode,
    setMode: (next) => {
      if (disposed || next === mode || next === 'read') return;
      disposeIslands();
      mode = next;
      emit({ type: 'mode', mode });
    },
    ready: () => ready,
    subscribe: (listener) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
    dispose: () => {
      if (disposed) return;
      disposed = true;
      disposeIslands();
      stopLive();
      if (store && hooks[STORY_DATA_HOOK]) delete hooks[STORY_DATA_HOOK];
      stopStatus();
      stopWrites();
      runtime.dispose();
      listeners.clear();
    },
  };
  installIslandDocument(root, islandDocument);

  loadViewerOverlay(context, data, {
    setViewer: (viewer: IslandViewer) => {
      runtime.setViewer(viewer);
      emit({ type: 'overlay', viewer: viewer && 'id' in viewer ? viewer : null });
    },
  });

  ready = true;
  doc.documentElement.setAttribute(READER_READY_ATTR, '');
  emit({ type: 'ready' });
  doc.dispatchEvent(new Event(ISLANDS_READY_EVENT));
  return islandDocument;
}
