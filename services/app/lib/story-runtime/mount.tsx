import { createElement } from 'react';
import { createRoot, hydrateRoot, type Root } from 'react-dom/client';
import { StoryRuntimeApp } from './StoryRuntimeApp';
import {
  STORY_ADOPT_HOOK, STORY_ADOPTS_MESSAGE, STORY_ANNOTATIONS_MESSAGE, STORY_DATA_HOOK, STORY_DATA_MESSAGE,
  STORY_DOCUMENT_ACK_MESSAGE, STORY_EDIT_MODE_MESSAGE, STORY_HELLO_MESSAGE, STORY_MODE_HOOK, STORY_PAINTED_MESSAGE,
  STORY_READY_EVENT, STORY_SELECTION_ACTION_MESSAGE, STORY_SELECTION_ACTIONS_MESSAGE, STORY_SELECT_MESSAGE,
  STORY_SESSION_MESSAGE, STORY_VALUES_HOOK, STORY_VALUES_MESSAGE, isEditParentMessage,
  type StoryAnnotationsMessage, type StoryDocumentUpdate, type StoryIslandData, type StorySelectionActionsMessage, type StoryValuesMessage,
} from './contract';
import { EMPTY_DATAFLOW } from '@/lib/story/dataflow';
import { createDataflowStore } from './store';
import { createDocumentTransport } from './document-transport';
import { createAuthorScriptSession } from './author-script';
import { installMx } from './mx';
import { applyDocumentChrome, isStoryDocumentUpdate, type StoryOwnedStyles } from './document-update';
import { readerMode } from './reader-mode';
import { syncValuesToUrl } from './url-values-sync';
import { capturePristine } from './pristine';
import type { FrameEditSession } from './edit/session';
import type { FrameAnnotateSession } from './edit/annotate';
import type { FrameSelectionActions } from './edit/selection-actions';

/** Explicit references supplied by trusted app code, never author DOM IDs. */
export interface StoryMountOptions {
  root: HTMLElement;
  data: StoryIslandData;
  renderMode: 'render' | 'hydrate';
  authorScript?: string | null;
  /** Existing frame protocol peer; the first-party shell can be same-window. */
  peer?: Window;
  peerOrigin: string;
}
export interface MountedStory {
  adopt(update: StoryDocumentUpdate): void;
  dispose(): void;
}

const GLOBAL_HOOKS = [STORY_ADOPT_HOOK, STORY_DATA_HOOK, STORY_MODE_HOOK, STORY_VALUES_HOOK] as const;
type GlobalBaseline = {
  theme: string | null; dark: boolean; light: boolean; mx: Window['mx'];
  hooks: Map<string, unknown>;
};
const globalLeases = new WeakMap<Window, {owner: symbol; baseline: GlobalBaseline}>();

/** One lifecycle for the served document entry and SPA artifact routes. */
export function mountStory(_options: StoryMountOptions): MountedStory {
  const options = _options;
  const doc = options.root.ownerDocument;
  const win = doc.defaultView;
  if (!win) throw new Error('mountStory: root has no window');
  const owner = Symbol('mounted-story');
  const inherited = globalLeases.get(win);
  const baseline: GlobalBaseline = inherited?.baseline ?? {
    theme: doc.documentElement.getAttribute('data-theme'),
    dark: doc.documentElement.classList.contains('dark'),
    light: doc.documentElement.classList.contains('light'),
    mx: win.mx,
    hooks: new Map(GLOBAL_HOOKS.map(name => [name, (win as unknown as Record<string, unknown>)[name]])),
  };
  globalLeases.set(win, {owner, baseline});
  let disposed = false;
  let current = options.data;
  let readerOverride = readerMode(win);
  if (readerOverride && readerOverride !== current.colorMode) current = { ...current, colorMode: readerOverride };
  // Hydration takes ownership of the builder's trusted head nodes. A direct
  // app mount starts empty and can never adopt an author-created lookalike.
  const ownedStyles: StoryOwnedStyles = options.renderMode === 'hydrate'
    ? {
      compiled: doc.head.querySelector<HTMLStyleElement>('style[data-mx-tw]'),
      author: doc.head.querySelector<HTMLStyleElement>('style[data-mx-author]'),
    }
    : { compiled: null, author: null };
  const transport = createDocumentTransport(
    win,
    current.queryUrl,
    options.peerOrigin,
    undefined,
    current.mutateUrl,
    options.peer,
  );
  const store = createDataflowStore(current.dataflow ?? { flow: EMPTY_DATAFLOW }, { transport });
  const author = createAuthorScriptSession(store, doc);
  const assetImport = transport?.importAsset ? { importAsset: transport.importAsset } : {};
  installMx(store);
  const renderProps = () => ({ ...current, store, ...assetImport });
  const channel = options.peer ? capturePristine(win, options.peerOrigin, options.peer) : capturePristine(win, options.peerOrigin);
  let reactRoot: Root;
  let ready = false;
  let authorSource = options.authorScript ?? null;
  const runAuthor = () => {
    if (disposed || ready) return;
    ready = true;
    doc.dispatchEvent(new win.Event(STORY_READY_EVENT));
    author.replace(authorSource);
  };
  reactRoot = options.renderMode === 'hydrate'
    ? hydrateRoot(options.root, createElement(StoryRuntimeApp, { ...renderProps(), onMounted: runAuthor }))
    : createRoot(options.root);
  if (options.renderMode === 'render') {
    reactRoot.render(createElement(StoryRuntimeApp, { ...renderProps(), onMounted: runAuthor }));
  }
  const readyTimer = win.setTimeout(runAuthor, 3000);
  if (!channel) store.start();

  const adopt = (update: StoryDocumentUpdate) => {
    if (disposed) return;
    applyDocumentChrome(doc, update, readerOverride, ownedStyles);
    if (update.dataflow) store.replaceFlow(update.dataflow);
    if (update.authorScript !== undefined) {
      authorSource = update.authorScript;
      if (ready) author.replace(authorSource);
    }
    current = {
      ...current,
      nodes: update.nodes,
      ...(update.refData ? { refData: { ...current.refData, ...update.refData } } : {}),
      ...(update.dataflow ? { dataflow: { flow: update.dataflow.flow, state: update.dataflow.state ?? current.dataflow?.state ?? { values: {}, tables: {}, errors: {} } } } : {}),
      ...(update.colorMode && !readerOverride ? { colorMode: update.colorMode } : {}),
    };
    render();
  };

  const hooks = win as unknown as Record<string, unknown>;
  const ownHook = (name: string, value: unknown) => { hooks[name] = value; };
  ownHook(STORY_ADOPT_HOOK, adopt);
  ownHook(STORY_DATA_HOOK, (datasets: string[]) => { if (!disposed) store.invalidateDatasets(datasets); });
  ownHook(STORY_MODE_HOOK, (mode: 'light' | 'dark') => {
    if (disposed) return;
    readerOverride = mode;
    current = { ...current, colorMode: mode };
    render();
  });
  const stopUrl = current.dataflow
    ? syncValuesToUrl(store, () => current.dataflow?.flow ?? EMPTY_DATAFLOW, {
      ...(channel ? { post: (values) => channel.post({ type: STORY_VALUES_MESSAGE, nonce: channel.nonce, values } satisfies StoryValuesMessage) }
        : { hook: (hooks[STORY_VALUES_HOOK] as ((p: Record<string, string | null>) => void) | undefined) ?? null }),
    })
    : () => {};

  let edit: FrameEditSession | null = null;
  let annotate: FrameAnnotateSession | null = null;
  let selection: FrameSelectionActions | null = null;
  let editRequested = false;
  let annotations: StoryAnnotationsMessage | null = null;
  let actions: StorySelectionActionsMessage | null = null;
  const render = () => {
    if (disposed) return;
    edit?.setNodes(current.nodes); annotate?.setNodes(current.nodes); selection?.setNodes(current.nodes);
    reactRoot.render(createElement(StoryRuntimeApp, {
      ...renderProps(),
      ...(edit ? { editDecorate: edit.decorate, onSlideRename: (path: string, title: string) => edit?.renameSlide(path, title) } : {}),
    }));
  };
  let editLoading = false, annotateLoading = false, selectionLoading = false;
  const setEdit = (on: boolean) => {
    if (!channel || disposed) return;
    editRequested = on;
    if (!on) { edit?.dispose(); edit = null; render(); return; }
    if (edit || editLoading) return;
    editLoading = true;
    void import('./edit/session').then(({ createFrameEditSession }) => {
      if (disposed || !editRequested) return;
      edit = createFrameEditSession({ win, channel, requestRender: render }); render();
    }).catch(err => console.error('[story-runtime] edit mode failed to load:', err)).finally(() => { editLoading = false; });
  };
  const setAnnotations = (message: StoryAnnotationsMessage) => {
    if (!channel || disposed) return;
    annotations = message;
    if (annotate) { annotate.update(message); return; }
    if (message.mode === 'off' || annotateLoading) return;
    annotateLoading = true;
    void import('./edit/annotate').then(({ createFrameAnnotateSession }) => {
      if (disposed) return;
      annotate = createFrameAnnotateSession({ win, channel, isEditing: () => editRequested || !!edit });
      annotate.setNodes(current.nodes); if (annotations) annotate.update(annotations);
    }).catch(err => console.error('[story-runtime] annotations failed to load:', err)).finally(() => { annotateLoading = false; });
  };
  const setSelection = (message: StorySelectionActionsMessage) => {
    if (!channel || disposed) return;
    actions = message;
    if (selection) { selection.update(message); return; }
    if ((!message.edit && !message.annotate) || selectionLoading) return;
    selectionLoading = true;
    void import('./edit/selection-actions').then(({ createFrameSelectionActions }) => {
      if (disposed) return;
      selection = createFrameSelectionActions({ win, onAction: (action, selected) => channel.post({ type: STORY_SELECTION_ACTION_MESSAGE, nonce: channel.nonce, action, selection: selected }) });
      selection.setNodes(current.nodes); if (actions) selection.update(actions);
    }).catch(err => console.error('[story-runtime] selection actions failed to load:', err)).finally(() => { selectionLoading = false; });
  };
  const onMessage = (event: MessageEvent) => {
    if (disposed || !event.isTrusted || !channel?.isFromParent(event)) return;
    if (event.data === STORY_HELLO_MESSAGE) { channel.post(STORY_ADOPTS_MESSAGE); store.start(); return; }
    if (isStoryDocumentUpdate(event.data)) { adopt(event.data); channel.post(STORY_DOCUMENT_ACK_MESSAGE); return; }
    if (event.data?.type === STORY_DATA_MESSAGE && Array.isArray(event.data.datasets)) { store.invalidateDatasets(event.data.datasets); return; }
    if (!isEditParentMessage(event.data)) return;
    if (event.data.type === STORY_EDIT_MODE_MESSAGE) return setEdit(event.data.on);
    if (event.data.type === STORY_ANNOTATIONS_MESSAGE) return setAnnotations(event.data);
    if (event.data.type === STORY_SELECTION_ACTIONS_MESSAGE) return setSelection(event.data);
    if (event.data.type === STORY_SELECT_MESSAGE) annotate?.select(event.data.path);
    edit?.onParentMessage(event.data);
  };
  win.addEventListener('message', onMessage);
  const timers: number[] = [];
  if (channel) {
    const announce = () => {
      channel.post({ type: STORY_SESSION_MESSAGE, nonce: channel.nonce });
      channel.post(STORY_ADOPTS_MESSAGE);
      channel.post(STORY_PAINTED_MESSAGE);
    };
    announce(); store.start();
    for (let i = 1; i < 10; i++) timers.push(win.setTimeout(announce, i * 200));
  }

  return {
    adopt,
    dispose() {
      if (disposed) return;
      disposed = true;
      win.clearTimeout(readyTimer);
      stopUrl();
      win.removeEventListener('message', onMessage);
      for (const timer of timers) win.clearTimeout(timer);
      edit?.dispose(); annotate?.dispose(); selection?.dispose();
      ownedStyles.compiled?.remove(); ownedStyles.author?.remove();
      author.dispose();
      store.dispose();
      // Everything observable is released synchronously. Only React's nested
      // root teardown waits until the parent reconciliation has completed.
      queueMicrotask(() => reactRoot.unmount());
      const lease = globalLeases.get(win);
      if (lease?.owner === owner) {
        globalLeases.delete(win);
        if (baseline.theme === null) doc.documentElement.removeAttribute('data-theme');
        else doc.documentElement.setAttribute('data-theme', baseline.theme);
        doc.documentElement.classList.toggle('dark', baseline.dark);
        doc.documentElement.classList.toggle('light', baseline.light);
        win.mx = baseline.mx;
        for (const [name, previous] of baseline.hooks) {
          if (previous === undefined) delete hooks[name]; else hooks[name] = previous;
        }
      }
    },
  };
}
