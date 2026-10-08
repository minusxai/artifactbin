/** @jsxImportSource solid-js */
/** The file's Solid chrome. The compiled story is already in the DOM and boots separately. */
import { createEffect, createSignal, For, onCleanup, onMount, Show } from 'solid-js';
import { render } from 'solid-js/web';
import type { JsxNode } from '@/lib/jsx';
import { replaceProseRegion } from '@/lib/editor-v2/source-edit';
import { READER_READY_ATTR } from '@/lib/compiled-page/contract';
import { ISLANDS_READY_EVENT } from '@/lib/islands/contract';
import { mountCompiledEditRegions, type CompiledEditMount } from '@/lib/story-runtime/edit/dom-mounter';
import { createLiveEditsCore, type LiveEditsCore } from '@/solid/lib/live-edits-core';
import { createFileBackend, rebuildArtifactFile, sourceChangedOutside } from './file-backend';
import { createExtrasLoader, extrasScriptUrl, FORMATTING_OFFLINE, RICH_EDITOR_OFFLINE } from './extras';
import { OFFLINE_ASSET_REASON, OFFLINE_QUERY_REASON, sourceDigest } from './file-format';
import { ARTIFACT_FILE_IDS, readArtifactFileParts, renderArtifactFileHtml, type ArtifactFileParts } from './file-html';
import { clearDraft, readDraft, readName, writeDraft, writeName } from './local-state';
import { saveArtifactFile, suggestedFileName, type SaveHandle } from './save-file';
import { connectPreview, previewServerOrigin } from './preview-connect';
import { unranQueriesOf } from './snapshot-current';
import { projectDocument, sameSourceContent } from './project-document';
import { applyDocumentRootAppearance } from '@/lib/story/styles/document-root';
import { configureTrustedUiStyles } from '@/lib/serving/trusted-ui-styles';
import { TrustedUi } from '@/solid/components/TrustedUi';
import { trustedPortalOf } from '@/lib/islands/trusted-portal';
import { createDocumentViewport } from '@/solid/document/create-document-viewport';
import { PageBar, DocumentTitle, PageControlsPanel } from '@/solid/components/PageBar';
import { DocumentAction, DocumentCommentAction, DocumentEditAction } from '@/solid/document/DocumentBarActions';
import { AnnotationLayer } from '@/solid/document/AnnotationLayer';
import SourceEditorPane from '@/solid/editor/SourceEditorPane';
import { SourceEditorToolsProvider, type SourceEditorTools } from '@/solid/editor/source-editor-tools';
import { EditorToolbar, EditorViewTabs, EditorSourcePanel } from '@/solid/editor/EditorChrome';
import { createFileAnnotationController } from './annotation-controller';
import { STORY_DOCUMENT_MESSAGE, type StoryController, type StoryEditSelection } from '@/lib/story-runtime/contract';
import Code from 'lucide-solid/icons/code';
import Paintbrush from 'lucide-solid/icons/paintbrush';
import Database from 'lucide-solid/icons/database';
import Save from 'lucide-solid/icons/save';
import Plug from 'lucide-solid/icons/plug';
import History from 'lucide-solid/icons/rotate-ccw-clock';
import Settings from 'lucide-solid/icons/settings';
import { closeOnEscape } from '@/solid/lib/close-on-escape';
import { FORM_INPUT, FORM_PRIMARY_BUTTON, FORM_SECONDARY_BUTTON } from '@/solid/components/FormControls';
import { DialogShell } from '@/solid/components/DialogShell';
import { Tooltip } from '@/solid/components/Tooltip';

declare const __AFBIN_APP_CSS__: string;
declare global { interface Window { __afbinOfflineReady?: Promise<void>; } }

const NOTHING_TO_SAVE = 'No changes to save';
const EDIT_REFUSED = 'This text could not be applied to the current document.';
const INVALID_SOURCE_EDIT = 'Editing needs a valid source. Fix the markup in the file, then open it again.';
const CHROME_CSS = 'body{margin:0;padding-top:44px}';
const BUTTON = FORM_SECONDARY_BUTTON;

function textOf(node: JsxNode): string { return node.type === 'text' ? node.value : node.type === 'element' ? node.children.map(textOf).join('') : ''; }

/** Refresh static text leaves from the backend's canonical source without replacing island roots. */
function projectText(root: HTMLElement, nodes: JsxNode[]): void {
  const walk = (items: JsxNode[], parent = '') => items.forEach((node, index) => {
    if (node.type !== 'element') return;
    const path = parent ? `${parent}.${index}` : String(index);
    if (node.children.length && node.children.every((child) => child.type === 'text')) {
      const element = root.querySelector<HTMLElement>(`[data-mx-ast="${path}"]`);
      if (element) element.textContent = textOf(node);
    }
    walk(node.children, path);
  });
  walk(nodes);
}

/**
 * Run `work` once the compiled story has finished hydrating (`boot()`'s `mx:ready`, compiled-boot.ts),
 * or immediately when this file has no compiled module to hydrate (a document with no browser
 * component, or a test fixture with no `#afbin-compiled-code`). Nothing may touch the story DOM
 * before hydration: `hydrate()` matches the SERVED markup against the compiled tree by its
 * structure, and a change made ahead of it (a spliced heading, a blanked query result) desyncs
 * Solid's hydration markers and blanks or corrupts the region (the save → reopen bug this guards).
 */
function afterReady(work: () => void): void {
  if (!document.getElementById(ARTIFACT_FILE_IDS.compiledCode) || document.documentElement.hasAttribute(READER_READY_ATTR)) { work(); return; }
  document.addEventListener(ISLANDS_READY_EVENT, work, { once: true });
}

/** Every element whose value is `$name` for one of `stale`'s names (a Select's `options`, a
 * DataTable/Question/Number's `data`, …), by its `data-mx-ast` path — the query's consumers,
 * found from the source AST rather than the compiled island list (one-tree compilation gives
 * every document a single island whose `path` names no particular node, PR #202). */
export function queryConsumersOf(nodes: JsxNode[], stale: ReadonlySet<string>): string[] {
  if (!stale.size) return [];
  const found: string[] = [];
  const walk = (items: JsxNode[], parent = '') => items.forEach((node, index) => {
    if (node.type !== 'element') return;
    const path = parent ? `${parent}.${index}` : String(index);
    const bound = node.attributes.some((attribute) => {
      const value = attribute.value;
      return value.static && typeof value.json === 'string' && value.json.startsWith('$') && stale.has(value.json.slice(1));
    });
    if (bound) found.push(path);
    walk(node.children, path);
  });
  walk(nodes);
  return found;
}

function showStaleQueries(story: HTMLElement, file: ArtifactFileParts['file']): void {
  const stale = new Set(unranQueriesOf(file));
  if (file.compiledFlowDigest && file.compiledFlowDigest !== sourceDigest(JSON.stringify(file.island.dataflow?.flow ?? null))) {
    for (const query of file.island.dataflow?.flow?.queries ?? []) stale.add(query.name);
  }
  for (const path of queryConsumersOf(file.island.nodes, stale)) {
    const target = story.querySelector<HTMLElement>(`[data-mx-ast="${path}"]`);
    if (target) target.textContent = OFFLINE_QUERY_REASON;
  }
}

interface Opened { parts: ArtifactFileParts; invalid: string | null; restored: boolean; sourceDraft?: string }

function OfflineShell(props: Opened) {
  const story = document.querySelector<HTMLElement>('[data-mx-inline-story]')!;
  const [file, setFile] = createSignal(props.parts.file);
  createEffect(() => applyDocumentRootAppearance(document.documentElement, file().metadata.colorMode, file().metadata.theme));
  const [dirty, setDirty] = createSignal(props.restored);
  const [name, setName] = createSignal(readName());
  const [asking, setAsking] = createSignal(false);
  const [renaming, setRenaming] = createSignal(false);
  const [editing, setEditing] = createSignal(props.sourceDraft !== undefined);
  const [changes, setChanges] = createSignal(false);
  const [comments, setComments] = createSignal(false);
  const [threads, setThreads] = createSignal(file().threads);
  const [selected, setSelected] = createSignal<StoryEditSelection | null>(null);
  const [sourceMode, setSourceMode] = createSignal(props.sourceDraft !== undefined);
  const [source, setSource] = createSignal(props.sourceDraft ?? file().source);
  const [sourceRevision, setSourceRevision] = createSignal(0);
  const [insertMenu, setInsertMenu] = createSignal(false);
  const [imageMenu, setImageMenu] = createSignal(false);
  const [controls, setControls] = createSignal(false);
  const [chromeHeight, setChromeHeight] = createSignal(44);
  const [runtimeNonce, setRuntimeNonce] = createSignal<string | null>(null);
  const runtimeRef: { current: StoryController | null } = { current: null };
  let chromeRoot: HTMLDivElement | undefined;
  let nameInput: HTMLInputElement | undefined;
  const [dataMenu, setDataMenu] = createSignal(false);
  const [saving, setSaving] = createSignal(false);
  const [saveError, setSaveError] = createSignal('');
  const [saveReceipt, setSaveReceipt] = createSignal('');
  const [connecting, setConnecting] = createSignal(false);
  const [connectDialog, setConnectDialog] = createSignal(false);
  const [serverAddress, setServerAddress] = createSignal('http://localhost:7474');
  const [connectStatus, setConnectStatus] = createSignal('');
  const [connectError, setConnectError] = createSignal('');
  const [connectedUrl, setConnectedUrl] = createSignal('');
  let cancelConnect: (() => void) | null = null;
  const [editStatus, setEditStatus] = createSignal('');
  const [extrasState, setExtrasState] = createSignal<'idle' | 'loading' | 'ready' | 'failed'>('idle');
  const extras = createExtrasLoader(extrasScriptUrl(file().origin, file().extras), file().extras?.integrity ?? null);
  extras.subscribe(() => setExtrasState(extras.state()));
  let editMount: CompiledEditMount | null = null;
  let live: LiveEditsCore | null = null;
  let saveHandle: SaveHandle | null = null;
  let editGeneration = 0;
  let draftTimer = 0;
  let projectedSource = file().base.source;
  let nameAnswer: (() => void) | null = null;
  const backend = createFileBackend(file(), {
    author: () => name(),
    onChange(next) {
      editGeneration++;
      const prior = file();
      const pendingSource = source();
      setFile(next);
      if (pendingSource === prior.source || sameSourceContent(pendingSource, next.source)) setSource(next.source);
      setThreads(next.threads); setDirty(true);
      runtimeRef.current?.update({ type: STORY_DOCUMENT_MESSAGE, nodes: next.island.nodes });
      afterReady(() => {
        if (editing() && !sourceMode()) return; // The live prose editor already shows its own structural draft.
        if (sourceMode()) { editMount?.dispose(); editMount = null; }
        projectDocument(story, next.island.nodes, projectedSource);
        if (sourceMode() || !editing()) projectText(story, next.island.nodes);
        showStaleQueries(story, next);
        projectedSource = next.source;
        style.textContent = [next.css.base, next.css.compiled, next.css.author, CHROME_CSS].filter(Boolean).join('\n');
      });
      window.clearTimeout(draftTimer);
      draftTimer = window.setTimeout(() => writeDraft(file(), new Date(), source() !== file().source ? source() : undefined), 800);
    },
  });
  void backend.load().then((head) => {
    if (!head) throw new Error('offline: document is unavailable');
    live = createLiveEditsCore(() => ({
      backend, initialEditId: head.edit_id, initialVersion: head.version,
      initialDocument: head.document, initialSource: head.markup ?? file().source,
      initialMetadata: { title: head.title, theme: head.theme, template: head.template, colorMode: head.colorMode },
      onRemoteDocument: (next) => { setSource(next); setSourceRevision((n) => n + 1); },
    }));
    live.subscribe((state) => setEditStatus(state.status));
    if (props.sourceDraft !== undefined) live.queue({ source: props.sourceDraft });
  });
  onCleanup(() => { editMount?.dispose(); live?.dispose(); window.clearTimeout(draftTimer); });
  const warnOnLeave = (event: BeforeUnloadEvent) => {
    if (!dirty()) return;
    event.preventDefault();
    event.returnValue = '';
  };
  window.addEventListener('beforeunload', warnOnLeave);
  onCleanup(() => window.removeEventListener('beforeunload', warnOnLeave));

  const ensureName = () => name() ? Promise.resolve() : new Promise<void>((resolve) => { nameAnswer = resolve; setAsking(true); });
  const answerName = (picked: string | null) => {
    if (picked?.trim()) { writeName(picked.trim()); setName(picked.trim()); }
    setAsking(false); setRenaming(false); nameAnswer?.(); nameAnswer = null;
  };
  // The shared composer stays transport-independent; portable comment writes ask for a local name.
  const annotationBackend: typeof backend = {
    ...backend,
    async createAnnotation(...args) {
      await ensureName();
      if (!name()) throw new Error('Set your name before saving the comment. Your draft is still here.');
      return backend.createAnnotation(...args);
    },
    async actOnAnnotation(...args) {
      if (args[1].reply !== undefined) {
        await ensureName();
        if (!name()) throw new Error('Set your name before sending the reply. Your draft is still here.');
      }
      return backend.actOnAnnotation(...args);
    },
  };
  const queueSource = (next: string) => { editGeneration++; setSource(next); setDirty(true); live?.queue({ source: next });
    window.clearTimeout(draftTimer);
    draftTimer = window.setTimeout(() => writeDraft(file(), new Date(), source() !== file().source ? source() : undefined), 800);
  };
  // Blur can publish held typing and move the toolbar between mousedown and click.
  // Keep prose focus until the action itself flushes the editor, so the intended button receives its click.
  const keepEditorFocus = (event: MouseEvent) => { if (editing() && event.button === 0) event.preventDefault(); };
  const edit = async () => {
    if (editing()) {
      editMount?.flush();
      await live?.flushNow();
      if (live && !live.isIdle()) return;
      editMount?.dispose(); editMount = null;
      projectDocument(story, file().island.nodes, projectedSource);
      projectText(story, file().island.nodes); showStaleQueries(story, file()); projectedSource = file().source;
      setEditing(false); setSourceMode(false); return;
    }
    await ensureName();
    if (props.invalid || !name()) return;
    setEditing(true);
    editMount = mountCompiledEditRegions(story, file().island.nodes, {
      // The app's own flow-edit kernel: the region at `path`, checked against what the editor last saw, prose only.
      onFlow: (path, expected, replacement) => {
        const before = source();
        const next = replaceProseRegion(before, path, expected, replacement);
        if (next !== before) queueSource(next);
        else if (expected !== replacement) setEditStatus(EDIT_REFUSED);
      },
      onError: setEditStatus,
    });
  };
  const flushFile = async () => {
    if (props.invalid) throw new Error('Fix the invalid markup in the original file before saving or connecting.');
    editMount?.flush();
    await live?.flushNow();
    if (live && !live.isIdle()) throw new Error('Fix the source before saving or connecting. Your unsaved changes are still in the editor.');
    return file();
  };
  const save = async () => {
    if (saving()) return;
    setSaving(true); setSaveError(''); setSaveReceipt('');
    try {
      const current = await flushFile();
      if (!dirty()) return;
      const generation = editGeneration;
      // Preserve the downloaded runtime and matching served markup; the saved source is projected after hydration.
      const result = await saveArtifactFile({ ...props.parts, file: current, name: suggestedFileName(current), handle: saveHandle });
      if (result.outcome !== 'cancelled') {
        saveHandle = result.handle;
        const target = result.handle?.name || suggestedFileName(current);
        setSaveReceipt(result.outcome === 'written'
          ? `Saved to “${target}”. This tab stays on the file you opened. If you chose another location, open that saved file to continue. Later saves in this tab update the selected file.`
          : `Downloaded updated “${target}”. Open the downloaded file to continue. This tab stays on the file you opened.`);
        if (generation === editGeneration && file() === current && (!live || live.isIdle())) {
          window.clearTimeout(draftTimer); clearDraft(current); setDirty(false);
        } else {
          setDirty(true); writeDraft(file(), new Date(), source() !== file().source ? source() : undefined);
        }
      }
    } catch (error) { setSaveError(error instanceof Error ? `Could not save: ${error.message}` : 'Could not save this file.'); }
    finally { setSaving(false); }
  };
  const saveShortcut = (event: KeyboardEvent) => {
    if (!(event.ctrlKey || event.metaKey) || event.altKey || event.shiftKey || event.isComposing || event.key.toLowerCase() !== 's') return;
    event.preventDefault();
    if (!event.repeat) void save();
  };
  document.addEventListener('keydown', saveShortcut, true);
  onCleanup(() => { document.removeEventListener('keydown', saveShortcut, true); cancelConnect?.(); });
  const connect = () => {
    if (connecting()) return;
    setConnectError(''); setConnectedUrl('');
    try {
      const origin = previewServerOrigin(serverAddress());
      setConnecting(true);
      cancelConnect = connectPreview({
        origin,
        prepare: async () => {
          const current = await flushFile();
          return { html: renderArtifactFileHtml({ ...props.parts, file: current }), filename: suggestedFileName(current) };
        },
        onStatus: setConnectStatus,
        onError: (message) => { setConnecting(false); setConnectStatus(''); setConnectError(message); },
        onOpened: (url) => { setConnecting(false); setConnectedUrl(url); setConnectStatus('Connected. Continue editing in the server tab. Your original HTML file is unchanged.'); },
      });
    } catch (error) { setConnecting(false); setConnectError(error instanceof Error ? error.message : 'Could not open the server.'); }
  };
  const openSource = () => { setSourceMode(true); setDataMenu(false); void extras.load().catch(() => {}); };
  const closeControls = () => { setControls(false); chromeRoot?.querySelector<HTMLButtonElement>('[aria-label="Open artifact controls"]')?.focus(); };
  createEffect(() => { if (controls()) onCleanup(closeOnEscape(closeControls)); });
  const sourceTools: SourceEditorTools = {
    editor: () => new Promise((resolve) => {
      const ready = () => { if (extras.state() === 'ready') void import('@/solid/editor/SourceEditor').then(resolve); };
      const unsubscribe = extras.subscribe(ready); onCleanup(unsubscribe); ready();
      void extras.load().catch(() => {});
    }),
    formatter: () => import('@/lib/workspace/format-jsx-preview'),
    get formatterUnavailable() { return extrasState() === 'ready' ? null : FORMATTING_OFFLINE; },
    get editorUnavailable() { return extrasState() === 'failed' ? RICH_EDITOR_OFFLINE : null; },
  };
  createDocumentViewport({ barHeight: chromeHeight, editing, commentsOpen: comments });
  const style = document.createElement('style');
  style.textContent = [file().css.base, file().css.compiled, file().css.author, CHROME_CSS].filter(Boolean).join('\n');
  document.head.append(style);
  onCleanup(() => style.remove());
  // Chrome wraps on narrow windows and grows after a save. Keep the document below its actual height.
  onMount(() => {
    const chrome = chromeRoot;
    if (!chrome) return;
    let disposed = false;
    const measure = () => { if (!disposed) { setChromeHeight(Math.ceil(chrome.getBoundingClientRect().height) || 44); } };
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure);
    observer?.observe(chrome);
    window.addEventListener('resize', measure);
    createEffect(() => { saveReceipt(); dirty(); saveError(); editStatus(); editing(); queueMicrotask(measure); });
    measure();
    afterReady(() => {
      if (disposed) return;
      const portal = trustedPortalOf(document);
      if (!portal) return;
      const controller = createFileAnnotationController({ root: story, nodes: file().island.nodes, portal, editing,
        onComment: (picked) => { void ensureName().then(() => { if (name()) setSelected(picked); }); } });
      runtimeRef.current = controller; setRuntimeNonce(controller.nonce);
    });
    onCleanup(() => { disposed = true; runtimeRef.current?.dispose(); runtimeRef.current = null; observer?.disconnect(); window.removeEventListener('resize', measure); });
  });
  // Only after the compiled tree hydrates (or immediately when there is none to hydrate): the
  // story DOM served with this file is still the pristine compile hydrate() must match.
  afterReady(() => {
    projectDocument(story, file().island.nodes, projectedSource);
    projectText(story, file().island.nodes); showStaleQueries(story, file()); projectedSource = file().source;
  });

  return <>
    <TrustedUi overlay layer="navigation"><div ref={chromeRoot} id="afbin-chrome" class="fixed inset-x-0 top-0 text-fg">
      <PageBar home={file().liveUrl || null} mobileTitle={file().metadata.title} navigation={<><span class="shrink-0 text-muted">artifactbin</span><DocumentTitle title={file().metadata.title} /><span class="shrink-0 text-xs text-muted">Offline</span></>} actions={<>
        <DocumentCommentAction count={threads().filter(thread => thread.status === 'open').length} active={comments()} onClick={() => setComments(!comments())} />
        <DocumentEditAction editing={editing()} disabled={!!props.invalid} description={props.invalid ? INVALID_SOURCE_EDIT : undefined} onMouseDown={keepEditorFocus} onClick={() => void edit()} />
        <DocumentAction label={saving() ? 'Saving…' : 'Save'} disabled={!dirty() || saving()} description={!dirty() ? NOTHING_TO_SAVE : 'Save current edits and comments'} onMouseDown={keepEditorFocus} onClick={() => void save()}><Save size={18} stroke-width={1.5} /></DocumentAction>
        <DocumentAction label="Connect to server" onClick={() => setConnectDialog(true)}><Plug size={18} stroke-width={1.5} /></DocumentAction>
        <DocumentAction label="Open artifact controls" active={controls()} onClick={() => setControls(!controls())}><Settings size={18} stroke-width={1.5} /></DocumentAction>
      </>} />
      <Show when={dirty() || editStatus() || saveError() || saveReceipt()}><div class="flex flex-wrap items-center gap-3 border-b border-edge bg-surface px-3 py-1 font-mono text-xs">
        <Show when={dirty()}><span role="status">Unsaved changes</span></Show>
        <Show when={editStatus()}><span role="status">{editStatus()}</span></Show>
        <Show when={saveError()}><span role="alert">{saveError()}</span></Show>
        <Show when={saveReceipt()}><span role="status">{saveReceipt()}</span></Show>
      </div></Show>
    </div>
    <Show when={controls()}><button type="button" aria-label="Close panel" class="fixed inset-0 z-40 cursor-default border-0 bg-black/25 p-0" onClick={closeControls} /><PageControlsPanel label="Artifact controls" title="Offline copy" onClose={closeControls}>
      <p>Data as of <time dateTime={file().snapshot.at}>{new Date(file().snapshot.at).toLocaleString()}</time></p>
      <Show when={file().liveUrl}><a href={file().liveUrl}>Open live version</a></Show>
      <button class={BUTTON} onClick={() => setRenaming(true)}>{name() ? `You: ${name()}` : 'Set your name'}</button>
      <button class={BUTTON} aria-expanded={changes()} onClick={() => setChanges(!changes())}>Changes{file().journal.length ? ` (${file().journal.length})` : ''}</button>
    </PageControlsPanel></Show>
    <Show when={connectDialog()}><DialogShell onClose={() => { cancelConnect?.(); setConnecting(false); setConnectDialog(false); }}><section role="dialog" aria-label="Connect to server" class="fixed left-1/2 top-16 z-[2000] w-[min(90vw,32rem)] -translate-x-1/2 rounded-lg border border-edge bg-surface p-5 font-mono text-sm shadow-xl space-y-4">
      <p>Connect to a local preview server for a workspace copy, or to hosted artifactbin to update the original. Connecting only sends a copy for review. Nothing is published until you confirm “Apply to original” or “Create independent copy” in the server tab. Your original HTML file stays here.</p>
      <p><a href="https://app.artifactbin.dev/getting-started.md" target="_blank" rel="noopener">Install Node and afbin if needed</a>. If <code>afbin</code> is not installed, run <code>npx --yes @afbin/cli@latest setup</code> once (Windows PowerShell: <code>npx.cmd --yes @afbin/cli@latest setup</code>); it installs the <code>afbin</code> command and the agent skills. Then start a local server:</p>
      <p class="break-words text-xs">macOS / Linux: <code>afbin preview --port 7474</code></p>
      <p class="break-words text-xs">Windows PowerShell: <code>afbin.cmd preview --port 7474</code></p>
      <label class="block space-y-2">Server address <input class={FORM_INPUT} aria-label="Server address" value={serverAddress()} onInput={(event) => setServerAddress(event.currentTarget.value)} disabled={connecting()} /></label>
      <p>Use http://localhost:7474, or the HTTPS address of hosted artifactbin or your compatible server.</p>
      <button class={FORM_PRIMARY_BUTTON} disabled={connecting()} onClick={connect}>{connecting() ? 'Connecting…' : 'Connect'}</button>
      <button class={BUTTON} onClick={() => { cancelConnect?.(); cancelConnect = null; setConnecting(false); setConnectStatus(''); setConnectDialog(false); }}>{connecting() ? 'Cancel connection' : 'Close'}</button>
      <Show when={connectStatus()}><p role="status">{connectStatus()}</p></Show>
      <Show when={connectError()}><p role="alert">{connectError()}</p></Show>
      <Show when={connectedUrl()}><a href={connectedUrl()} target="_blank" rel="noopener">Open server editor</a></Show>
    </section></DialogShell></Show>
    <Show when={props.invalid}><div role="alert" class="bg-red-100 p-2 text-sm">The source was changed outside this file and is not valid, so this is the last version that worked. {props.invalid}</div></Show>
    <Show when={changes()}><section role="region" aria-label="Changes in this file" class="fixed right-3 top-12 z-50 max-h-80 w-80 overflow-auto rounded-lg border border-edge bg-surface p-3 text-xs"><For each={file().journal}>{(entry) => <div>{entry.by} · {entry.summary}</div>}</For></section></Show>
    <Show when={editing()}>
      <EditorToolbar top={chromeHeight()}>
        <div class="flex min-w-0 items-center overflow-x-auto"><EditorViewTabs tabs={[
          { key: 'design', label: 'App', aria: 'Edit on the page', tip: 'edit on the page', icon: <Paintbrush size={12} />, active: !sourceMode() && !dataMenu(), choose: () => { setSourceMode(false); setDataMenu(false); } },
          { key: 'code', label: 'Code', aria: 'Edit the source', tip: 'edit the source', icon: <Code size={12} />, active: sourceMode(), choose: openSource },
          { key: 'data', label: 'Data', aria: 'Show data', tip: 'the document’s snapshots', icon: <Database size={12} />, active: dataMenu(), choose: () => { setSourceMode(false); setDataMenu(true); } },
        ]} /></div>
        <div class="flex items-center gap-2"><Tooltip content="Version history lives on artifactbin. Open the live version."><button type="button" disabled aria-label="History" aria-description="Version history lives on artifactbin. Open the live version." class={BUTTON}><History size={14} /></button></Tooltip><button class={BUTTON} onClick={() => setInsertMenu(!insertMenu())}>Insert</button></div>
      </EditorToolbar>
      <Show when={insertMenu()}><div class="fixed left-3 z-40 rounded border border-edge bg-surface p-3" style={{ top: `${chromeHeight() + 50}px` }}><button class={BUTTON} onClick={() => setImageMenu(true)}>Image…</button></div></Show>
      <Show when={imageMenu()}><div class="fixed left-3 top-32 z-50 rounded border border-edge bg-surface p-3"><input class={FORM_INPUT} aria-label="Image URL" disabled aria-description={OFFLINE_ASSET_REASON} /><button class={FORM_PRIMARY_BUTTON} disabled>Import image from URL</button><button class={BUTTON} onClick={() => setImageMenu(false)}>Close</button></div></Show>
      <Show when={dataMenu()}><aside aria-label="Data" class="fixed inset-x-0 bottom-0 z-20 overflow-auto bg-surface p-4" style={{ top: `${chromeHeight() + 44}px` }}>shape unavailable — {OFFLINE_QUERY_REASON}</aside></Show>
      <Show when={sourceMode()}><EditorSourcePanel top={chromeHeight() + 44} commentsOpen={comments()}><SourceEditorToolsProvider value={sourceTools}><SourceEditorPane value={source()} revision={sourceRevision()} onChange={queueSource} /></SourceEditorToolsProvider></EditorSourcePanel></Show>
    </Show>
    <Show when={asking() || renaming()}><DialogShell onClose={() => answerName(null)}><div role="dialog" aria-label="What should we call you?" class="fixed left-1/2 top-1/3 z-[2000] -translate-x-1/2 rounded-lg border border-edge bg-surface p-5 text-fg shadow-xl space-y-3 w-[min(90vw,24rem)]"><label class="block space-y-2">Your name <input class={FORM_INPUT} ref={nameInput} aria-label="Your name" id="afbin-name" /></label><button class={FORM_PRIMARY_BUTTON} onClick={() => answerName(nameInput?.value ?? '')}>Save</button><button class={BUTTON} onClick={() => answerName(null)}>Cancel</button></div></DialogShell></Show>
    </TrustedUi>
    <TrustedUi overlay layer="discussion"><AnnotationLayer id={file().artifactId ?? 'offline-file'} backend={annotationBackend} railOpen={comments()} onRailOpenChange={setComments} liveAnnotations={threads().filter(thread => thread.status === 'open')} runtimeRef={runtimeRef} sessionNonce={runtimeNonce()} initialSelection={selected()} onSelectionConsumed={() => setSelected(null)} pickOnOpen={!editing()} showViewComments topOffset={chromeHeight() + (editing() ? 44 : 0)} /></TrustedUi>
  </>;
}

let mountedDispose: (() => void) | null = null;
export function disposeSolidOfflineFile(): void { mountedDispose?.(); mountedDispose = null; }
export async function mountSolidOfflineFile(): Promise<void> {
  disposeSolidOfflineFile();
  configureTrustedUiStyles(typeof __AFBIN_APP_CSS__ === 'string' ? __AFBIN_APP_CSS__ : '');
  const openedParts = readArtifactFileParts(document);
  const migrating = openedParts.file.bundle !== 'solid';
  if (migrating && openedParts.file.compiled?.module && !openedParts.compiledCode) {
    throw new Error('This older interactive file needs a fresh export from artifactbin before it can use the Solid editor.');
  }
  const parts = migrating ? { ...openedParts, file: { ...openedParts.file, bundle: 'solid' as const } } : openedParts;
  const rebuilt = sourceChangedOutside(parts.file) ? await rebuildArtifactFile(parts.file, readName()) : { file: parts.file, rebuilt: migrating, error: null };
  const draft = readDraft(parts.file);
  const host = document.createElement('div');
  document.body.insertBefore(host, document.getElementById(ARTIFACT_FILE_IDS.root));
  let opened = rebuilt;
  let sourceDraft: string | undefined;
  if (draft) {
    const restore = await new Promise<boolean>((resolve) => {
      const dispose = render(() => <TrustedUi overlay layer="modal"><DialogShell onClose={() => { dispose(); resolve(false); }}><div role="alertdialog" aria-label="Restore unsaved changes" class="fixed left-1/2 top-1/3 z-[2000] -translate-x-1/2 rounded-lg border border-edge bg-surface p-4 text-fg shadow-xl">
        <p>Restore unsaved changes from {new Date(draft.savedAt).toLocaleString()}?</p>
        <button class={FORM_PRIMARY_BUTTON} onClick={() => { dispose(); resolve(true); }}>Restore</button>
        <button class={BUTTON} onClick={() => { dispose(); resolve(false); }}>Discard</button>
      </div></DialogShell></TrustedUi>, host);
    });
    if (restore) { opened = { ...rebuilt, file: draft.file, rebuilt: true }; sourceDraft = draft.sourceDraft; }
    else clearDraft(parts.file);
  }
  window.__afbinOfflineFile = opened.file;
  const flow = opened.file.island.dataflow?.flow;
  const staleFlow = !!opened.file.compiledFlowDigest && opened.file.compiledFlowDigest !== sourceDigest(JSON.stringify(flow ?? null));
  const stale = new Set(unranQueriesOf(opened.file));
  // A stale flow's shape may have changed altogether (a query added or removed): every query
  // this document declares now reads OFFLINE_QUERY_REASON from the store already
  // (snapshot-current.ts `snapshotStateFor`), so treat them all as changed rather than guess which one moved.
  if (staleFlow) for (const query of flow?.queries ?? []) stale.add(query.name);
  if (stale.size) {
    // Once hydrated (not before: the served story is the pristine compile hydrate() must match),
    // find every element bound to a changed query from the source AST — not `compiled.islands`,
    // whose one-tree entry names no particular node (PR #202) — and show why it has no answer.
    afterReady(() => {
      const story = document.querySelector<HTMLElement>('[data-mx-inline-story]');
      for (const path of queryConsumersOf(opened.file.island.nodes, stale)) {
        const target = story?.querySelector<HTMLElement>(`[data-mx-ast="${path}"]`);
        if (target) target.textContent = OFFLINE_QUERY_REASON;
      }
    });
  }
  mountedDispose = render(() => <OfflineShell parts={{ ...parts, file: opened.file }} invalid={opened.error} restored={opened.rebuilt} sourceDraft={sourceDraft} />, host);
  document.getElementById(ARTIFACT_FILE_IDS.boot)?.remove();
}

if (document.getElementById(ARTIFACT_FILE_IDS.code)) {
  window.__afbinOfflineReady = mountSolidOfflineFile().catch((error: unknown) => {
    const status = document.getElementById(ARTIFACT_FILE_IDS.boot);
    if (status) { status.setAttribute('role', 'alert'); status.textContent = error instanceof Error ? error.message : 'This file could not be opened.'; }
    throw error;
  });
}
