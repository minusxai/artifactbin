import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import type { StoryDocumentUpdate, StoryEditParentMessage, StoryIslandData } from './contract';
import type { QueryTransport } from './store';
import { createDataflowStore } from './store';
import { EMPTY_DATAFLOW } from '@/lib/story/dataflow';
import { StoryRuntimeApp } from './StoryRuntimeApp';
import { createAuthorScriptSession } from './author-script';
import type { FrameEditSession } from './edit/session';
import type { FrameAnnotateSession } from './edit/annotate';
import type { FrameSelectionActions } from './edit/selection-actions';
import type { RuntimeChannel } from './pristine';
import { STORY_EDIT_MODE_MESSAGE, STORY_ANNOTATIONS_MESSAGE, STORY_SELECTION_ACTIONS_MESSAGE, STORY_SELECTION_ACTION_MESSAGE, STORY_SELECT_MESSAGE, STORY_VALUES_MESSAGE, isEditParentMessage, STORY_DATA_MESSAGE, STORY_READER_MODE_MESSAGE } from './contract';
import { isStoryDocumentUpdate } from './document-update';
import type { PreparedStoryRuntime } from '@/lib/story/prepared-runtime';
import { TrustedUi, useTrustedPortalContainer } from '@/components/TrustedUi';

function SelectionPortal({ready}:{ready:(element:HTMLElement | null)=>void}) {
  const portal = useTrustedPortalContainer();
  useLayoutEffect(() => { ready(portal ?? null); return () => ready(null); }, [portal,ready]);
  return null;
}
import { syncValuesToUrl } from './url-values-sync';

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
  transport: QueryTransport;
  authorScript?: string | null;
  prepared?: PreparedStoryRuntime;
  onController(controller: InlineStoryController | null): void;
}

/** Top-level artifact body; only authored Iframe/Helmet code creates sandboxed child realms. */
export function InlineStoryRuntime(props: InlineStoryRuntimeProps): ReactNode {
  const root = useRef<HTMLDivElement>(null);
  const portal = useRef<HTMLElement | null>(null);
  const [portalReady] = useState(() => (element:HTMLElement | null) => { portal.current = element; });
  const latest = useRef(props);
  latest.current = props;
  const [current, setCurrent] = useState(props.data);
  const [styles, setStyles] = useState<{baseCss:string;compiledCss:string|null;authorCss:string|null;theme:string|null}>({baseCss:props.prepared?.baseCss ?? '', compiledCss:props.prepared?.compiledCss ?? null, authorCss:props.prepared?.authorCss ?? null, theme:props.prepared?.theme ?? null});
  const [store] = useState(() => createDataflowStore(props.data.dataflow ?? { flow: EMPTY_DATAFLOW }, { transport: props.transport }));
  const editRef = useRef<FrameEditSession | null>(null);
  const [, redraw] = useState(0);
  useLayoutEffect(() => {
    let disposed = false;
    let documentData = latest.current.data;
    let editRequested = false;
    let editLoading = false;
    let annotationLoading = false;
    let selectionLoading = false;
    let annotate: FrameAnnotateSession | null = null;
    let selection: FrameSelectionActions | null = null;
    let annotationCommand: Parameters<FrameAnnotateSession['update']>[0] | null = null;
    let selectionCommand: Parameters<FrameSelectionActions['update']>[0] | null = null;
    const listeners = new Set<(event: unknown) => void>();
    const nonce = crypto.randomUUID();
    const emit = (event: unknown) => { if (!disposed) for (const listener of [...listeners]) listener(event); };
    const channel: RuntimeChannel = { nonce, post: emit, innerHtmlOf: element => element.innerHTML };
    const render = () => {
      if (disposed) return;
      editRef.current?.setNodes(documentData.nodes);
      annotate?.setNodes(documentData.nodes);
      selection?.setNodes(documentData.nodes);
      setCurrent(documentData);
      redraw(n => n + 1);
    };
    const author = createAuthorScriptSession(store);
    const stopValues = syncValuesToUrl(store, () => store.flow, { post: values => emit({ type: STORY_VALUES_MESSAGE, nonce, values }) });
    const controller: InlineStoryController = {
      nonce,
      send(command) {
        if (disposed) return;
        if (isStoryDocumentUpdate(command)) { controller.update(command); return; }
        if (!command || typeof command !== 'object') return;
        const message = command as { type?: string; datasets?: string[]; mode?: 'light'|'dark' };
        if (message.type === STORY_DATA_MESSAGE && Array.isArray(message.datasets)) { controller.invalidate(message.datasets); return; }
        if (message.type === STORY_READER_MODE_MESSAGE && (message.mode === 'light' || message.mode === 'dark')) { documentData = { ...documentData, colorMode: message.mode }; render(); return; }
        if (!isEditParentMessage(command)) return;
        if (command.type === STORY_EDIT_MODE_MESSAGE) {
          editRequested = command.on;
          if (!command.on) { editRef.current?.dispose(); editRef.current = null; render(); return; }
          if (editRef.current || editLoading) return;
          editLoading = true;
          // Editing is deliberately lazy: readers do not download the editor.
          void import('./edit/session').then(({ createFrameEditSession }) => {
            if (disposed || !editRequested || !root.current) return;
            editRef.current = createFrameEditSession({ win: window, root: root.current, channel, requestRender: render });
            render();
          }).finally(() => { editLoading = false; });
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
          }).finally(() => { annotationLoading = false; });
          return;
        }
        if (command.type === STORY_SELECTION_ACTIONS_MESSAGE) {
          selectionCommand = command;
          if (selection) { selection.update(command); return; }
          if ((!command.edit && !command.annotate) || selectionLoading) return;
          selectionLoading = true;
          void import('./edit/selection-actions').then(({ createFrameSelectionActions }) => {
            if (disposed || !root.current || !portal.current) return;
            selection = createFrameSelectionActions({ win: window, root:root.current, portal:portal.current, onAction: (action, selected) => emit({ type: STORY_SELECTION_ACTION_MESSAGE, nonce, action, selection: selected }) });
            selection.setNodes(documentData.nodes);
            if (selectionCommand) selection.update(selectionCommand);
          }).finally(() => { selectionLoading = false; });
          return;
        }
        if (command.type === STORY_SELECT_MESSAGE && !editRef.current) annotate?.select(command.path);
        editRef.current?.onParentMessage(command);
      },
      update(update) {
        if (disposed) return;
        setStyles(previous => ({...previous, ...(update.compiledCss !== undefined ? {compiledCss:update.compiledCss} : {}), ...(update.authorCss !== undefined ? {authorCss:update.authorCss} : {}), ...(update.theme !== undefined ? {theme:update.theme} : {})}));
        if (update.dataflow) store.replaceFlow(update.dataflow);
        if (update.authorScript !== undefined) author.replace(update.authorScript);
        documentData = { ...documentData, nodes: update.nodes, ...(update.refData ? { refData: { ...documentData.refData, ...update.refData } } : {}), ...(update.colorMode ? { colorMode: update.colorMode } : {}) };
        render();
      },
      invalidate(datasets) { if (!disposed) store.invalidateDatasets(datasets); },
      subscribe(listener) { if (!disposed) listeners.add(listener); return () => { listeners.delete(listener); }; },
      getViewportRect: () => new DOMRect(0, 0, window.innerWidth, window.innerHeight),
      dispose() {
        if (disposed) return;
        disposed = true;
        listeners.clear();
        stopValues();
        author.dispose();
        editRef.current?.dispose(); editRef.current = null;
        annotate?.dispose(); selection?.dispose();
        store.dispose();
      },
    };
    latest.current.onController(controller);
    author.replace(latest.current.authorScript ?? null);
    store.start();
    return () => { controller.dispose(); latest.current.onController(null); };
  }, [store]);
  return <><TrustedUi overlay><SelectionPortal ready={portalReady} /></TrustedUi><div ref={root} data-mx-inline-story="" data-theme={styles.theme ?? undefined} className={current.colorMode}>
    <style>{[styles.baseCss,styles.compiledCss,styles.authorCss].filter(Boolean).join('\n')}</style>
    <StoryRuntimeApp {...current} store={store} importAsset={props.transport.importAsset} editDecorate={editRef.current?.decorate} />
  </div></>;
}
