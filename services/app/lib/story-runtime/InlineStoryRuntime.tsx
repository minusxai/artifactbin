import { runtimeId } from './runtime-id';
import { installMx } from './mx';
import { useLayoutEffect, useMemo, useRef, useState, type ComponentType, type ReactNode } from 'react';
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
import type { PreparedStoryRuntime } from '@/lib/story/prepared-runtime';
import { TrustedUi, useTrustedPortalContainer } from '@/components/TrustedUi';
import { InlineStoryComposition, inlineStoryCss, inlineStoryNodes, type InlineStoryWiring } from './inline-composition';
import { adoptInitialStory, clearInitialStory, initialDocumentStory } from '@/web/initial-story';
import { wireOutline } from './outline-nav';
import { markScrollableTables } from './table-scroll';
import { syncValuesToUrl } from './url-values-sync';

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
  prepared?: PreparedStoryRuntime;
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

/** Top-level artifact body; only authored Iframe/Helmet code creates sandboxed child realms. */
export function InlineStoryRuntime(props: InlineStoryRuntimeProps): ReactNode {
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
  const [styles, setStyles] = useState<{baseCss:string;compiledCss:string|null;authorCss:string|null;theme:string|null}>({baseCss:props.prepared?.baseCss ?? '', compiledCss:props.prepared?.compiledCss ?? null, authorCss:props.prepared?.authorCss ?? null, theme:props.prepared?.theme ?? null});
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
        setStyles(previous => ({...previous, ...(update.compiledCss !== undefined ? {compiledCss:update.compiledCss} : {}), ...(update.authorCss !== undefined ? {authorCss:update.authorCss} : {}), ...(update.theme !== undefined ? {theme:update.theme} : {})}));
        if (update.dataflow) { store.replaceFlow(update.dataflow); publicMx = installMx(store); }
        if (update.authorScript !== undefined) author.replace(update.authorScript);
        documentData = { ...documentData, nodes: update.nodes, ...(update.refData ? { refData: { ...documentData.refData, ...update.refData } } : {}), ...(update.colorMode ? { colorMode: update.colorMode } : {}) };
        if (readerModeOverride) documentData.colorMode = readerModeOverride;
        render();
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
  const css = useMemo(() => inlineStoryCss(styles), [styles.baseCss,styles.compiledCss,styles.authorCss]);
  const nodes = useMemo(() => inlineStoryNodes(current.nodes, styles), [current.nodes,styles.baseCss,styles.compiledCss,styles.authorCss]);
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
    if (styles.theme) server.setAttribute('data-theme', styles.theme); else server.removeAttribute('data-theme');
    if (composition === story.shown) return;
    if (!story.committed) { story.next = composition; return; }
    story.shown = composition;
    story.root.render(composition);
  });
  const selectionLayer = <TrustedUi overlay layer="selection"><SelectionPortal ready={portalReady} /></TrustedUi>;
  if (server) return <>{selectionLayer}<div ref={host} data-mx-story-host="" style={{ display: 'contents' }} /></>;
  return <>{selectionLayer}<div ref={root} data-mx-inline-story="" data-mx-story-root="" data-theme={styles.theme ?? undefined} className={current.colorMode}>
    {composition}
  </div></>;
}
