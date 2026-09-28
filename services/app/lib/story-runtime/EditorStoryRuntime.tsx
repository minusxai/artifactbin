import { runtimeId } from './runtime-id';
import { installMx } from './mx';
import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState, type ComponentType, type ReactNode } from 'react';
import type { StoryDocumentUpdate, StoryIslandData } from './contract';
import type { QueryTransport } from './store';
import { createDataflowStore } from './store';
import { pageEngineFor } from './page-sqlite';
import { EMPTY_COMPILED_DATAFLOW } from '@/lib/story/compiled-dataflow';
import { createAuthorScriptSession } from './author-script';
import type { FrameEditSession } from './edit/session';
import type { FrameAnnotateSession } from './edit/annotate';
import type { FrameSelectionActions } from './edit/selection-actions';
import type { RuntimeChannel } from './pristine';
import { STORY_EDIT_MODE_MESSAGE, STORY_ANNOTATIONS_MESSAGE, STORY_SELECTION_ACTIONS_MESSAGE, STORY_SELECTION_ACTION_MESSAGE, STORY_SELECT_MESSAGE, STORY_VALUES_MESSAGE, isEditParentMessage, STORY_DATA_MESSAGE, STORY_READER_MODE_MESSAGE } from './contract';
import { isStoryDocumentUpdate } from './document-update';
import { isServedRuntime, type PreparedStoryRuntime, type ServedStoryRuntime } from '@/lib/story/prepared-runtime';
import type { JsxNode } from '@/lib/jsx';
import { applyStyleOverrides, type StyleOverride } from '@/lib/story/style-overrides';
import type { StoryBaseCssRecipe } from '@/lib/story/story-base-css';
import type { EditorSheetPolicy } from './editor-sheet';
import { TrustedUi, useTrustedPortalContainer } from '@/components/TrustedUi';
import { InlineStoryComposition, type InlineStoryWiring } from './inline-composition';
import { wireOutline } from './outline-nav';
import { markScrollableTables } from './table-scroll';
import { syncValuesToUrl } from './url-values-sync';

function SelectionPortal({ready}:{ready:(element:HTMLElement | null)=>void}) {
  const portal = useTrustedPortalContainer();
  useLayoutEffect(() => { ready(portal ?? null); return () => ready(null); }, [portal,ready]);
  return null;
}

/** Private, instance-scoped application/runtime endpoint. Never published on window or sent to author frames. */
export interface StoryController {
  readonly nonce: string;
  send(command: unknown): void;
  update(document: StoryDocumentUpdate): void;
  invalidate(datasets: string[]): void;
  subscribe(listener: (event: unknown) => void): () => void;
  getViewportRect(): DOMRect;
  dispose(): void;
}

export interface EditorStoryRuntimeProps {
  data: StoryIslandData;
  transport?: QueryTransport;
  transportFactory?: () => QueryTransport & { dispose(): void };
  authorScript?: string | null;
  /**
   * The document's stylesheet: SERVED already isolated (the reader page —
   * lib/story/prepared-runtime ServedStoryRuntime), or as RAW parts this
   * runtime isolates itself (the offline file; pass `sheetPolicy` with it).
   */
  prepared?: PreparedStoryRuntime | ServedStoryRuntime;
  /**
   * The inline CSS policy, when the host bundles it (./editor-sheet). Absent,
   * it is loaded on demand, the first time a sheet must be isolated here.
   */
  sheetPolicy?: EditorSheetPolicy;
  /**
   * The served version's RAW compiled and authored sheets, fetched on demand —
   * for an editor update that leaves one of them "unchanged" when this page
   * was only ever served the isolated result. A writer's page provides it
   * (components/ArtifactSurface, the editor door); null when unavailable.
   */
  rawSheets?: () => Promise<{ compiledCss: string | null; authorCss: string | null } | null>;
  onController(controller: StoryController | null): void;
  /**
   * One reason that refuses every write on this render (the store's
   * `writesUnavailable`), so a write button says why instead of waiting on an
   * access check nobody will answer. Read when a document lifetime starts.
   * Absent for every served document; an offline file passes its own.
   */
  writesUnavailable?: string | null;
  /** Values whose controls are disabled on this render, with the reason (the store's `frozenValues`). Read when a document lifetime starts. */
  frozenValues?: Readonly<Record<string, string>> | null;
  /**
   * The SQLite wasm's bytes, when the host carries them (the offline file,
   * which can fetch nothing); otherwise the island's URL is used
   * (lib/story-runtime/page-sqlite). Read when a document lifetime starts.
   */
  sqliteWasm?: Uint8Array;
  /** Registry overrides passed to StoryRuntimeApp (its `components`); keep the object stable. */
  components?: Readonly<Record<string, ComponentType<Record<string, unknown>>>>;

}

/**
 * THE DOCUMENT'S SHEET, as this runtime holds it. `served` is an isolated sheet
 * and the style values that go with exactly `served.nodes` — what the server
 * prepared, rendered as it is. `raw` is what a later update brings; `undefined`
 * in it means "the served version's, not held here" (fetched on demand).
 */
interface SheetState {
  theme: string | null;
  served: { css: string; overrides?: StyleOverride[]; nodes: JsxNode[] } | null;
  raw: { base: string | StoryBaseCssRecipe; compiledCss: string | null | undefined; authorCss: string | null | undefined };
}
function initialSheet(prepared: EditorStoryRuntimeProps['prepared'], nodes: JsxNode[]): SheetState {
  if (!prepared) return { theme: null, served: null, raw: { base: '', compiledCss: null, authorCss: null } };
  if (isServedRuntime(prepared)) {
    return {
      theme: prepared.theme ?? null,
      // The payload's sheet — or, should a page have come without it, the served story's own `<style>`.
      served: prepared.data.nodes === nodes ? { css: prepared.css ?? '', overrides: prepared.overrides, nodes } : null,
      raw: { base: prepared.base, compiledCss: undefined, authorCss: undefined },
    };
  }
  return { theme: prepared.theme ?? null, served: null, raw: { base: prepared.baseCss, compiledCss: prepared.compiledCss, authorCss: prepared.authorCss } };
}
/** The sheet after `update`: a prepared version's isolated sheet, or raw parts merged over the last ones. */
function nextSheet(previous: SheetState, update: StoryDocumentUpdate): SheetState {
  const theme = update.theme !== undefined ? update.theme : previous.theme;
  // A prepared version brings its sheet isolated, for exactly its nodes.
  if (update.sheet) return { theme, served: { css: update.sheet.css, overrides: update.sheet.overrides, nodes: update.nodes }, raw: { base: update.sheet.base, compiledCss: undefined, authorCss: undefined } };
  const changesCss = update.compiledCss !== undefined || update.authorCss !== undefined;
  return {
    theme, served: changesCss ? null : previous.served,
    raw: { ...previous.raw, ...(update.compiledCss !== undefined ? { compiledCss: update.compiledCss } : {}), ...(update.authorCss !== undefined ? { authorCss: update.authorCss } : {}) },
  };
}
// eslint-disable-next-line no-restricted-syntax -- one module per page: the policy chunk, once loaded, serves every document
let loadedPolicy: EditorSheetPolicy | null = null;
const loadPolicy = (): Promise<EditorSheetPolicy> => import('./editor-sheet').then((module) => (loadedPolicy = module));

/** Top-level artifact body; only authored Iframe/Helmet code creates sandboxed child realms. */
function EditorStoryRuntimeView(props: EditorStoryRuntimeProps): ReactNode {
  const root = useRef<HTMLDivElement>(null);
  const portal = useRef<HTMLElement | null>(null);
  const selectionReady = useRef<(() => void) | null>(null);
  const [portalReady] = useState(() => (element:HTMLElement | null) => {
    portal.current = element;
    selectionReady.current?.();
  });
  const latest = useRef(props);
  latest.current = props;
  const [current, setCurrent] = useState(props.data);
  const [sheet, setSheetState] = useState<SheetState>(() => initialSheet(props.prepared, props.data.nodes));
  const [policy, setPolicyState] = useState<EditorSheetPolicy | null>(() => props.sheetPolicy ?? loadedPolicy);
  /** Raw parts fetched for the served version, or 'failed' when they cannot be had. */
  const [fetchedRaw, setFetchedRawState] = useState<{ compiledCss: string | null; authorCss: string | null } | 'failed' | null>(null);
  // Mirrors the document lifetime reads synchronously, to decide whether an update can render at once.
  const sheetRef = useRef(sheet);
  const policyRef = useRef(policy);
  const fetchedRawRef = useRef(fetchedRaw);
  const setSheet = (next: SheetState) => { sheetRef.current = next; setSheetState(next); };
  const setPolicy = (next: EditorSheetPolicy) => { policyRef.current = next; setPolicyState(next); };
  const setFetchedRaw = (next: typeof fetchedRaw) => { fetchedRawRef.current = next; setFetchedRawState(next); };
  const createLifetime = () => {
    const transport = latest.current.transportFactory?.() ?? latest.current.transport;
    const { writesUnavailable, frozenValues } = latest.current;
    const data = latest.current.data;
    return { transport, store:createDataflowStore(data.dataflow ?? {flow:EMPTY_COMPILED_DATAFLOW}, {transport, ...(writesUnavailable ? {writesUnavailable} : {}), ...(frozenValues ? {frozenValues} : {}), page: pageEngineFor(data, transport, data.viewer?.id ?? null, latest.current.sqliteWasm ?? data.sqliteWasm)}) };
  };
  const [lifetime, setLifetime] = useState(createLifetime);
  const { store } = lifetime;
  const editRef = useRef<FrameEditSession | null>(null);
  const [, redraw] = useState(0);
  useLayoutEffect(() => {
    // StrictMode replays effects without remounting state. Revoked capabilities
    // stay revoked; replay obtains an entirely new document lifetime instead.
    if (store.disposed) { setLifetime(createLifetime()); return; }
    let disposed = false;
    let documentData = latest.current.data;
    let readerModeOverride: 'light' | 'dark' | null = null;
    let editRequested = false;
    let editLoading = false;
    let annotationLoading = false;
    let selectionLoading = false;
    let annotate: FrameAnnotateSession | null = null;
    let selection: FrameSelectionActions | null = null;
    let selectionFactory: typeof import('./edit/selection-actions').createFrameSelectionActions | null = null;
    let annotationCommand: Parameters<FrameAnnotateSession['update']>[0] | null = null;
    let selectionCommand: Parameters<FrameSelectionActions['update']>[0] | null = null;
    const listeners = new Set<(event: unknown) => void>();
    const nonce = runtimeId();
    const emit = (event: unknown) => { if (!disposed) for (const listener of [...listeners]) listener(event); };
    const channel: RuntimeChannel = { nonce, post: event => queueMicrotask(() => emit(event)), innerHtmlOf: element => element.innerHTML };
    // The lazy module, grant and protected portal may arrive in any order.
    // Keep their latest state in this document lifetime and join only when all
    // three are ready; a missing portal must not silently consume the grant.
    const ensureSelection = () => {
      if (disposed || selection || !selectionFactory || !root.current || !portal.current
        || !selectionCommand || (!selectionCommand.edit && !selectionCommand.annotate)) return;
      selection = selectionFactory({ win: window, root:root.current, portal:portal.current,
        onAction: (action, selected) => emit({type: STORY_SELECTION_ACTION_MESSAGE, nonce, action, selection: selected}) });
      selection.setNodes(documentData.nodes);
      selection.update(selectionCommand);
    };
    selectionReady.current = ensureSelection;
    const render = () => {
      if (disposed) return;
      editRef.current?.setNodes(documentData.nodes);
      annotate?.setNodes(documentData.nodes);
      selection?.setNodes(documentData.nodes);
      setCurrent(documentData);
      redraw(n => n + 1);
    };
    const author = createAuthorScriptSession(store);
    let publicMx = installMx(store);
    let stopOutline = () => {};
    let stopTables = () => {};
    if (root.current) {
      stopOutline = wireOutline(document, root.current);
      stopTables = markScrollableTables(document, root.current);
    }
    const stopValues = syncValuesToUrl(store, () => store.flow, { post: values => emit({ type: STORY_VALUES_MESSAGE, nonce, values }) });
    let pendingUpdates: Promise<void> | null = null;
    const rawKnown = (raw: SheetState['raw']) => (raw.compiledCss !== undefined && raw.authorCss !== undefined) || fetchedRawRef.current !== null;
    const sheetReadyFor = (update: StoryDocumentUpdate): boolean => {
      const next = nextSheet(sheetRef.current, update);
      if (next.served && next.served.nodes === update.nodes) return true;
      return !!policyRef.current && rawKnown(next.raw);
    };
    const prepareSheetFor = async (update: StoryDocumentUpdate): Promise<void> => {
      if (!policyRef.current) {
        const module = latest.current.sheetPolicy ?? await loadPolicy();
        if (!disposed) setPolicy(module);
      }
      const next = nextSheet(sheetRef.current, update);
      if (!rawKnown(next.raw)) {
        const fetchRaw = latest.current.rawSheets;
        const parts = await (fetchRaw ? fetchRaw().catch(() => null) : Promise.resolve(null));
        if (!disposed) setFetchedRaw(parts ?? 'failed');
      }
    };
    const applyUpdate = (update: StoryDocumentUpdate) => {
      // Raw parts fetched for the version this page was served belong to it alone.
      if (update.sheet) setFetchedRaw(null);
      setSheet(nextSheet(sheetRef.current, update));
      if (update.dataflow) { store.replaceFlow(update.dataflow); publicMx = installMx(store); }
      if (update.authorScript !== undefined) author.replace(update.authorScript);
      documentData = { ...documentData, nodes: update.nodes, ...(update.refData ? { refData: { ...documentData.refData, ...update.refData } } : {}), ...(update.colorMode ? { colorMode: update.colorMode } : {}) };
      if (readerModeOverride) documentData.colorMode = readerModeOverride;
      render();
    };
    const controller: StoryController = {
      nonce,
      send(command) {
        if (disposed) return;
        if (isStoryDocumentUpdate(command)) { controller.update(command); return; }
        if (!command || typeof command !== 'object') return;
        const message = command as { type?: string; datasets?: string[]; mode?: 'light'|'dark' };
        if (message.type === STORY_DATA_MESSAGE && Array.isArray(message.datasets)) { controller.invalidate(message.datasets); return; }
        if (message.type === STORY_READER_MODE_MESSAGE && (message.mode === 'light' || message.mode === 'dark')) { readerModeOverride = message.mode; documentData = { ...documentData, colorMode: message.mode }; render(); return; }
        if (!isEditParentMessage(command)) return;
        if (command.type === STORY_EDIT_MODE_MESSAGE) {
          editRequested = command.on;
          if (!command.on) { editRef.current?.dispose(); editRef.current = null; render(); return; }
          if (editRef.current || editLoading) return;
          editLoading = true;
          // Every edit re-isolates the sheet here: have the policy in hand before the first keystroke.
          if (!loadedPolicy) void loadPolicy().then((module) => { if (!disposed) setPolicy(module); }).catch(() => {});
          // Editing is deliberately lazy: readers do not download the editor.
          void import('./edit/session').then(({ createFrameEditSession }) => {
            if (disposed || !editRequested || !root.current) return;
            editRef.current = createFrameEditSession({ win: window, root: root.current, channel, requestRender: render });
            render();
          }).catch(error => { if (!disposed) console.error('Failed to load artifact editor', error); }).finally(() => { editLoading = false; });
          return;
        }
        if (command.type === STORY_ANNOTATIONS_MESSAGE) {
          annotationCommand = command;
          if (annotate) { annotate.update(command); return; }
          if (command.mode === 'off' || annotationLoading) return;
          annotationLoading = true;
          void import('./edit/annotate').then(({ createFrameAnnotateSession }) => {
            if (disposed || !root.current) return;
            annotate = createFrameAnnotateSession({ win: window, root: root.current, channel, isEditing: () => editRequested });
            annotate.setNodes(documentData.nodes);
            if (annotationCommand) annotate.update(annotationCommand);
          }).catch(error => { if (!disposed) console.error('Failed to load artifact annotations', error); }).finally(() => { annotationLoading = false; });
          return;
        }
        if (command.type === STORY_SELECTION_ACTIONS_MESSAGE) {
          selectionCommand = command;
          if (selection) { selection.update(command); return; }
          if (selectionFactory) { ensureSelection(); return; }
          if ((!command.edit && !command.annotate) || selectionLoading) return;
          selectionLoading = true;
          void import('./edit/selection-actions').then(({ createFrameSelectionActions }) => {
            selectionFactory = createFrameSelectionActions;
            ensureSelection();
          }).catch(error => { if (!disposed) console.error('Failed to load artifact selection actions', error); }).finally(() => { selectionLoading = false; });
          return;
        }
        if (command.type === STORY_SELECT_MESSAGE && !editRef.current) annotate?.select(command.path);
        editRef.current?.onParentMessage(command);
      },
      update(update) {
        if (disposed) return;
        // A version this page holds the sheet for renders in this very call, as it always has;
        // one that needs the CSS policy (or the served version's raw sheets) waits for them, in
        // order, and then lands whole — its nodes, its DOM and every session's view together.
        if (!pendingUpdates && sheetReadyFor(update)) { applyUpdate(update); return; }
        const mine: Promise<void> = (pendingUpdates ?? Promise.resolve())
          .then(() => prepareSheetFor(update))
          .catch((error) => { console.error('Failed to prepare the document stylesheet', error); })
          .then(() => { if (!disposed) applyUpdate(update); });
        pendingUpdates = mine;
        void mine.finally(() => { if (pendingUpdates === mine) pendingUpdates = null; });
      },
      invalidate(datasets) { if (!disposed) store.invalidateDatasets(datasets); },
      subscribe(listener) { if (!disposed) listeners.add(listener); return () => { listeners.delete(listener); }; },
      getViewportRect: () => new DOMRect(0, 0, window.innerWidth, window.innerHeight),
      dispose() {
        if (disposed) return;
        disposed = true;
        if (selectionReady.current === ensureSelection) selectionReady.current = null;
        listeners.clear();
        stopValues();
        stopOutline(); stopTables();
        author.dispose();
        editRef.current?.dispose(); editRef.current = null;
        annotate?.dispose(); selection?.dispose();
        if (window.mx === publicMx) delete window.mx;
        store.dispose();
        if (lifetime.transport && 'dispose' in lifetime.transport) (lifetime.transport as QueryTransport & {dispose():void}).dispose();
      },
    };
    latest.current.onController(controller);
    author.replace(latest.current.authorScript ?? null);
    store.start();
    return () => { controller.dispose(); latest.current.onController(null); };
  }, [lifetime]);
  /*
   * WHAT RENDERS: the served sheet for the nodes it was prepared with, as it
   * is — the hydrating first render always — or, once an update has moved
   * past it, the policy applied here to the raw parts. Until the policy chunk
   * (and any raw part the page only ever had isolated) arrives, the last
   * render stands: a live update lands a moment later, never unstyled.
   */
  const raw = sheet.raw;
  const rawComplete = { compiledCss: raw.compiledCss !== undefined ? raw.compiledCss : fetchedRaw && fetchedRaw !== 'failed' ? fetchedRaw.compiledCss : undefined,
    authorCss: raw.authorCss !== undefined ? raw.authorCss : fetchedRaw && fetchedRaw !== 'failed' ? fetchedRaw.authorCss : undefined };
  const servedNow = sheet.served && sheet.served.nodes === current.nodes ? sheet.served : null;
  const lastRender = useRef<{ css: string; nodes: JsxNode[] } | null>(null);
  const rendered = useMemo(() => {
    if (servedNow) return { css: servedNow.css, nodes: applyStyleOverrides(current.nodes, servedNow.overrides) };
    if (!policy) return null;
    if (rawComplete.compiledCss !== undefined && rawComplete.authorCss !== undefined) {
      return policy.isolateStorySheet({ base: raw.base, compiledCss: rawComplete.compiledCss, authorCss: rawComplete.authorCss }, current.nodes);
    }
    // The raw parts cannot be had: keep the sheet this page holds, and put the new nodes under it.
    if (fetchedRaw === 'failed' && lastRender.current) return { css: lastRender.current.css, nodes: policy.isolateAgainst(lastRender.current.css, current.nodes) };
    return null;
  }, [servedNow, current.nodes, policy, raw.base, rawComplete.compiledCss, rawComplete.authorCss, fetchedRaw]);
  const shown = rendered ?? lastRender.current ?? { css: '', nodes: current.nodes };
  lastRender.current = shown;
  const css = shown.css;
  const nodes = shown.nodes;
  useEffect(() => {
    if (rendered) return;
    let alive = true;
    if (!policy) void (props.sheetPolicy ? Promise.resolve(props.sheetPolicy) : loadPolicy()).then((module) => { if (alive) setPolicy(module); })
      .catch((error) => console.error('Failed to load the document stylesheet policy', error));
    if (fetchedRaw === null && (raw.compiledCss === undefined || raw.authorCss === undefined)) {
      const fetchRaw = latest.current.rawSheets;
      void (fetchRaw ? fetchRaw() : Promise.resolve(null)).then((parts) => { if (alive) setFetchedRaw(parts ?? 'failed'); }, () => { if (alive) setFetchedRaw('failed'); });
    }
    return () => { alive = false; };
  }, [rendered, policy, fetchedRaw, raw.compiledCss, raw.authorCss]);
  const wiring: InlineStoryWiring = { store, importAsset: lifetime.transport?.importAsset, editDecorate: editRef.current?.decorate, editChildren: editRef.current?.decorateChildren,
    onSlideRename: editRef.current ? (path,title) => editRef.current?.renameSlide(path,title) : undefined, components: props.components };
  const composition = <InlineStoryComposition data={{ ...current, nodes }} css={css} wiring={wiring} />;
  const selectionLayer = <TrustedUi overlay layer="selection"><SelectionPortal ready={portalReady} /></TrustedUi>;
  return <>{selectionLayer}<div ref={root} data-mx-inline-story="" data-mx-story-root="" data-theme={sheet.theme ?? undefined} className={current.colorMode}>
    {composition}
  </div></>;
}

// Comment chrome rerenders after a relation-only write. Controller updates
// bring real document changes; stable parent props must leave draft DOM alone.
export const EditorStoryRuntime = memo(EditorStoryRuntimeView);
