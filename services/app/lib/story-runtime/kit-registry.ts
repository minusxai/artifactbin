/**
 * THE KIT, LOADED PER DOCUMENT.
 *
 * The runtime draws a document's components from this registry, and the
 * registry holds only the chunks (lib/story-ui/kit-chunks) someone asked for:
 * the reader page and the served document load exactly the chunks their
 * document draws BEFORE they hydrate it (so the first client render is the
 * server's, component for component), and a later version or an edit that
 * adds a component loads its chunk before that render commits. A page of
 * prose loads none of them.
 *
 * The server renderer, the offline file and the test suites register every
 * chunk synchronously instead (./kit/all): they render in one pass and have
 * nothing to fetch.
 *
 * One registry per page: a chunk, once loaded, serves every document the page
 * renders afterwards.
 */
import type { ComponentType } from 'react';
import type { JsxNode } from '@/lib/jsx';
import { kitChunksOf, type KitChunkId } from '@/lib/story-ui/kit-chunks';
import { Icon } from '@/components/kit/icon';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/Tooltip';
import type { DateControl, SelectControl, shellRest } from '@/components/kit/controls';
import type { selectOptions } from './kit/controls';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type KitComponents = Record<string, ComponentType<any>>;

/** The kit controls an editable table cell draws with (StoryRuntimeApp RuntimeCellControl). */
export interface KitCells {
  SelectControl: typeof SelectControl;
  DateControl: typeof DateControl;
  selectOptions: typeof selectOptions;
  shellRest: typeof shellRest;
}

/** One chunk's code, as its module exports it (`chunk`). */
export interface KitChunk {
  /** The tags' STATIC faces: what an inert render draws (a deck rail's slide previews). */
  faces: KitComponents;
  /** The LIVE faces a document draws, over `faces`: resolved from the store, writing back. */
  live?: KitComponents;
  /** Present on the controls chunk only. */
  cells?: KitCells;
}

/**
 * The tags every runtime draws with code it already carries (kit-chunks
 * CORE_TAGS). `For` is the interpreter's own template; registered for
 * completeness, like `Column`.
 */
export const CORE_FACES: KitComponents = {
  Icon,
  Tooltip, TooltipTrigger, TooltipContent, TooltipProvider,
  For: (() => null) as ComponentType<unknown>,
};

/*
 * One `import()` per chunk, each its own split point on both reader paths
 * (the app's Vite build, the served document's esbuild build). The server
 * finds these modules by path to preload them (server/reader-preloads,
 * scripts/build-story-runtime.mjs): lib/story-runtime/kit/<id>.tsx.
 */
const LOADERS: { readonly [K in KitChunkId]: () => Promise<{ chunk: KitChunk }> } = {
  card: () => import('./kit/card'),
  badge: () => import('./kit/badge'),
  alert: () => import('./kit/alert'),
  table: () => import('./kit/table'),
  separator: () => import('./kit/separator'),
  skeleton: () => import('./kit/skeleton'),
  progress: () => import('./kit/progress'),
  breadcrumb: () => import('./kit/breadcrumb'),
  grid: () => import('./kit/grid'),
  file: () => import('./kit/file'),
  video: () => import('./kit/video'),
  button: () => import('./kit/button'),
  avatar: () => import('./kit/avatar'),
  tabs: () => import('./kit/tabs'),
  accordion: () => import('./kit/accordion'),
  collapsible: () => import('./kit/collapsible'),
  popover: () => import('./kit/popover'),
  dialog: () => import('./kit/dialog'),
  controls: () => import('./kit/controls'),
  slides: () => import('./kit/slides'),
  user: () => import('./kit/user'),
  'sign-in': () => import('./kit/sign-in'),
  'data-table': () => import('./kit/data-table'),
  files: () => import('./kit/files'),
  mermaid: () => import('./kit/mermaid'),
  'deck-gl': () => import('./kit/deck-gl'),
  iframe: () => import('./kit/iframe'),
  question: () => import('./kit/question'),
  number: () => import('./kit/number'),
};

const loaded = new Map<KitChunkId, KitChunk>();
const pending = new Map<KitChunkId, Promise<void>>();
const listeners = new Set<() => void>();
let version = 0;
let merged: (LoadedKit & { version: number }) | null = null;

const changed = () => { version += 1; for (const listener of [...listeners]) listener(); };

/** Register a chunk that is already in hand (./kit/all). */
export function registerKitChunk(id: KitChunkId, chunk: KitChunk): void {
  if (loaded.get(id) === chunk) return;
  loaded.set(id, chunk);
  changed();
}

/** Whether every chunk in `ids` is here. */
export const kitLoaded = (ids: Iterable<KitChunkId>): boolean => { for (const id of ids) if (!loaded.has(id)) return false; return true; };

/**
 * Load the chunks in `ids` that are not here yet, together. Resolves once all
 * of them are registered; rejects when any fails, and a failed chunk is
 * forgotten so the next call asks again (a reader who went offline, a deploy
 * that replaced the content-addressed file).
 */
export function loadKitChunks(ids: Iterable<KitChunkId>): Promise<void> {
  const waits: Promise<void>[] = [];
  for (const id of ids) {
    if (loaded.has(id)) continue;
    let wait = pending.get(id);
    if (!wait) {
      wait = LOADERS[id]().then(
        (module) => { pending.delete(id); registerKitChunk(id, module.chunk); },
        (error: unknown) => { pending.delete(id); throw error; },
      );
      pending.set(id, wait);
    }
    waits.push(wait);
  }
  return waits.length ? Promise.all(waits).then(() => undefined) : Promise.resolve();
}

/** Whether everything `nodes` can draw is here. */
export const kitReadyFor = (nodes: readonly JsxNode[]): boolean => kitLoaded(kitChunksOf(nodes));

/** Load everything `nodes` can draw (lib/story-ui/kit-chunks kitChunksOf). */
export const loadKitFor = (nodes: readonly JsxNode[]): Promise<void> => loadKitChunks(kitChunksOf(nodes));

/** Subscribe to chunks arriving (a React external store: `kitVersion` is its snapshot). */
export function subscribeKit(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
export const kitVersion = (): number => version;

/** What is loaded now, merged: static faces (core first), live faces, and the table cells' controls. */
export interface LoadedKit { faces: KitComponents; live: KitComponents; cells: KitCells | null }
export function kitComponents(): LoadedKit {
  if (merged?.version === version) return merged;
  const faces: KitComponents = { ...CORE_FACES };
  const live: KitComponents = {};
  let cells: KitCells | null = null;
  for (const chunk of loaded.values()) {
    Object.assign(faces, chunk.faces);
    if (chunk.live) Object.assign(live, chunk.live);
    if (chunk.cells) cells = chunk.cells;
  }
  merged = { version, faces, live, cells };
  return merged;
}

/** Test seam: forget every chunk, as a fresh page would have none. */
export function resetKitRegistry(): void {
  loaded.clear();
  pending.clear();
  changed();
}
