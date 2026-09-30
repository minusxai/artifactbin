/** @jsxImportSource solid-js */
/** The file's Solid chrome. The compiled story is already in the DOM and boots separately. */
import { createEffect, createSignal, For, onCleanup, Show, lazy } from 'solid-js';
import { render } from 'solid-js/web';
import type { JsxNode } from '@/lib/jsx';
import { mountCompiledEditRegions, type CompiledEditMount } from '@/solid/editor/dom-mounter';
import { createLiveEditsCore, type LiveEditsCore } from '@/solid/shared/live-edits-core';
import { createFileBackend, rebuildArtifactFile, sourceChangedOutside } from './file-backend';
import { createExtrasLoader, extrasScriptUrl, FORMATTING_OFFLINE, RICH_EDITOR_OFFLINE } from './extras';
import { OFFLINE_ASSET_REASON, OFFLINE_QUERY_REASON, sourceDigest } from './file-format';
import { ARTIFACT_FILE_IDS, readArtifactFileParts, type ArtifactFileParts } from './file-html';
import { clearDraft, readDraft, readName, writeDraft, writeName } from './local-state';
import { saveArtifactFile, suggestedFileName, type SaveHandle } from './save-file';
import { unranQueriesOf } from './snapshot-current';

declare const __AFBIN_APP_CSS__: string;
declare global { interface Window { __afbinOfflineReady?: Promise<void>; } }

const SourceEditor = lazy(() => import('@/solid/editor/SourceEditor'));
const NOTHING_TO_SAVE = 'No changes to save';
const INVALID_SOURCE_EDIT = 'Editing needs a valid source. Fix the markup in the file, then open it again.';
const BUTTON = 'inline-flex h-7 cursor-pointer items-center gap-1 rounded border border-edge px-2 font-sans text-xs text-fg disabled:cursor-default disabled:opacity-50';

function textOf(node: JsxNode): string { return node.type === 'text' ? node.value : node.type === 'element' ? node.children.map(textOf).join('') : ''; }

/** Refresh static text leaves from the backend's canonical source without replacing island roots. */
function projectText(root: HTMLElement, nodes: JsxNode[]): void {
  const walk = (items: JsxNode[], parent = '') => items.forEach((node, index) => {
    if (node.type !== 'element') return;
    const path = parent ? `${parent}.${index}` : String(index);
    if (node.children.length && node.children.every((child) => child.type === 'text')) {
      const element = root.querySelector<HTMLElement>(`[data-mx-ast="${path}"]`);
      if (element && !element.hasAttribute('data-hk')) element.textContent = textOf(node);
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
  if (!document.getElementById(ARTIFACT_FILE_IDS.compiledCode) || document.documentElement.hasAttribute('data-mx-ready')) { work(); return; }
  document.addEventListener('mx:ready', work, { once: true });
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

interface Opened { parts: ArtifactFileParts; invalid: string | null; restored: boolean }

function OfflineShell(props: Opened) {
  const story = document.querySelector<HTMLElement>('[data-mx-inline-story]')!;
  const [file, setFile] = createSignal(props.parts.file);
  const [dirty, setDirty] = createSignal(props.restored);
  const [name, setName] = createSignal(readName());
  const [asking, setAsking] = createSignal(false);
  const [renaming, setRenaming] = createSignal(false);
  const [editing, setEditing] = createSignal(false);
  const [changes, setChanges] = createSignal(false);
  const [comments, setComments] = createSignal(false);
  const [threads, setThreads] = createSignal(file().threads);
  const [selected, setSelected] = createSignal<{ id: string; quote: string } | null>(null);
  const [commenting, setCommenting] = createSignal(false);
  const [commentBody, setCommentBody] = createSignal('');
  const [replies, setReplies] = createSignal<Record<string, string>>({});
  const [sourceMode, setSourceMode] = createSignal(false);
  const [source, setSource] = createSignal(file().source);
  const [formatted, setFormatted] = createSignal(false);
  const [formattedText, setFormattedText] = createSignal('');
  const [sourceRevision, setSourceRevision] = createSignal(0);
  const [insertMenu, setInsertMenu] = createSignal(false);
  const [imageMenu, setImageMenu] = createSignal(false);
  const [dataMenu, setDataMenu] = createSignal(false);
  const [saving, setSaving] = createSignal(false);
  const [saveError, setSaveError] = createSignal('');
  const [editStatus, setEditStatus] = createSignal('');
  const [extrasState, setExtrasState] = createSignal<'idle' | 'loading' | 'ready' | 'failed'>('idle');
  const extras = createExtrasLoader(extrasScriptUrl(file().origin, file().extras), file().extras?.integrity ?? null);
  extras.subscribe(() => setExtrasState(extras.state()));
  let editMount: CompiledEditMount | null = null;
  let live: LiveEditsCore | null = null;
  let saveHandle: SaveHandle | null = null;
  let draftTimer = 0;
  let nameAnswer: (() => void) | null = null;
  const backend = createFileBackend(file(), {
    author: () => name(),
    onChange(next) {
      setFile(next); setSource(next.source); setThreads(next.threads); setDirty(true);
      window.clearTimeout(draftTimer);
      draftTimer = window.setTimeout(() => writeDraft(next), 800);
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
  const queueSource = (next: string) => { setSource(next); live?.queue({ source: next }); };
  const edit = async () => {
    if (editing()) {
      await live?.flushNow(); editMount?.dispose(); editMount = null;
      projectText(story, file().island.nodes); setEditing(false); setSourceMode(false); return;
    }
    await ensureName();
    if (props.invalid) return;
    setEditing(true);
    editMount = mountCompiledEditRegions(story, file().island.nodes, {
      onFlow: (_path, expected, replacement) => {
        const before = source();
        const at = before.indexOf(expected);
        if (at >= 0) queueSource(before.slice(0, at) + replacement + before.slice(at + expected.length));
      },
      onError: setEditStatus,
    });
  };
  const save = async () => {
    setSaving(true); setSaveError('');
    try {
      await live?.flushNow();
      // The compiled module and its served markup are never touched by an edit (only `source`
      // and what derives from it change, file-backend.ts `derive`): save them exactly as
      // downloaded, so a reopen hydrates a pristine, matching pair and projects the edited
      // text onto it afterwards (afterReady), instead of re-hydrating an already-spliced copy.
      const current = file();
      const result = await saveArtifactFile({ ...props.parts, file: current, name: suggestedFileName(current.metadata.title), handle: saveHandle });
      if (result.outcome !== 'cancelled') {
        saveHandle = result.handle; window.clearTimeout(draftTimer); clearDraft(current); setDirty(false);
      }
    } catch (error) { setSaveError(error instanceof Error ? `Could not save: ${error.message}` : 'Could not save this file.'); }
    finally { setSaving(false); }
  };
  const refreshThreads = async () => {
    const open = await backend.listAnnotations('open');
    const resolved = await backend.listAnnotations('resolved');
    setThreads([...open, ...resolved]);
  };
  const createComment = async () => {
    const target = selected();
    if (!target || !commentBody().trim()) return;
    await ensureName();
    await backend.createAnnotation({ node_id: target.id, body: commentBody(), quote: target.quote }, crypto.randomUUID());
    setCommentBody(''); setCommenting(false); setSelected(null); await refreshThreads();
  };
  const markAnnotations = () => {
    for (const element of story.querySelectorAll('[data-mx-annotated]')) element.removeAttribute('data-mx-annotated');
    for (const thread of threads()) {
      const id = thread.anchor?.nodeId;
      if (id) story.querySelector(`#${CSS.escape(id)}`)?.setAttribute('data-mx-annotated', '');
    }
  };
  createEffect(markAnnotations);
  const selectionChanged = () => {
    if (editing() || commenting()) return;
    const selection = window.getSelection();
    if (!selection || selection.isCollapsed || !selection.toString().trim()) { setSelected(null); return; }
    const quote = selection.toString().trim();
    const range = selection.getRangeAt(0);
    const node = [...story.querySelectorAll<HTMLElement>('[id][data-mx-ast]')]
      .filter((candidate) => range.intersectsNode(candidate) && candidate.textContent?.includes(quote))
      .sort((a, b) => (a.textContent?.length ?? Infinity) - (b.textContent?.length ?? Infinity))[0];
    if (!node) return;
    setSelected({ id: node.id, quote });
  };
  document.addEventListener('selectionchange', selectionChanged);
  onCleanup(() => document.removeEventListener('selectionchange', selectionChanged));
  const openSource = () => {
    setSourceMode(true); setFormatted(false);
    void extras.load().catch(() => {});
  };
  const format = () => {
    if (extrasState() !== 'ready') return;
    void import('@/lib/format-jsx-preview').then(({ formatJsxPreview }) => formatJsxPreview(source())).then((result) => { setFormattedText(result); setFormatted(true); });
  };
  const style = document.createElement('style');
  style.textContent = [typeof __AFBIN_APP_CSS__ === 'string' ? __AFBIN_APP_CSS__ : '', file().css.base, file().css.compiled, file().css.author,
    'body{margin:0;padding-top:42px}#afbin-chrome{position:fixed;inset:0 0 auto;z-index:1000;background:var(--surface,#fff);border-bottom:1px solid #aaa} [data-mx-annotated]{outline:2px solid #e8a93a}'].filter(Boolean).join('\n');
  document.head.append(style);
  onCleanup(() => style.remove());
  // Only after the compiled tree hydrates (or immediately when there is none to hydrate): the
  // story DOM served with this file is still the pristine compile hydrate() must match.
  afterReady(() => projectText(story, file().island.nodes));

  return <div id="afbin-chrome">
    <header aria-label="Offline copy" class="flex flex-wrap items-center gap-2 px-4 py-2 text-xs">
      <span>Offline copy of <strong>{file().metadata.title}</strong></span>
      <span>· data as of <time dateTime={file().snapshot.at}>{new Date(file().snapshot.at).toLocaleString()}</time></span>
      <a href={file().liveUrl}>Open live version</a>
      <span class="ml-auto flex items-center gap-2">
        <Show when={dirty()}><span role="status">Unsaved changes</span></Show>
        <Show when={editStatus()}><span role="status">{editStatus()}</span></Show>
        <Show when={saveError()}><span role="alert">{saveError()}</span></Show>
        <button class={BUTTON} onClick={() => setRenaming(true)}>{name() ? `You: ${name()}` : 'Set your name'}</button>
        <button class={BUTTON} aria-expanded={changes()} onClick={() => setChanges(!changes())}>Changes{file().journal.length ? ` (${file().journal.length})` : ''}</button>
        <button class={BUTTON} aria-pressed={comments()} onClick={() => setComments(!comments())}>Comments{threads().filter((t) => t.status === 'open').length ? ` (${threads().filter((t) => t.status === 'open').length})` : ''}</button>
        <button class={BUTTON} aria-pressed={editing()} disabled={!!props.invalid} aria-description={props.invalid ? INVALID_SOURCE_EDIT : undefined} onClick={() => void edit()}>{editing() ? 'Done editing' : 'Edit'}</button>
        <button class={BUTTON} disabled={!dirty() || saving()} aria-description={!dirty() ? NOTHING_TO_SAVE : undefined} onClick={() => void save()}>{saving() ? 'Saving…' : 'Save'}</button>
      </span>
    </header>
    <Show when={props.invalid}><div role="alert" class="bg-red-100 p-2 text-sm">The source was changed outside this file and is not valid, so this is the last version that worked. {props.invalid}</div></Show>
    <Show when={changes()}><section role="region" aria-label="Changes in this file" class="fixed right-3 top-12 z-50 max-h-80 w-80 overflow-auto border bg-white p-3 text-xs"><For each={file().journal}>{(entry) => <div>{entry.by} · {entry.summary}</div>}</For></section></Show>
    <Show when={selected() && !editing()}><div data-mx-selection-actions="" class="fixed left-1/2 top-12 z-40 border bg-white p-2"><button onClick={() => setCommenting(true)}>Comment on selected text</button></div></Show>
    <Show when={commenting()}><div class="fixed right-4 top-14 z-50 border bg-white p-3"><textarea aria-label="Annotation comment" value={commentBody()} onInput={(event) => setCommentBody(event.currentTarget.value)} /><button onClick={() => void createComment()}>Save annotation</button></div></Show>
    <Show when={comments()}><aside class="fixed right-0 top-12 z-40 max-h-[80vh] w-80 overflow-auto border bg-white p-3" aria-label="Comments"><For each={threads()}>{(thread) => <section aria-label={thread.status === 'resolved' ? 'Resolved annotation thread' : 'Annotation thread'} class="mb-3 border-b pb-2"><For each={thread.thread}>{(reply) => <p>{reply.author.label}: {reply.body}</p>}</For><Show when={thread.status === 'open'}><textarea aria-label="Reply to annotation" value={replies()[thread.id] ?? ''} onInput={(event) => setReplies({ ...replies(), [thread.id]: event.currentTarget.value })} /><button onClick={() => void backend.actOnAnnotation(thread.id, { reply: replies()[thread.id] }).then(refreshThreads)}>Send reply</button><button onClick={() => void backend.actOnAnnotation(thread.id, { resolve: true }).then(refreshThreads)}>Resolve annotation</button></Show></section>}</For></aside></Show>
    <Show when={editing()}><div class="fixed inset-x-0 bottom-0 z-30 border-t bg-white p-2 text-sm">
      <span role="tablist" aria-label="Editor view" class="inline-flex gap-2">
        <button role="tab" aria-selected={!sourceMode() && !dataMenu()} onClick={() => { setSourceMode(false); setDataMenu(false); }}>Edit on the page</button>
        <button role="tab" aria-selected={sourceMode()} onClick={openSource}>Edit the source</button>
        <button role="tab" aria-selected={dataMenu()} onClick={() => { setSourceMode(false); setDataMenu(true); }}>Show data</button>
        <button role="tab" disabled aria-description="Version history lives on artifactbin. Open the live version.">History</button>
      </span>{' · '}
      <button onClick={() => setInsertMenu(!insertMenu())}>Insert</button>{' · '}
      <Show when={insertMenu()}><button onClick={() => setImageMenu(true)}>Image…</button></Show>
      <Show when={imageMenu()}><div><input aria-label="Image URL" disabled aria-description={OFFLINE_ASSET_REASON} /><button disabled>Import image from URL</button><button onClick={() => setImageMenu(false)}>Close</button></div></Show>
      <Show when={dataMenu()}><div>shape unavailable — {OFFLINE_QUERY_REASON}</div></Show>
      <Show when={sourceMode()}><div class="h-[45vh] bg-neutral-900 p-2 text-white">
        <button disabled={extrasState() !== 'ready'} aria-description={extrasState() === 'ready' ? undefined : FORMATTING_OFFLINE} onClick={format}>View formatted</button>
        <Show when={extrasState() === 'ready'} fallback={<><textarea aria-label="Markup source" aria-description={RICH_EDITOR_OFFLINE} class="h-2/3 w-full text-black" value={source()} onInput={(event) => queueSource(event.currentTarget.value)} /><p>{RICH_EDITOR_OFFLINE}</p></>}><SourceEditor value={source()} revision={sourceRevision()} onChange={queueSource} /></Show>
        <Show when={formatted()}><div>Formatted preview · read-only</div><SourceEditor value={formattedText()} revision={sourceRevision()} onChange={() => {}} readOnly ariaLabel="Formatted JSX" /></Show>
      </div></Show>
    </div></Show>
    <Show when={asking() || renaming()}><div role="dialog" aria-label="What should we call you?" class="fixed left-1/2 top-1/3 z-[2000] border bg-white p-4"><label>Your name <input aria-label="Your name" id="afbin-name" /></label><button onClick={() => answerName((document.getElementById('afbin-name') as HTMLInputElement).value)}>Save</button><button onClick={() => answerName(null)}>Cancel</button></div></Show>
  </div>;
}

let mountedDispose: (() => void) | null = null;
export function disposeSolidOfflineFile(): void { mountedDispose?.(); mountedDispose = null; }
export async function mountSolidOfflineFile(): Promise<void> {
  disposeSolidOfflineFile();
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
  if (draft) {
    const restore = await new Promise<boolean>((resolve) => {
      const dispose = render(() => <div role="alertdialog" aria-label="Restore unsaved changes" class="fixed left-1/2 top-1/3 z-[2000] border bg-white p-4">
        <p>Restore unsaved changes from {new Date(draft.savedAt).toLocaleString()}?</p>
        <button onClick={() => { dispose(); resolve(true); }}>Restore</button>
        <button onClick={() => { dispose(); resolve(false); }}>Discard</button>
      </div>, host);
    });
    if (restore) opened = { ...rebuilt, file: draft.file, rebuilt: true };
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
  mountedDispose = render(() => <OfflineShell parts={{ ...parts, file: opened.file }} invalid={opened.error} restored={opened.rebuilt} />, host);
  document.getElementById(ARTIFACT_FILE_IDS.boot)?.remove();
}

if (document.getElementById(ARTIFACT_FILE_IDS.code)) {
  window.__afbinOfflineReady = mountSolidOfflineFile().catch((error: unknown) => {
    const status = document.getElementById(ARTIFACT_FILE_IDS.boot);
    if (status) { status.setAttribute('role', 'alert'); status.textContent = error instanceof Error ? error.message : 'This file could not be opened.'; }
    throw error;
  });
}
