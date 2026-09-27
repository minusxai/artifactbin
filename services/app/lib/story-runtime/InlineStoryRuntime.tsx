import { runtimeId } from './runtime-id';
import { installMx } from './mx';
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ComponentType, type ReactNode } from 'react';
import { createRoot, hydrateRoot, type Root } from 'react-dom/client';
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
import type { InlineSheetPolicy } from './inline-sheet';
import { TrustedUi, useTrustedPortalContainer } from '@/components/TrustedUi';
import { InlineStoryComposition, type InlineStoryWiring } from './inline-composition';
import { adoptInitialStory, clearInitialStory, initialDocumentStory, initialStorySheet } from '@/web/initial-story';
import { wireOutline } from './outline-nav';
import { markScrollableTables } from './table-scroll';
import { syncValuesToUrl } from './url-values-sync';
import { kitReadyFor, loadKitFor } from './kit-registry';
// For the page that preloads a document's chunks before its first render (components/ArtifactSurface).
export { loadKitChunks } from './kit-registry';

function SelectionPortal({ready}:{ready:(element:HTMLElement | null)=>void}) {
  const portal = useTrustedPortalContainer();
  useLayoutEffect(() => { ready(portal ?? null); return () => ready(null); }, [portal,ready]);
  return null;
}

/** Private, instance-scoped application/runtime endpoint. Never published on window or sent to author frames. */
export interface InlineStoryController {
  readonly nonce: string;
  send(command: unknown): void;
  update(document: StoryDocumentUpdate): void;
  invalidate(datasets: string[]): void;
  subscribe(listener: (event: unknown) => void): () => void;
  getViewportRect(): DOMRect;
  dispose(): void;
}

export interface InlineStoryRuntimeProps {
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
   * The inline CSS policy, when the host bundles it (./inline-sheet). Absent,
   * it is loaded on demand, the first time a sheet must be isolated here.
   */
  sheetPolicy?: InlineSheetPolicy;
  /**
   * The served version's RAW compiled and authored sheets, fetched on demand —
   * for an editor update that leaves one of them "unchanged" when this page
   * was only ever served the isolated result. A writer's page provides it
   * (components/ArtifactSurface, the editor door); null when unavailable.
   */
  rawSheets?: () => Promise<{ compiledCss: string | null; authorCss: string | null } | null>;
  onController(controller: InlineStoryController | null): void;
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
  /**
   * HYDRATE the server's render of this document (server/app withInitialStory,
   * captured by web/initial-story) instead of drawing it again — the reader
   * page's runtime, whose `data` and `prepared` are the very values the server
   * rendered. Without a waiting server story it renders as usual.
   */
  hydrateInitialStory?: boolean;
}

/**
 * The story root of an ADOPTED server render: the server's element, hydrated
 * by a root of its own (as /raw's document is), which then takes every later
 * render. A render before the hydration commits would make React discard the
 * server tree, so it waits in `next`; `hydrated` settles on that commit.
 */
interface AdoptedStory {
  root: Root;
  committed: boolean;
  next: ReactNode | null;
  /** The last tree handed to the root, so an unchanged render is not handed over twice. */
  shown: ReactNode;
  hydrated: Promise<void>;
  settle(): void;
  /** Set while an unmount waits one microtask, so a StrictMode replay can keep the root. */
  unmounting: boolean;
}

/**
 * Take the waiting server story (web/initial-story) into `host` and hydrate it
 * with `first` — the composition the server rendered, with the same props. A
 * container already emptied (a replayed mount's unmount) is rendered instead.
 */
function adoptStory(server: HTMLElement, host: HTMLElement, first: ReactNode): AdoptedStory {
  adoptInitialStory();
  host.appendChild(server);
  let settle = () => {};
  const hydrated = new Promise<void>((resolve) => { settle = resolve; });
  const hydrate = server.hasChildNodes();
  // React's default error reporting stays: a mismatch is reported, never silently redrawn.
  const root = hydrate ? hydrateRoot(server, first) : createRoot(server);
  if (!hydrate) root.render(first);
  return { root, committed: false, next: null, shown: first, hydrated, settle, unmounting: false };
}

/** Run `task` once the adopted story has committed; at once for a story rendered in place. */
function afterStory(story: AdoptedStory | null, task: () => void): void {
  if (!story || story.committed) task();
  else void story.hydrated.then(task);
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
function initialSheet(prepared: InlineStoryRuntimeProps['prepared'], nodes: JsxNode[]): SheetState {
  if (!prepared) return { theme: null, served: null, raw: { base: '', compiledCss: null, authorCss: null } };
  if (isServedRuntime(prepared)) {
    return {
      theme: prepared.theme ?? null,
      // The payload's sheet — or, should a page have come without it, the served story's own `<style>`.
      served: prepared.data.nodes === nodes ? { css: prepared.css ?? initialStorySheet() ?? '', overrides: prepared.overrides, nodes } : null,
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
let loadedPolicy: InlineSheetPolicy | null = null;
const loadPolicy = (): Promise<InlineSheetPolicy> => import('./inline-sheet').then((module) => (loadedPolicy = module));

/**
 * Top-level artifact body; only authored Iframe/Helmet code creates sandboxed child realms.
 *
 * THE DOCUMENT'S COMPONENTS BEFORE ANYTHING ELSE. The kit is loaded per
 * document (./kit-registry): nothing mounts — no server story is adopted, no
 * hydration starts — until every chunk the document draws is here, so the
 * first client render is the server's, component for component, with no
 * Suspense in the story tree. The reader page loads them before its first
 * render (web/route-pages), and then this renders at once. A download that
 * fails is thrown to the route's boundary, which offers its Retry, exactly as
 * a failed download of this module is.
 */
export function InlineStoryRuntime(props: InlineStoryRuntimeProps): ReactNode {
  const nodes = props.data.nodes;
  const [ready, setReady] = useState(() => kitReadyFor(nodes));
  const [failed, setFailed] = useState<{ error: unknown } | null>(null);
  useEffect(() => {
    if (ready) return;
    let alive = true;
    loadKitFor(nodes).then(() => { if (alive) setReady(true); }, (error: unknown) => { if (alive) setFailed({ error }); });
    return () => { alive = false; };
  }, [ready]);
  if (failed) throw failed.error;
  return ready ? <InlineDocument {...props} /> : null;
}

function InlineDocument(props: InlineStoryRuntimeProps): ReactNode {
  const root = useRef<HTMLDivElement>(null);
  // Read, not taken: the story leaves the server's wrapper when it is adopted, in the layout effect below.
  const [server] = useState(() => (props.hydrateInitialStory ? initialDocumentStory() : null));
  const host = useRef<HTMLDivElement>(null);
  const adopted = useRef<AdoptedStory | null>(null);
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
  const [policy, setPolicyState] = useState<InlineSheetPolicy | null>(() => props.sheetPolicy ?? loadedPolicy);
  /** Raw parts fetched for the served version, or 'failed' when they cannot be had. */
  const [fetchedRaw, setFetchedRawState] = useState<{ compiledCss: string | null; authorCss: string | null } | 'failed' | null>(null);
  // Mirrors the document lifetime reads synchronously, to decide whether an update can render at once.
  const sheetRef = useRef(sheet);
  const policyRef = useRef(policy);
  const fetchedRawRef = useRef(fetchedRaw);
  const setSheet = (next: SheetState) => { sheetRef.current = next; setSheetState(next); };
  const setPolicy = (next: InlineSheetPolicy) => { policyRef.current = next; setPolicyState(next); };
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
  /*
   * ADOPT the server's story: into this component's host, out of the server's
   * wrapper (which leaves with its handoff rule), in one commit — then hydrate
   * it. Declared before the document lifetime below, so the lifetime's wiring
   * sees `root` pointing at the adopted element.
   */
  useLayoutEffect(() => {
    if (!server) return;
    let story = adopted.current;
    // A StrictMode replay finds its root still waiting to unmount, and keeps it.
    if (story?.unmounting) story.unmounting = false;
    else { root.current = server as HTMLDivElement; story = adopted.current = adoptStory(server, host.current!, composition); }
    const kept = story;
    return () => {
      kept.unmounting = true;
      // A root cannot unmount synchronously inside another root's commit.
      queueMicrotask(() => {
        if (!kept.unmounting) return;
        kept.root.unmount();
        if (adopted.current === kept) adopted.current = null;
      });
    };
  }, []);
  useLayoutEffect(() => {
    if (!server) clearInitialStory();
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
    /*
     * Nothing writes into an ADOPTED story before its hydration commits: an
     * attribute set there first (an outline mark, a table's scroll mark, an
     * edit or annotation session's decoration) is a mismatch React leaves in
     * the page. Renders queue on their own (the story render effect below).
     */
    const story = adopted.current;
    const whenStory = <T,>(load: Promise<T>): Promise<T> => story && !story.committed ? Promise.all([load, story.hydrated]).then(([module]) => module) : load;
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
    afterStory(story, () => {
      if (disposed || !root.current) return;
      stopOutline = wireOutline(document,root.current);
      stopTables = markScrollableTables(document,root.current);
    });
    const stopValues = syncValuesToUrl(store, () => store.flow, { post: values => emit({ type: STORY_VALUES_MESSAGE, nonce, values }) });
    let pendingUpdates: Promise<void> | null = null;
    const rawKnown = (raw: SheetState['raw']) => (raw.compiledCss !== undefined && raw.authorCss !== undefined) || fetchedRawRef.current !== null;
    /** A version lands at once when its sheet is in hand and every component it draws is loaded. */
    const readyFor = (update: StoryDocumentUpdate): boolean => kitReadyFor(update.nodes) && sheetReadyFor(update);
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
    const controller: InlineStoryController = {
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
          void whenStory(import('./edit/session')).then(({ createFrameEditSession }) => {
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
          void whenStory(import('./edit/annotate')).then(({ createFrameAnnotateSession }) => {
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
          void whenStory(import('./edit/selection-actions')).then(({ createFrameSelectionActions }) => {
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
        // A version this page holds the sheet and the components for renders in this very call, as
        // it always has; one that needs the CSS policy (or the served version's raw sheets), or a
        // component chunk not loaded yet, waits for them, in order, and then lands whole — its
        // nodes, its DOM and every session's view together.
        if (!pendingUpdates && readyFor(update)) { applyUpdate(update); return; }
        const mine: Promise<void> = (pendingUpdates ?? Promise.resolve())
          .then(() => Promise.all([
            prepareSheetFor(update).catch((error) => { console.error('Failed to prepare the document stylesheet', error); }),
            // The chunks of any component this version draws for the first time, before it renders.
            loadKitFor(update.nodes).catch((error) => { console.error('Failed to load the document\'s components', error); }),
          ]))
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
  // The first commit of an adopted story: renders queued behind hydration go now.
  const [storyCommitted] = useState(() => () => {
    const story = adopted.current;
    if (!story || story.committed) return;
    story.committed = true;
    const next = story.next;
    story.next = null;
    if (next !== null && next !== story.shown) { story.shown = next; story.root.render(next); }
    story.settle();
  });
  const wiring: InlineStoryWiring = { store, importAsset: lifetime.transport?.importAsset, editDecorate: editRef.current?.decorate, editChildren: editRef.current?.decorateChildren,
    onSlideRename: editRef.current ? (path,title) => editRef.current?.renameSlide(path,title) : undefined, components: props.components, ...(server ? { onMounted: storyCommitted } : {}) };
  const composition = <InlineStoryComposition data={{ ...current, nodes }} css={css} wiring={wiring} />;
  // Every later render of an adopted story goes through its own root; the root's container is the server's element, which React does not own.
  useLayoutEffect(() => {
    const story = adopted.current;
    if (!server || !story) return;
    server.className = current.colorMode;
    if (sheet.theme) server.setAttribute('data-theme', sheet.theme); else server.removeAttribute('data-theme');
    if (composition === story.shown) return;
    if (!story.committed) { story.next = composition; return; }
    story.shown = composition;
    story.root.render(composition);
  });
  const selectionLayer = <TrustedUi overlay layer="selection"><SelectionPortal ready={portalReady} /></TrustedUi>;
  if (server) return <>{selectionLayer}<div ref={host} data-mx-story-host="" style={{ display: 'contents' }} /></>;
  return <>{selectionLayer}<div ref={root} data-mx-inline-story="" data-mx-story-root="" data-theme={sheet.theme ?? undefined} className={current.colorMode}>
    {composition}
  </div></>;
}
