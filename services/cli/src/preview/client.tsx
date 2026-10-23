/* @jsxImportSource solid-js */
/**
 * THE PREVIEW'S OWN CHROME — Solid, over the compiled document already on the page (server-rendered;
 * this script never draws the document itself). Capture (`?capture=1`) mounts nothing: the page is
 * already export-ready by the time this loads (session.ts bakes its rows and the attribute server-side).
 *
 * Editing and comments reuse production's own machinery, unchanged:
 *  - `createFrameEditSession` (framework-free) + `mountCompiledEditRegions` (Solid) attach WYSIWYG
 *    prose/grid editing directly onto the compiled DOM's `data-mx-ast` nodes;
 *  - `createFrameSelectionActions` / `createFrameAnnotateSession` (framework-free) drive the
 *    selection bubble and the pin overlay solid/document/AnnotationLayer expects;
 *  - `AnnotationLayer` (Solid, solid/document) is the SAME inline-comments UI the hosted app's Solid
 *    document page mounts, over a local `ArtifactBackend` (backend.ts) instead of the HTTP one, and
 *    `SelectionActions` grants the selection bubble exactly as that page does (solid/pages/Document.tsx);
 *  - while editing, the bubble stands down and `StoryFormatToolbar` (the hosted editor's own toolbar, here in its
 *    bar layout) and `createCommentShortcut` (⌘⌥M) are how a comment starts on what the editor has selected — the
 *    same composer, the same `commentSelection`, and the draft left exactly as it is (a comment never saves it).
 * `edit-controller.ts`'s `createPreviewEditController` is the missing piece all of this needs: a
 * `StoryController` for the compiled DOM (docs/phase2-architecture.md's gap, PR #219's own
 * solid-routes.ts comment — "widen once a Solid controller-establishing mount exists").
 */
import {createEffect, createSignal, Show, onCleanup, onMount} from 'solid-js';
import {render} from 'solid-js/web';
import {createInPlaceEdit,trustedPortalOf,TrustedUi,configureTrustedUiStyles,createDocumentViewport,PageBar,DocumentTitle,DocumentCommentAction,DocumentEditAction,EditorToolbar,EditorViewTabs,EditorSourcePanel,SourceEditorPane,AnnotationLayer,SelectionActions,StoryFormatToolbar,createCommentShortcut,Button,parseJsx,splitHelmet,removeJsxNodeAtPath,bodyPathToSourcePath,STORY_DOCUMENT_MESSAGE,STORY_ROOT_ID,type StoryController,type StoryEditSelection} from '../../../app/lib/cli-toolkit/browser';
import Code from 'lucide-solid/icons/code';
import Paintbrush from 'lucide-solid/icons/paintbrush';
import {createPreviewBackend} from './backend';
import {createPreviewEditController} from './edit-controller';
import type {PreviewDocument} from './types';

const capture = new URLSearchParams(location.search).get('capture') === '1';
const file = decodeURIComponent(location.pathname.slice('/workspace/'.length));

class RequestError extends Error {constructor(message: string, readonly status: number) {super(message);}}
async function api(path: string, body?: unknown): Promise<unknown> {
 const response = await fetch(path, body ? {method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify(body)} : {});
 const value = await response.json();
 if (!response.ok) throw new RequestError((value as {error?: string}).error ?? `${response.status}`, response.status);
 return value;
}

const TOP_OFFSET = 44;

export function Toolbar(props: {initial: PreviewDocument}) {
 const [status, setStatus] = createSignal('Ready');
 const [editing, setEditing] = createSignal(false);
 const [source, setSourceView] = createSignal(false);
 const [nonce, setNonce] = createSignal<string | null>(null);
 const [document_, setDocument] = createSignal<PreviewDocument>(props.initial);
 const [commentCount, setCommentCount] = createSignal(0);
 const [railOpen, setRailOpen] = createSignal(false);
 /** Words picked with the selection bubble's comment action: the composer opens on exactly them. */
 const [commentSelection, setCommentSelection] = createSignal<StoryEditSelection | null>(null);
 /** An open composer or a typed reply: the page waits to follow its file until there is nothing to lose. */
 const [drafting, setDrafting] = createSignal(false);
 /** The last save overlapped a newer change: the draft stays, and the bar offers the ways out. */
 const [conflict, setConflict] = createSignal(false);
 /** The block the bubble's edit action asked for, selected once the in-place editor is ready. */
 const [editTarget, setEditTarget] = createSignal<string | null>(null);
 let revision = props.initial.revision;
 const sourceRef = {current: props.initial.body};
 const dirty = {current: false};
 const runtimeRef: {current: StoryController | null} = {current: null};

 const adopt = (next: PreviewDocument) => {
  revision = next.revision; sourceRef.current = next.body; setDocument(next);
  runtimeRef.current?.update({type: STORY_DOCUMENT_MESSAGE, nodes: next.data.nodes});
 };
 const backend = createPreviewBackend(file, adopt);

 createDocumentViewport({barHeight:() => TOP_OFFSET,editing,commentsOpen:railOpen});
 onMount(() => {

  const root = document.getElementById(STORY_ROOT_ID);
  if (!root) {setStatus('No document root found'); return;}
  const portal = trustedPortalOf(document);
  if (!portal) {setStatus('No protected selection portal found');return;}
  const controller = createPreviewEditController({
   win: window, root, file, initialNodes: props.initial.data.nodes, sourceRef, portal,
   isSourceEditing: source,
   onStatus: message => setStatus(message),
  });
  runtimeRef.current = controller;
  setNonce(controller.nonce);
  controller.selectionReady();
  onCleanup(() => controller.dispose());

  const poll = window.setInterval(() => {
   if (editing() || dirty.current || drafting()) return;
   void api('/document?file=' + encodeURIComponent(file)).then(next => {
    if ((next as PreviewDocument).revision !== revision) location.reload();
   }).catch(error => setStatus(String(error)));
  }, 1500);
  onCleanup(() => window.clearInterval(poll));

  const unload = (event: BeforeUnloadEvent) => {if (dirty.current) {event.preventDefault(); event.returnValue = '';}};
  window.addEventListener('beforeunload', unload);
  onCleanup(() => window.removeEventListener('beforeunload', unload));
 });

 /** Push an edited full source at the live document (a structural draft recompile), same for prose and raw text. */
 const editSource = (next: string, shouldRender = true) => {
  dirty.current = true; sourceRef.current = next; setStatus('Unsaved');
  if (!shouldRender) return;
  const parsed = parseJsx(next);
  if (parsed.ok) runtimeRef.current?.update({type: STORY_DOCUMENT_MESSAGE, nodes: splitHelmet(parsed.nodes).body, source: next});
 };
 const edit = createInPlaceEdit({
  get editing() {return editing() && !source();},
  get sessionNonce() {return nonce();},
  runtimeRef, sourceRef,
  onError: message => setStatus(message),
  onSourceEdited: editSource,
  onCommentKey: () => {commentOnSelection();},
 });
 const commentOnSelection = createCommentShortcut({selection: () => editing() && !source() ? edit.selection() : null, onComment: setCommentSelection});
 /** The toolbar's Delete: the selected block leaves the draft source, as in the hosted editor. */
 const deleteSelected = () => {
  const selected = edit.selection(); if (!selected) return;
  editSource(removeJsxNodeAtPath(sourceRef.current, bodyPathToSourcePath(sourceRef.current, selected.path)));
  edit.select(null);
 };
 const formatShown = () => editing() && !source() && !!edit.selection();

 /**
  * Save the draft against the revision it was made from: the server merges it onto any newer version of the file
  * (another tab, an agent) unless both changed the same part. Then it answers 409, the draft stays exactly where it
  * is, and pressing Done again retries. `over` names a newer revision to save over — only by the user's choice.
  */
 const finish = async (over?: string) => {
  try {
   // Raw source already lives in sourceRef; the hidden in-place editor owns no pending typing.
   if (!source()) await edit.commitPending(true);
   await api('/save', {file, revision: over ?? revision, body: sourceRef.current});
   dirty.current = false;
   // A fresh compiled render, not a morph: leaving edit mode tears down the prose/grid mount
   // (createFrameEditSession's unmountCompiledDom), and only a real reload is guaranteed to put
   // the compiled static markup back exactly as the server would serve it for the saved file.
   location.reload();
  } catch (error) {
   setConflict(error instanceof RequestError && error.status === 409);
   setStatus(error instanceof Error ? error.message : String(error));
  }
 };
 /** The overlap's two ways out: keep the newer file (the draft is dropped), or save the draft over it (the newer file stays in local history). */
 const discardDraft = () => {dirty.current = false; location.reload();};
 const saveOver = async () => {
  try {await finish(((await api('/document?file=' + encodeURIComponent(file))) as PreviewDocument).revision);}
  catch (error) {setStatus(error instanceof Error ? error.message : String(error));}
 };

 // Entering the prose editor loads its compiled mount asynchronously. A commit sent
 // before mx:edit-ready has no receiver, so Code/Done must wait for that actual contract.
 const openingEditor = () => editing() && !source() && !edit.ready();
 createEffect(() => {
  const path = editTarget();
  if (path === null || !editing() || source() || !edit.ready()) return;
  setEditTarget(null); edit.select(path);
 });
 const [sourceVersion, setSourceVersion] = createSignal(0);
 const [sourceDraft, setSourceDraft] = createSignal('');
 const openSource = async () => {
  try {
   // Collect the last in-place keystrokes before disabling that controller and capturing the code buffer.
   if (editing() && !source()) await edit.commitPending(true);
   setSourceDraft(sourceRef.current); setSourceVersion(version => version + 1); setSourceView(true); setEditing(true);
  } catch (error) {
   setStatus(error instanceof Error ? error.message : String(error));
  }
 };

 return <>
  <TrustedUi overlay layer="navigation">
   <div class="fixed inset-x-0 top-0 text-fg"><PageBar mobileTitle={document_().metadata.title ?? file} navigation={<><span class="shrink-0 text-muted">artifactbin</span><DocumentTitle title={document_().metadata.title ?? file}/><span class="text-xs text-muted">Local</span></>} actions={<>
    <DocumentCommentAction count={commentCount()} active={railOpen()} onClick={() => setRailOpen(open => !open)} />
    <DocumentEditAction editing={editing()} disabled={openingEditor()} description={openingEditor() ? 'Opening editor…' : undefined} onMouseDown={event => event.preventDefault()} onClick={() => editing() ? void finish() : setEditing(true)} />
   </>}/></div>
   <Show when={editing()}><EditorToolbar top={TOP_OFFSET}>
    <div class="flex min-w-0 items-center gap-2"><EditorViewTabs tabs={[
     {key:'design',label:'App',aria:'Edit on the page',tip:'edit on the page',icon:<Paintbrush size={12}/>,active:!source(),choose:() => setSourceView(false)},
     {key:'code',label:'Code',aria:'Edit the source',tip:openingEditor()?'Opening editor…':'edit the source',icon:<Code size={12}/>,active:source(),disabled:openingEditor(),choose:() => void openSource()},
    ]}/>
     <Show when={formatShown()}>
      <StoryFormatToolbar layout="toolbar" artifactId={document_().metadata.id ?? undefined} selection={edit.selection()}
       onApply={edit.applyFormat} onApplyLink={edit.applyLink} onApplyInline={edit.applyInline} onMarkdownBlock={edit.applyMarkdownBlock} onMarkdownTable={edit.applyMarkdownTable}
       onSelect={edit.select} onDelete={deleteSelected} onComment={setCommentSelection} backend={{mentionsUnavailable: backend.unavailable('mentions')}} />
     </Show>
    </div>
    <div class="flex min-w-0 items-center gap-2">
     <span role="status" aria-live="polite" class="truncate font-mono text-xs text-muted">{openingEditor() && status() === 'Ready' ? 'Opening editor…' : status()}</span>
     <Show when={conflict()}>
      <Button type="button" variant="ghost" size="sm" aria-label="Discard my draft and show the newer file" onClick={discardDraft}>discard draft</Button>
      <Button type="button" variant="secondary" size="sm" aria-label="Save my draft over the newer change" onClick={() => void saveOver()}>save mine over it</Button>
     </Show>
    </div>
   </EditorToolbar></Show>
   <Show when={source()}><EditorSourcePanel top={TOP_OFFSET+44} commentsOpen={railOpen()}>
    <SourceEditorPane value={sourceDraft()} revision={sourceVersion()} onChange={next => {setSourceDraft(next);editSource(next);}} />
   </EditorSourcePanel></Show>
  </TrustedUi>
  <TrustedUi overlay layer="discussion">
   <Show when={nonce()}>
    <SelectionActions runtimeRef={runtimeRef} nonce={nonce()} canAnnotate={!editing()}
     onAnnotate={setCommentSelection} />
   </Show>
   <AnnotationLayer id={document_().metadata.id ?? 'local-preview'} backend={backend} railOpen={railOpen()} onRailOpenChange={setRailOpen}
    runtimeRef={runtimeRef} sessionNonce={nonce()} showViewComments topOffset={TOP_OFFSET+(editing()?44:0)} pickOnOpen
    initialSelection={commentSelection()} onSelectionConsumed={() => setCommentSelection(null)} onDraftingChange={setDrafting}
    onAnnotationsChange={threads => setCommentCount(threads.filter(thread => thread.status === 'open').length)} />
  </TrustedUi>
 </>;

}

if (!capture) {
 void Promise.all([api('/document?file=' + encodeURIComponent(file)) as Promise<PreviewDocument>, fetch('/bundle/chrome.css').then(async response => { if (!response.ok || !response.headers.get('content-type')?.includes('text/css')) throw new Error('Could not load preview controls stylesheet'); configureTrustedUiStyles(await response.text()); })]).then(([initial]) => {
  const host = document.createElement('div');
  document.body.append(host);
  render(() => <Toolbar initial={initial} />, host);
 }).catch(error => {
  const host = document.createElement('pre');
  host.textContent = error instanceof Error ? error.message : String(error);
  document.body.append(host);
 });
}
