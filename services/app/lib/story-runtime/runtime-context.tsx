/**
 * WHAT A DOCUMENT'S COMPONENTS SHARE WITH THE RUNTIME THAT DRAWS THEM — the
 * contexts StoryRuntimeApp provides and the small readers every adapter uses.
 *
 * Its own module so the kit chunks (lib/story-runtime/kit/*) can read them
 * without importing the runtime app: a chunk is loaded on demand, for the
 * documents that draw its tags, and must reach the SAME context objects the
 * runtime provides (one module instance, whichever chunk imports it first).
 */
import { createContext, useContext, useState } from 'react';
import type { ReactElement } from 'react';
import { Tooltip } from '@/components/Tooltip';
import { AST_PATH_ATTR } from '@/lib/story-ui/ast-path';
import type { RefDataMap, ImageAssetAnswer } from '@/lib/story/ref-data';
import type { GlyphMap } from '@/lib/story-ui/icon-contract';
import type { createRowActions } from './row-actions';
import type { CellSessions } from './cell-sessions';
import { EMPTY_STATE, type DataflowStore } from './store';
import { resolveBindings, type BindingSource, type DataflowState, type Row, type Scalar } from '@/lib/story/dataflow';
import { EMPTY_COMPILED_DATAFLOW, type CompiledDataflow } from '@/lib/story/compiled-dataflow';
import { VIEWER_ID } from '@/lib/story/builtins';
import type { ManagedAssetRelay } from './managed-assets';
import type { StoryIslandData, StoryViewer } from './contract';

/** A store-less subscribe (a component rendered outside a document): nothing ever changes. */
export const NO_SUBSCRIBE = () => () => {};

/**
 * What every embed and bound control reads: the document's data (one store
 * snapshot — identity-stable between changes) plus the setter, and the
 * ref-resolved recipes/images. `pending` names the queries a re-run has in
 * flight, so an embed says "loading" only about its OWN table.
 */
export interface RuntimeEmbedContextValue {
  /**
   * The store itself, for the one consumer that needs more than a snapshot:
   * a `<Button run>` performs a write and watches its in-flight set. Every
   * other consumer reads the fields below, which are already snapshot-stable.
   */
  store: DataflowStore | null;
  flow: CompiledDataflow;
  state: DataflowState;
  pending: ReadonlySet<string>;
  /** `debounce` for a continuous input (typing, a slider); a discrete change runs at once. */
  setValue: (name: string, value: Scalar, options?: { debounce?: boolean }) => void;
  /** A window of one query's rows through the transport (a table reading past the cap). */
  fetchPage: DataflowStore['fetchPage'];
  refData: RefDataMap;
  /**
   * FALSE inside a `chrome=0` capture. An embed that must draw differently for
   * a photograph reads it here rather than being told by the author: `<Files>`
   * draws glyphs instead of every child's own og card, because a capture that
   * waits on N captures is not a capture (and a private child's is a 404 to the
   * session-less browser taking the shot).
   */
  chrome: boolean;
  glyphs?: GlyphMap;
  colorMode: 'light' | 'dark';
  /**
   * WHO IS READING (StoryIslandData.viewer), null for a guest. `<User>` and
   * `<SignIn>` are its only consumers: one names a person, the other exists
   * solely for the absence of one. Read from the island rather than from the
   * store, so it is already right on the first paint of a document that
   * declares no data at all.
   */
  viewer: StoryViewer | null;
  managedAssets?: StoryIslandData['managedAssets'];
  importManagedAsset?: ManagedAssetRelay;
}

export const RuntimeEmbedContext = createContext<RuntimeEmbedContextValue>({
  store: null,
  flow: EMPTY_COMPILED_DATAFLOW,
  state: EMPTY_STATE,
  pending: new Set(),
  setValue: () => {},
  fetchPage: () => Promise.reject(new Error('no store')),
  refData: {},
  chrome: true,
  glyphs: {},
  colorMode: 'light',
  viewer: null,
});

/**
 * WHERE A RUNTIME-COMPUTED IMAGE URL IS SERVED FROM.
 *
 * `endpoint` is the document's own asset import address (StoryIslandData
 * `assetsUrl`); `seen` is the small set of URLs the browser has actually
 * LOADED, which is the only evidence this side has that we hold a copy. It
 * starts empty on both ends of the wire deliberately — see `runtimeAssetUrl`:
 * the island carries no asset lookup, so a server that knew more than the
 * hydrating client would hand React a mismatch and lose the whole server tree.
 *
 * A mutable Set rather than state: recording a load must not re-render (the
 * image is already on screen — a re-render would only swap its src for an
 * equivalent one and fetch again). The next render that happens for its own
 * reasons picks the shorter address up.
 */
export interface RuntimeAssetContextValue {
  endpoint: string | null;
  seen: Set<string>;
  /**
   * An optional asset importer supplied by the caller. When present, the
   * importer is authoritative and the element's own load/error bookkeeping is
   * skipped; a document transport relay is one caller, especially for opaque
   * framed child realms.
   */
  importAsset?: (url: string) => Promise<ImageAssetAnswer>;
  images?: Map<string,Promise<ImageAssetAnswer>>;
}

export const RuntimeAssetContext = createContext<RuntimeAssetContextValue>({ endpoint: null, seen: new Set() });

/**
 * A control bound to a FROZEN Value (DataflowStore.frozenReason): the control
 * itself is disabled and described by the reason, and — because a disabled
 * control cannot take focus — this wrapper is what a keyboard reaches to hear
 * it, and what shows the tooltip. Present only when a reason is.
 */
export function FrozenHint({reason,children}:{reason:string|null;children:ReactElement}) {
  const [open,setOpen]=useState(false);
  if (!reason) return children;
  return <Tooltip content={reason} open={open} onOpenChange={setOpen}>
    <span className="inline-flex" tabIndex={0} aria-description={reason}>{children}</span>
  </Tooltip>;
}

export const CellSessionsContext = createContext<CellSessions | null>(null);

/**
 * A control's `set=` / `args=` map, read NOW: literals as written (a row
 * field was already read into one by the interpreter), page values from the
 * store, `$_me.id` from the viewer. Read at the click, never at render, so a
 * press uses the values the reader is looking at.
 */
export function useBindingReader(): (map: unknown) => Record<string, Scalar> | undefined {
  const { store, viewer } = useContext(RuntimeEmbedContext);
  return (map) => map && typeof map === 'object'
    ? resolveBindings(map as Record<string, BindingSource>, (ref) => (ref === VIEWER_ID ? viewer?.id ?? null : store?.getValue(ref)))
    : undefined;
}
export const scalarRow = (row: Row): Record<string, Scalar> => Object.fromEntries(Object.entries(row).filter((entry): entry is [string, Scalar] => {
  const v = entry[1]; return v === null || typeof v === 'string' || typeof v === 'boolean' || (typeof v === 'number' && Number.isFinite(v));
}));

export const RowActionsContext = createContext<ReturnType<typeof createRowActions> | null>(null);

/**
 * The authored identity that belongs on an adapter's existing outer DOM
 * target. Keep this deliberately narrow: embed props include data/viz objects
 * and binding strings that must never be spread onto a host element.
 */
export function runtimeTargetIdentity(props: Record<string, unknown>): { id?: string; [AST_PATH_ATTR]?: string } {
  return {
    ...(typeof props.id === 'string' ? { id: props.id } : {}),
    ...(typeof props[AST_PATH_ATTR] === 'string' ? { [AST_PATH_ATTR]: props[AST_PATH_ATTR] } : {}),
  };
}
