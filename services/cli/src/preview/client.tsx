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
 *    document page will mount, over a local `ArtifactBackend` (backend.ts) instead of the HTTP one.
 * `edit-controller.ts`'s `createPreviewEditController` is the missing piece all of this needs: a
 * `StoryController` for the compiled DOM (docs/phase2-architecture.md's gap, PR #219's own
 * solid-routes.ts comment — "widen once a Solid controller-establishing mount exists").
 */
import {createSignal, Show, onCleanup, onMount} from 'solid-js';
import {render} from 'solid-js/web';
import {createInPlaceEdit} from '../../../app/solid/editor/create-in-place-edit';
import {trustedPortalOf} from '../../../app/lib/islands/trusted-portal';
import {TrustedUi} from '../../../app/solid/components/TrustedUi';
import {configureTrustedUiStyles} from '../../../app/lib/serving/trusted-ui-styles';
import {createDocumentViewport} from '../../../app/solid/document/create-document-viewport';
import {PageBar,DocumentTitle} from '../../../app/solid/components/PageBar';
import {DocumentCommentAction,DocumentEditAction} from '../../../app/solid/document/DocumentBarActions';
import {EditorToolbar,EditorViewTabs,EditorSourcePanel} from '../../../app/solid/editor/EditorChrome';
import SourceEditorPane from '../../../app/solid/editor/SourceEditorPane';
import Code from 'lucide-solid/icons/code';
import Paintbrush from 'lucide-solid/icons/paintbrush';
import {AnnotationLayer} from '../../../app/solid/document/AnnotationLayer';
import {createPreviewBackend} from './backend';
import {createPreviewEditController} from './edit-controller';
import {parseJsx} from '../../../app/lib/jsx';
import {splitHelmet} from '../../../app/lib/story/document/helmet';
import {STORY_DOCUMENT_MESSAGE, STORY_ROOT_ID, type StoryController} from '../../../app/lib/story-runtime/contract';
import type {PreviewDocument} from './types';

const capture = new URLSearchParams(location.search).get('capture') === '1';
const file = decodeURIComponent(location.pathname.slice('/workspace/'.length));

async function api(path: string, body?: unknown): Promise<unknown> {
 const response = await fetch(path, body ? {method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify(body)} : {});
 const value = await response.json();
 if (!response.ok) throw Error((value as {error?: string}).error ?? `${response.status}`);
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
   if (editing() || dirty.current) return;
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
 });

 const finish = async () => {
  try {
   // Raw source already lives in sourceRef; the hidden in-place editor owns no pending typing.
   if (!source()) await edit.commitPending(true);
   await api('/save', {file, revision, body: sourceRef.current});
   dirty.current = false;
   // A fresh compiled render, not a morph: leaving edit mode tears down the prose/grid mount
   // (createFrameEditSession's unmountCompiledDom), and only a real reload is guaranteed to put
   // the compiled static markup back exactly as the server would serve it for the saved file.
   location.reload();
  } catch (error) {
   setStatus(error instanceof Error ? error.message : String(error));
  }
 };

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
    <DocumentEditAction editing={editing()} onMouseDown={event => event.preventDefault()} onClick={() => editing() ? void finish() : setEditing(true)} />
   </>}/></div>
   <Show when={editing()}><EditorToolbar top={TOP_OFFSET}>
    <div class="flex min-w-0 items-center overflow-x-auto"><EditorViewTabs tabs={[
     {key:'design',label:'App',aria:'Edit on the page',tip:'edit on the page',icon:<Paintbrush size={12}/>,active:!source(),choose:() => setSourceView(false)},
     {key:'code',label:'Code',aria:'Edit the source',tip:'edit the source',icon:<Code size={12}/>,active:source(),choose:() => void openSource()},
    ]}/></div>
    <span role="status" aria-live="polite" class="truncate font-mono text-xs text-muted">{status()}</span>
   </EditorToolbar></Show>
   <Show when={source()}><EditorSourcePanel top={TOP_OFFSET+44} commentsOpen={railOpen()}>
    <SourceEditorPane value={sourceDraft()} revision={sourceVersion()} onChange={next => {setSourceDraft(next);editSource(next);}} />
   </EditorSourcePanel></Show>
  </TrustedUi>
  <TrustedUi overlay layer="discussion"><AnnotationLayer id={document_().metadata.id ?? 'local-preview'} backend={backend} railOpen={railOpen()} onRailOpenChange={setRailOpen}
   runtimeRef={runtimeRef} sessionNonce={nonce()} showViewComments topOffset={TOP_OFFSET+(editing()?44:0)} pickOnOpen
   onAnnotationsChange={threads => setCommentCount(threads.filter(thread => thread.status === 'open').length)} /></TrustedUi>
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
