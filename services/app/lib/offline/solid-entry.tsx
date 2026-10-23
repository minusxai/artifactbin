/** @jsxImportSource solid-js */
/** The file's Solid chrome. The compiled story is already in the DOM and boots separately. */
import { createEffect, createSignal, For, onCleanup, onMount, Show } from 'solid-js';
import { render } from 'solid-js/web';
import type { JsxNode } from '@/lib/jsx';
import { ISLANDS_READY_EVENT } from '@/lib/islands/contract';
import { createFileBackend, rebuildArtifactFile, sourceChangedOutside } from './file-backend';
import { OFFLINE_QUERY_REASON, sourceDigest } from './file-format';
import { ARTIFACT_FILE_IDS, readArtifactFileParts, renderArtifactFileHtml, type ArtifactFileParts } from './file-html';
import { clearDraft, readDraft, readName, writeDraft, writeName } from './local-state';
import { saveArtifactFile, suggestedFileName, type SaveHandle } from './save-file';
import { connectPreview, previewServerOrigin } from './preview-connect';
import { unranQueriesOf } from './snapshot-current';
import { projectDocument, sameSourceContent } from './project-document';
import { applyDocumentRootAppearance } from '@/lib/page-styles/document-root';
import { configureTrustedUiStyles } from '@/lib/islands/trusted-ui-styles';
import { TrustedUi } from '@/solid/components/TrustedUi';
import { trustedPortalOf } from '@/lib/islands/trusted-portal';
import { createDocumentViewport } from '@/solid/document/create-document-viewport';
import { PageBar, DocumentTitle, PageControlsBody } from '@/solid/components/PageBar';
import { DocumentAction, DocumentCommentAction } from '@/solid/document/DocumentBarActions';
import { AnnotationLayer } from '@/solid/document/AnnotationLayer';
import { createFileAnnotationController } from './annotation-controller';
import { STORY_DOCUMENT_MESSAGE, type StoryController, READER_READY_ATTR } from '@/lib/story-runtime/contract';
import type { StoryEditSelection } from '@/lib/edit-protocol';
import Save from 'lucide-solid/icons/save';
import Plug from 'lucide-solid/icons/plug';
import Settings from 'lucide-solid/icons/settings';
import { Button } from '@/solid/ui/Button';
import { Drawer } from '@/solid/ui/Drawer';
import { Panel } from '@/solid/ui/Panel';
import { StatusMessage } from '@/solid/ui/StatusMessage';
import { LINK } from '@/solid/ui/ui';
import { ConnectDialog, NameDialog, RestoreDialog } from './chrome-dialogs';

declare const __AFBIN_APP_CSS__: string;
declare global { interface Window { __afbinOfflineReady?: Promise<void>; } }

const NOTHING_TO_SAVE = 'No changes to save';
const CHROME_CSS = 'body{margin:0;padding-top:44px}';

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
 * every document a single island whose `path` names no particular node, PR 202). */
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
  const [changes, setChanges] = createSignal(false);
  const [comments, setComments] = createSignal(false);
  const [threads, setThreads] = createSignal(file().threads);
  const [selected, setSelected] = createSignal<StoryEditSelection | null>(null);
  const [source, setSource] = createSignal(file().source);
  const [controls, setControls] = createSignal(false);
  const [chromeHeight, setChromeHeight] = createSignal(44);
  const [runtimeNonce, setRuntimeNonce] = createSignal<string | null>(null);
  const runtimeRef: { current: StoryController | null } = { current: null };
  let chromeRoot: HTMLDivElement | undefined;
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
        projectDocument(story, next.island.nodes, projectedSource);
        projectText(story, next.island.nodes);
        showStaleQueries(story, next);
        projectedSource = next.source;
        style.textContent = [next.css.base, next.css.compiled, next.css.author, CHROME_CSS].filter(Boolean).join('\n');
      });
      window.clearTimeout(draftTimer);
      draftTimer = window.setTimeout(() => writeDraft(file(), new Date(), source() !== file().source ? source() : undefined), 800);
    },
  });
  onCleanup(() => window.clearTimeout(draftTimer));
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
  const flushFile = async () => {
    if (props.invalid) throw new Error('Fix the invalid markup in the original file before saving or connecting.');
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
        if (generation === editGeneration && file() === current) {
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
        onOpened: (url) => { setConnecting(false); setConnectedUrl(url); setConnectStatus('Connected. Open the server tab to read and comment.'); },
      });
    } catch (error) { setConnecting(false); setConnectError(error instanceof Error ? error.message : 'Could not open the server.'); }
  };
  // The Drawer owns Escape and the focus trap and hands focus back to its opener; this also covers a browser that does not focus a button on click.
  const closeControls = () => { setControls(false); chromeRoot?.querySelector<HTMLButtonElement>('[aria-label="Open artifact controls"]')?.focus(); };
  const closeConnect = () => { cancelConnect?.(); cancelConnect = null; setConnecting(false); setConnectStatus(''); setConnectDialog(false); };
  createDocumentViewport({ barHeight: chromeHeight, editing: () => false, commentsOpen: comments });
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
    createEffect(() => { saveReceipt(); dirty(); saveError(); queueMicrotask(measure); });
    measure();
    afterReady(() => {
      if (disposed) return;
      const portal = trustedPortalOf(document);
      if (!portal) return;
      const controller = createFileAnnotationController({ root: story, nodes: file().island.nodes, portal, editing: () => false,
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
        <DocumentAction label={saving() ? 'Saving…' : 'Save'} disabled={!dirty() || saving()} description={!dirty() ? NOTHING_TO_SAVE : 'Save comments'} onClick={() => void save()}><Save size={18} stroke-width={1.5} /></DocumentAction>
        <DocumentAction label="Connect to server" onClick={() => setConnectDialog(true)}><Plug size={18} stroke-width={1.5} /></DocumentAction>
        <DocumentAction label="Open artifact controls" active={controls()} onClick={() => setControls(!controls())}><Settings size={18} stroke-width={1.5} /></DocumentAction>
      </>} />
      <Show when={dirty() || saveError() || saveReceipt()}><div class="flex flex-wrap items-center gap-3 border-b border-edge bg-surface px-3 py-1 font-mono text-xs">
        <Show when={dirty()}><span role="status">Unsaved changes</span></Show>
        <Show when={saveError()}><span role="alert">{saveError()}</span></Show>
        <Show when={saveReceipt()}><span role="status">{saveReceipt()}</span></Show>
      </div></Show>
    </div>
    <Show when={controls()}><Drawer label="Artifact controls" role="region" top={chromeHeight()} onClose={closeControls}><div class="font-sans"><PageControlsBody title="Offline copy" onClose={closeControls}>
      <div class="grid gap-3 text-sm">
        <p>Data as of <time dateTime={file().snapshot.at}>{new Date(file().snapshot.at).toLocaleString()}</time></p>
        <Show when={file().liveUrl}><a class={LINK} href={file().liveUrl}>Open live version</a></Show>
        <Button variant="secondary" size="sm" onClick={() => setRenaming(true)}>{name() ? `You: ${name()}` : 'Set your name'}</Button>
        <Button variant="secondary" size="sm" aria-expanded={changes()} onClick={() => setChanges(!changes())}>Changes{file().journal.length ? ` (${file().journal.length})` : ''}</Button>
        <Show when={changes()}><Panel label="Changes in this file" padding="sm" class="max-h-80 overflow-auto text-xs"><For each={file().journal} fallback={<span class="text-muted">No changes in this file yet.</span>}>{(entry) => <div>{entry.by} · {entry.summary}</div>}</For></Panel></Show>
      </div>
    </PageControlsBody></div></Drawer></Show>
    <Show when={connectDialog()}><ConnectDialog address={serverAddress()} onAddress={setServerAddress} connecting={connecting()} status={connectStatus()} error={connectError()} openedUrl={connectedUrl()} onConnect={connect} onClose={closeConnect} /></Show>
    <Show when={props.invalid}><StatusMessage kind="error" class="m-2">The source was changed outside this file and is not valid, so this is the last version that worked. {props.invalid}</StatusMessage></Show>
    <Show when={asking() || renaming()}><NameDialog onAnswer={answerName} /></Show>
    </TrustedUi>
    <TrustedUi overlay layer="discussion"><AnnotationLayer id={file().artifactId ?? 'offline-file'} backend={annotationBackend} railOpen={comments()} onRailOpenChange={setComments} liveAnnotations={threads().filter(thread => thread.status === 'open')} runtimeRef={runtimeRef} sessionNonce={runtimeNonce()} initialSelection={selected()} onSelectionConsumed={() => setSelected(null)} pickOnOpen showViewComments topOffset={chromeHeight()} /></TrustedUi>
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
      const answer = (restoreIt: boolean) => { dispose(); resolve(restoreIt); };
      const dispose = render(() => <TrustedUi overlay layer="modal"><RestoreDialog savedAt={draft.savedAt} onAnswer={answer} /></TrustedUi>, host);
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
    // whose one-tree entry names no particular node (PR 202) — and show why it has no answer.
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
