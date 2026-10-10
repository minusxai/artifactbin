/* @jsxImportSource solid-js */
import { InstallArtifact } from '../document/InstallArtifact';
import { CopyAgentButton } from '../components/CopyAgentButton';
import { createEffect, createMemo, createSignal, lazy, on, onCleanup, onMount, Show, Suspense, untrack, type JSX } from 'solid-js';
import { Portal } from 'solid-js/web';
import { useLocation, useNavigate } from '@solidjs/router';
import { chooseTheme } from '@/lib/story-runtime/reader-mode';
import { rowTitle } from '@/lib/document/display-title';
import { STORY_FRAME_HASH_MESSAGE, STORY_READER_MODE_MESSAGE, type StoryEditSelection } from '@/lib/story-runtime/contract';
import type { DocumentRuntimeRef } from '@/lib/story-runtime/document-endpoint';
import type { ServedStoryRuntime } from '@/lib/publish/prepared/prepared-runtime';
import { createHttpBackend } from '@/lib/artifact-backend/http';
import { loginHref } from '@/lib/http/login-href';
import { takeBootstrap } from '@/solid/lib/bootstrap';
import { adoptServedFrame } from '@/solid/lib/served-frame';
import { reportArtifactView } from '@/solid/lib/artifact-view-report';
import { useSession } from '../lib/session';
import { NotFoundPage } from './NotFound';
import type { AnnotationWire } from '@/lib/annotations/store';
import { ARTIFACT_ID_PATTERN, type ArtifactRole, canAnnotate as canAnnotateRole, canEdit as canEditRole, canGovern, type Visibility } from '@artifactbin/contracts';
import { DocumentActions } from '../document/DocumentActions';
import { CspConsentBar } from '../document/CspConsentBar';
import type { CspRequest } from '@/lib/document';
import { AnnotationLayer } from '../document/AnnotationLayer';
import { SelectionActions } from '../document/SelectionActions';
import { ForkConfirm } from '../document/ForkArtifact';
import { DocumentSharing } from '../document/DocumentSharing';
import { DocumentPeople } from '../document/DocumentPeople';
import { createFramedStory, framedDocumentFor, type FramedStory } from '../document/create-framed-story';
import { answerFrameNavigation } from '../document/frame-navigation';
import { createEditLifecycle, createEditorPartLoader } from '../document/create-edit-lifecycle';
import { moveInto } from '@/lib/islands/island-controller';
import { createLiveArtifact } from '../editor/create-live-artifact';
import { createWideEditViewport, editPanelWidth, readEditPanelCollapsed } from '../editor/create-edit-panel';
import { EditEntryChrome } from '../editor/EditEntryChrome';
import { createIsPhoneViewport } from '../ui/MobileSheet';
import { APP_BAR_H, EDIT_BAR_H, RIGHT_RAIL_W } from '@/lib/story-ui/edit-bar';
import type { EditorArtifact } from '../editor/InPlaceEditor';
import { TrustedUi } from '../components/TrustedUi';
import type { Panel } from '../components/PageChrome';
import { DocumentChrome } from '../document/DocumentChrome';

/** The document's own ground around its frame (a starter shows the app's dotted page instead). */
const DOCUMENT_GROUND = { light: '#ffffff', dark: '#0b0b0c' } as const;

const ArtifactEditor = lazy(() => import('../editor/ArtifactEditor'));
const SocialPreviewEditor = lazy(() => import('../document/SocialPreviewEditor').then((m) => ({ default: m.SocialPreviewEditor })));

interface DocumentAnswer {
  role: ArtifactRole; kind: string;
  surface?: {
    group_id?:string|null;
    id: string; title: string | null; format: string; version: number; editId?: string;
    openAnnotations?: number; accountSession?: boolean; anonSession?: boolean;
    runtime?: ServedStoryRuntime;
    refs?: Array<{ id: string; kind: string; title?: string | null }>;
    template?: string | null; theme?: string | null; colorMode?: 'light' | 'dark' | null;
    heading?: string | null; pwaEnabled?: boolean; membershipAvailable?: boolean;
    visibility?: Visibility; hasInvitedUsers?: boolean;
    author?: { username: string | null; id?: string | null; image?: string | null; forkedFrom?: { label: string; href: string | null } | null } | null;
    /** The document's own origin, which the page frames (lib/serving/artifact-page). */
    framedOrigin?: string;
    /** The reader's standing on a document that writes to datasets (the bar's Join/Joined/Pending pill). */
    membership?: 'join' | 'pending' | 'joined';
  };
  archived?: { version: number; head: number } | null;
  /** What the document asks of the network beyond the default policy, and this reader's standing (lib/trust). */
  cspRequest?: CspRequest;
  like?: { liked: boolean; count: number };
  follow?: { userId: string; following: boolean; count: number } | null;
}

const whenIdle = (task: () => void): (() => void) => {
  const w = window as unknown as { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number; cancelIdleCallback?: (h: number) => void };
  if (w.requestIdleCallback) { const handle = w.requestIdleCallback(task, { timeout: 3000 }); return () => w.cancelIdleCallback?.(handle); }
  const timer = setTimeout(task, 1500);
  return () => clearTimeout(timer);
};

/**
 * The admitted document page: reading for everyone, commenting and editing in place for those who may.
 *
 * THE DOCUMENT IS ITS FRAME (lib/serving/document-frame): the server drew one frame on the document's own origin
 * into this page, and the document runs there — its islands, its script, its own live stream and its doors. This
 * page is the app's: its bar (solid/document/DocumentChrome), the consent slot above the frame, the comments rail,
 * the editor's chrome. Comments, selections, the reader's colour choice and editing reach the document through the
 * bridge (solid/document/create-framed-story); the address's `#hash` goes to its page behaviour. A link to an app path
 * inside the document comes back here and this page follows it (solid/document/frame-navigation). Showing the
 * document is its view (solid/lib/artifact-view-report).
 */
export function DocumentPage(): JSX.Element {
  const location = useLocation();
  const navigate = useNavigate();
  const { session } = useSession();
  const page = takeBootstrap<DocumentAnswer>(location.pathname, 'artifact');
  const rawId = page?.surface?.id ?? /^\/a\/([^/]+)/.exec(location.pathname)?.[1] ?? null;
  const id = rawId && ARTIFACT_ID_PATTERN.test(rawId) ? rawId : null;
  const role = () => page?.role ?? 'viewer';
  const archivedNow = () => !!page?.archived;
  const isOwner = () => canGovern(role()) && !archivedNow();
  const editable = () => canEditRole(role()) && !archivedNow() && page?.surface?.format === 'markup';
  const annotatable = () => canAnnotateRole(role()) && !archivedNow();
  const backend = id ? createHttpBackend(id) : null;
  const [pwaEnabled, setPwaEnabled] = createSignal(page?.surface?.pwaEnabled === true);
  const [ready, setReady] = createSignal(false);
  const [railOpen, setRailOpen] = createSignal(false);
  const [commentNotice, setCommentNotice] = createSignal<string | null>(null);
  const [annotationItems, setAnnotationItems] = createSignal<AnnotationWire[] | null>(null);
  const [liveAnnotations, setLiveAnnotations] = createSignal<AnnotationWire[] | null>(null);
  const openAnnotationCount = () => (annotationItems() ?? liveAnnotations())?.filter((row) => row.status === 'open').length ?? page?.surface?.openAnnotations ?? 0;
  const [panel, setPanel] = createSignal<Panel>(null);
  const [fork, setFork] = createSignal(false);
  const [mode, setMode] = createSignal<'light' | 'dark'>(page?.surface?.colorMode === 'dark' ? 'dark' : 'light');
  /** The editor's bar is on screen (it replaces the entry skeleton). */
  const [editorMounted, setEditorMounted] = createSignal(false);
  const [editorCodeOpen, setEditorCodeOpen] = createSignal(false);
  /** Current editor name, retained until the reader receives the saved document's metadata. */
  const [editorTitle, setEditorTitle] = createSignal<string | null>(null);
  const [editorTitleBaseVersion, setEditorTitleBaseVersion] = createSignal(0);
  const [initialAnnotationSelection, setInitialAnnotationSelection] = createSignal<StoryEditSelection | null>(null);
  const [titleHost, setTitleHost] = createSignal<HTMLElement | null>(null);
  const [commentsHost, setCommentsHost] = createSignal<HTMLElement | null>(null);
  const [editorRightInset, setEditorRightInset] = createSignal(0);
  const [sharingOpen, setSharingOpen] = createSignal(false);
  const [socialPreviewOpen, setSocialPreviewOpen] = createSignal(false);
  const [membershipRevision, setMembershipRevision] = createSignal(0);
  const [nonce, setNonce] = createSignal<string | null>(null);
  const wide = createWideEditViewport();
  const phone = createIsPhoneViewport();
  const runtimeRef: DocumentRuntimeRef = { current: null };
  const editorFlush: { current: (() => Promise<void>) | null } = { current: null };
  let story: FramedStory | null = null;
  /** The document's frame (create-framed-story), once this page has adopted the one the server drew. */
  const [documentFrame, setDocumentFrame] = createSignal<HTMLIFrameElement | null>(null);
  /**
   * The slot ABOVE the frame, in the layout rather than over it: page notices about the document (the
   * CspConsentBar renders here, `<Portal mount={frameSlot()}>`), so the frame shrinks to make room.
   */
  const [frameSlot, setFrameSlot] = createSignal<HTMLElement | null>(null);
  /** The reader chose a colour on this page: a frame that loads again gets it again. */
  let modeChosen = false;
  const framedOrigin = page?.surface?.framedOrigin ?? null;
  const postToFrame = (message: Record<string, unknown>) => {
    const target = documentFrame()?.contentWindow;
    if (target && framedOrigin) target.postMessage(message, framedOrigin);
  };
  const forwardHash = () => {
    const hash = window.location.hash;
    if (hash && hash !== '#edit') postToFrame({ type: STORY_FRAME_HASH_MESSAGE, hash });
  };
  let host!: HTMLDivElement;

  const chooseMode = (next: 'light' | 'dark') => {
    // One reader choice, two surfaces: the app shell (its stored preference) and the document in its frame.
    chooseTheme(next);
    runtimeRef.current?.send({ type: STORY_READER_MODE_MESSAGE, mode: next });
    modeChosen = true;
    setMode(next);
  };

  // ── the editor's door, and the edit mode's one owner (enter → ready → done → restored) ──
  const parts = createEditorPartLoader(id, editable);
  const { part: editorPart, failed: editorPartFailed, load: loadEditorPart } = parts;
  const lifecycle = createEditLifecycle({
    editable,
    pwaChanged: () => pwaEnabled() !== (page?.surface?.pwaEnabled === true),
    controller: () => story?.controller() ?? null,
  });
  const { editing } = lifecycle;
  /** Done was pressed and the page is drawing the saved version to read in place (the slim bar runs). */
  const restoring = () => lifecycle.phase() === 'restoring';
  /** The document is editable (the loading bar ends). */
  const editorReady = () => lifecycle.phase() !== 'entering';
  onCleanup(lifecycle.registerFlush(() => editorFlush.current?.() ?? Promise.resolve()));

  // ── the live document, while reading (the editor holds its own stream while editing) ──
  // The framed document hears its own stream (lib/islands/live on its origin) and draws its own new versions: this
  // one keeps the page's own state — the title, the comments, the membership, the editor's seed — current.
  const live = backend && page?.surface ? createLiveArtifact({
    backend, id: id!, initialEditId: page.surface.editId ?? '', initialVersion: page.surface.version,
    get enabled() { return ready() && !editing() && !archivedNow() && typeof EventSource === 'function'; },
    onData: (event) => { if (event.datasets.includes('_members')) setMembershipRevision((n) => n + 1); },
    onAnnotations: setLiveAnnotations,
    since: page.surface.runtime?.data.dataflow?.results?.since,
  }) : () => null;

  // ── edit mode: a MODE of the one address, mirrored in `#edit` (solid/document/create-edit-lifecycle) ──
  /** Everything the switch into editing downloads, started on idle for a writer and again on the click (both deduplicate). */
  const prefetchEditor = () => {
    void loadEditorPart();
    void import('../editor/ArtifactEditor').catch(() => {});
    void import('@/lib/story-runtime/edit/session').catch(() => {});
    void import('@/lib/story-runtime/edit/dom-mounter').catch(() => {});
  };
  const beginEdit = (selectionPath: string | null) => {
    if (editable() && !editing()) prefetchEditor();
    lifecycle.enter(selectionPath);
  };
  const enterEdit = () => beginEdit(null);
  createEffect(on(lifecycle.phase, (now, before) => {
    if (now === 'entering') {
      setEditorTitle(null);
      setEditorTitleBaseVersion(untrack(live)?.version ?? page?.surface?.version ?? 0);
      void loadEditorPart();
    }
    if (!editing()) setEditorMounted(false);
    // Back to reading in place: the next edit opens on the version just saved, not the part this session opened on.
    if (now === 'reading' && before === 'restoring') { parts.reset(); if (editable()) void loadEditorPart(); }
  }, { defer: true }));
  createEffect(() => { if (page?.surface) document.title = editing() ? `${page.surface.title ?? page.surface.runtime?.title ?? 'Untitled'} [edit mode]` : document.title.replace(/ \[edit mode\]$/, ''); });

  // The edit panel's width comes out of the frame's width: a framed document has no margin to fit in.
  createEffect(() => {
    if (!editing() || !wide()) return;
    setEditorRightInset(editPanelWidth(readEditPanelCollapsed()));
  });
  const readingRail = () => (railOpen() && !phone() ? RIGHT_RAIL_W : 0);
  const railInset = () => (!editing() ? readingRail() : !wide() ? 0 : editorRightInset());
  // The framed document IS the viewport under the bar: the page does not scroll, the frame does. Its top never moves:
  // edit mode's toolbar is drawn OVER the frame, and the document reserves that height itself (`setTopInset`, below),
  // scrolling by it in the same task, so entering or leaving edit mode moves nothing the reader sees.
  createEffect(() => {
    if (!host) return;
    Object.assign(host.style, {
      position: 'fixed', top: `${APP_BAR_H}px`, left: '0px', right: railInset() ? `${railInset()}px` : '0px', bottom: '0px',
      display: 'flex', flexDirection: 'column', background: DOCUMENT_GROUND[mode()], padding: '0px', minHeight: '0px',
    });
  });

  /**
   * The document the editor opens on, decided as edit mode opens (and again if the editor's part arrives after): the
   * newest of the part and the version the live stream delivered — what the frame shows, which its own stream drew.
   * The frame's controller is given the same source (createFramedStory `source`), so the editor and the document it
   * edits agree. Kept after leaving: the way back to reading still compares against it. Live versions arriving
   * during the session are the editor's own stream's to adopt, never a new seed.
   */
  const editorSeed = createMemo<EditorArtifact | undefined>((last) => {
    if (!editing()) return last;
    const surface = page?.surface;
    const part = editorPart();
    if (!surface || !part) return undefined;
    const frame = untrack(live);
    const fresh = frame && frame.version > part.version && typeof frame.source === 'string';
    return {
      document: fresh ? frame!.document ?? part.document : part.document,
      id: surface.id,
      version: fresh ? frame!.version : part.version,
      edit_id: fresh ? frame!.editId : part.editId,
      title: fresh ? frame!.title : surface.title,
      markup: fresh ? frame!.source : part.source,
      theme: (fresh ? frame!.theme : surface.theme) ?? null,
      colorMode: (fresh ? frame!.colorMode : surface.colorMode) ?? null,
      template: (fresh ? frame!.template : surface.template) ?? null,
      refs: surface.refs ?? [],
      compiledCss: part.compiledCss,
      dataflow: surface.runtime?.data.dataflow ? { flow: surface.runtime.data.dataflow.flow, state: surface.runtime.data.dataflow.state } as EditorArtifact['dataflow'] : null,
    };
  });

  const accountSession = () => page?.kind === 'account' || session()?.kind === 'account';
  // This is permission to start the comment flow, not to write a comment:
  // guests get sign-in; only annotatable readers get the composer below.
  const canStartComment = () => !archivedNow() && (annotatable() || !accountSession());
  /** A rail action by name: a press, a carried `?intent=` (after a sign-in), or a pill. */
  const act = (name: string) => {
    if (name === 'controls' || name === 'menu' || name === 'notifications') setPanel(name);
    else if (name === 'comment') {
      if (!annotatable()) {
        if (!accountSession()) window.location.assign(loginHref(window.location, 'comment'));
        else setCommentNotice(archivedNow()
          ? 'Comments are unavailable on archived versions.'
          : 'You have view-only access. Ask the owner for comment access.');
        return;
      }
      setCommentNotice(null);
      setRailOpen((open) => !open);
    } else if (name === 'fork') setFork(true);
    else if (name === 'share') { if (isOwner()) setSharingOpen(true); }
    else if (name === 'membership' || name === 'join') {
      // The bar's Join/Joined/Pending pill: joining needs an account; the people panel is where it happens.
      if (!accountSession()) { window.location.assign(loginHref(window.location, 'join')); return; }
      setPanel('controls');
    } else if (name === 'edit' && editable()) { if (editing()) void lifecycle.done(); else enterEdit(); }
  };

  onMount(() => {
    if (!page || !id) return;
    const served = adoptServedFrame();
    const framed = served ? framedDocumentFor(served, framedOrigin) : null;
    if (!served || !framed) return;
    // The served frame keeps loading where it is: moved, never re-created (moveBefore where the browser has it).
    const slot = document.createElement('div');
    slot.setAttribute('data-mx-frame-slot', '');
    slot.style.flex = '0 0 auto';
    host.appendChild(slot);
    moveInto(host, served);
    Object.assign(served.style, { position: 'relative', inset: 'auto', top: 'auto', flex: '1 1 auto', minHeight: '0px' });
    setFrameSlot(slot);
    setDocumentFrame(framed.frame);
    story = createFramedStory({
      id, framed, nodes: page.surface?.runtime?.data.nodes ?? [],
      editId: () => editorSeed()?.edit_id ?? editorPart()?.editId ?? page.surface?.editId ?? '',
      source: () => editorSeed()?.markup ?? editorPart()?.source ?? null,
      version: live, reading: () => lifecycle.phase() === 'reading',
    });
    // The document's links to app paths take this page (another document by a full load, an app page by the router).
    const stopNavigation = answerFrameNavigation({ win: window, frame: framed.frame, frameOrigin: framed.origin, navigate: (path) => navigate(path) });
    // The document is on screen: one view (a prerendered page counts when it is shown).
    reportArtifactView(window, id);
    const framedStory = story;
    createEffect(() => framedStory.setTopInset(editing() ? EDIT_BAR_H : 0));
    window.addEventListener('hashchange', forwardHash);
    framed.frame.addEventListener('load', forwardHash);
    // The served frame may have loaded before the app did: forward now as well.
    forwardHash();
    runtimeRef.current = story.controller();
    // The frame's controller signs its events once it runs: the nonce arrives then (and again after the frame loads
    // anew, which also takes the reader's colour choice again).
    createEffect(on(() => story?.nonce() ?? null, (next) => {
      setNonce(next);
      if (next && modeChosen) runtimeRef.current?.send({ type: STORY_READER_MODE_MESSAGE, mode: untrack(mode) });
    }));
    setReady(true);
    window.addEventListener('hashchange', lifecycle.sync);
    const address = new URL(window.location.href);
    const carried = address.searchParams.get('intent');
    if (carried) {
      address.searchParams.delete('intent');
      window.history.replaceState(window.history.state, '', address.pathname + address.search + address.hash);
      act(carried);
    }
    lifecycle.sync();
    const stopIdle = editable() ? whenIdle(prefetchEditor) : null;
    onCleanup(() => {
      stopNavigation();
      framed.frame.removeEventListener('load', forwardHash);
      window.removeEventListener('hashchange', forwardHash);
      window.removeEventListener('hashchange', lifecycle.sync);
      stopIdle?.();
      runtimeRef.current = null;
      served.remove();
    });
  });
  const currentVersion = () => page?.archived?.version ?? live()?.version ?? page?.surface?.version ?? 0;
  /**
   * The head the page SHOWS: the newest of the version it loaded, the editor's part and the version the live stream
   * drew in place. Comments, screenshots and their images are made against it — the id the page loaded with is a
   * version the frame may no longer show, and the server refuses an image staged against it.
   */
  const shownEditId = () => {
    const heads = [
      { version: page?.surface?.version ?? 0, editId: page?.surface?.editId },
      { version: editorPart()?.version ?? -1, editId: editorPart()?.editId },
      { version: live()?.version ?? -1, editId: live()?.editId },
    ];
    return heads.reduce((best, head) => (head.editId && head.version > best.version ? head : best), { version: -1, editId: undefined as string | undefined }).editId;
  };
  // The editor owns its stream while editing. Its title signal names every surface until the
  // reading stream catches up; thereafter live metadata wins, including later remote renames.
  const shownTitle = () => {
    const frame = live();
    const title = editorTitle();
    if (title !== null && (editing() || !frame || frame.version <= editorTitleBaseVersion())) {
      return rowTitle({ title });
    }
    return rowTitle(frame ?? page?.surface ?? {});
  };
  createEffect(() => { if (socialPreviewOpen() && !editorPart()) void loadEditorPart(); });
  const sharingContent = () => <div class="mx-auto max-w-3xl space-y-6">
    <DocumentSharing refs={page?.surface?.refs} id={id!} title={shownTitle()} owner={isOwner()} editable variant="embedded" version={currentVersion()} onSocialPreview={() => setSocialPreviewOpen(true)} />
    <Show when={page?.surface?.membershipAvailable}><hr class="border-edge" />
    <DocumentPeople id={id!} initialOpen revision={membershipRevision()} onChange={() => setMembershipRevision((n) => n + 1)} /></Show>
  </div>;
  return <Show when={id && page && page.surface?.framedOrigin} fallback={<NotFoundPage />}>
    <DocumentChrome id={id!} title={shownTitle} author={page!.surface?.author ?? null} follow={page!.follow ?? null}
      like={page!.like ?? { liked: false, count: 0 }} signedIn={accountSession} comments={openAnnotationCount}
      archived={page!.archived ?? null} editing={editing} canEdit={editable()} canFork={!archivedNow()} owner={isOwner()}
      install={pwaEnabled() && !archivedNow()} visibility={page!.surface?.visibility} hasInvitedUsers={page!.surface?.hasInvitedUsers}
      membership={page!.surface?.membership}
      titleSlot={() => editing() && !phone() && editorMounted()} titleHost={setTitleHost}
      panel={panel} setPanel={setPanel} mode={mode} onMode={chooseMode}
      onComment={() => act('comment')} onFork={() => act('fork')} onShare={() => act('share')} onEdit={() => act('edit')} onMembership={() => act('membership')}
      controls={(close) => <DocumentActions groupId={page?.surface?.group_id} pwaEnabled={page?.surface?.pwaEnabled} membershipAvailable={page?.surface?.membershipAvailable} id={id!} title={shownTitle()} version={currentVersion()} archived={archivedNow()}
        owner={isOwner() && !editing()} canEdit={editable() && !editing()} canAnnotate={annotatable()} accountSession={accountSession()}
        like={page?.like ?? { liked: false, count: 0 }} commentsOpen={railOpen()} onCommentsChange={(open) => { close(); setRailOpen(open); }}
        openAnnotations={openAnnotationCount()} forkedFrom={page?.surface?.author?.forkedFrom ?? null} hideFork={!phone()}
        membershipRevision={membershipRevision()} onMembershipChange={() => setMembershipRevision((n) => n + 1)}
        onEdit={() => { close(); enterEdit(); }}
        onShare={() => { close(); setSharingOpen(true); }}
        onDeleted={isOwner() ? () => window.location.assign('/') : undefined} />} />
    <div ref={host} aria-label="Artifact viewport" />
    {/* First in document order: lib/islands/trusted-portal hands its portal to every popover, tooltip and dialog. */}
    <TrustedUi overlay layer="navigation">
      <Show when={editable() && (live()?.template ?? page!.surface?.template) === 'doc' && (!editing() || !editorCodeOpen())}>
        <div class="fixed left-6" style={{ top: `${APP_BAR_H + (editing() ? EDIT_BAR_H : 0) + 12}px` }}><CopyAgentButton id={id!} template="doc" /></div>
      </Show>
      <Show when={page?.surface?.pwaEnabled}><InstallArtifact id={id!} title={page?.surface?.title ?? 'Untitled artifact'} /></Show>
      <Show when={fork() && id}><ForkConfirm id={id!} title={page?.surface?.title ?? 'this artifact'} onClose={() => setFork(false)} /></Show>
    </TrustedUi>
    {/* The document's notice takes its own row above the frame (the frame shrinks), never over it. */}
    <Show when={!!commentNotice() && frameSlot()}>{(slot) => (
      <Portal mount={slot()}><TrustedUi>
        <div class="flex items-center justify-between gap-3 border-b border-edge bg-surface px-4 py-3 text-sm">
          <p role="status">{commentNotice()}</p>
          <button type="button" aria-label="Dismiss comment access notice" class="shrink-0 cursor-pointer text-muted hover:text-fg" onClick={() => setCommentNotice(null)}>Dismiss</button>
        </div>
      </TrustedUi></Portal>
    )}</Show>
    <Show when={page?.cspRequest?.status === 'blocked' && !editing() && frameSlot()}>{(slot) => (
      <Portal mount={slot()}><TrustedUi><CspConsentBar id={id!} request={page!.cspRequest!} accountSession={accountSession()} /></TrustedUi></Portal>
    )}</Show>
    <TrustedUi overlay layer="discussion">
    <Show when={ready() && nonce()}>
      <SelectionActions runtimeRef={runtimeRef} nonce={nonce()} canEdit={editable()} canAnnotate={canStartComment()} editing={editing()}
        onEdit={(path) => beginEdit(path)} onAnnotate={(selection) => {
          if (annotatable()) setInitialAnnotationSelection(selection);
          else act('comment');
        }} />
    </Show>
    <Show when={ready() && annotatable() && id}>
      <AnnotationLayer id={id!} backend={backend ?? undefined} canDeleteAny={isOwner()} editId={shownEditId()} runtimeRef={runtimeRef} sessionNonce={nonce()}
        railOpen={railOpen()} onRailOpenChange={setRailOpen} showViewComments={annotatable()} liveAnnotations={liveAnnotations()}
        initialSelection={initialAnnotationSelection()} onSelectionConsumed={() => setInitialAnnotationSelection(null)}
        pickOnOpen={!editing() || wide()} onAnnotationsChange={setAnnotationItems}
        topOffset={APP_BAR_H + (editing() ? EDIT_BAR_H : 0)}
        railHost={editing() && wide() ? commentsHost() : undefined}
        railSheet={editing() && !wide()}
        panelWidth={editing() && wide() ? editorRightInset() : undefined} />
    </Show>
    <Show when={ready() && editing()}>
      <EditEntryChrome top={APP_BAR_H} mode={mode()} panelWidth={wide() ? editorRightInset() : 0}
        skeleton={!editorMounted()} loading={!editorReady() && !editorPartFailed()} />
    </Show>
    <Show when={ready() && !editing() && restoring()}>
      <EditEntryChrome top={APP_BAR_H} mode={mode()} panelWidth={0} skeleton={false} loading leaving />
    </Show>
    <Show when={ready() && editing() && backend && (editorSeed() || editorPartFailed())}>
      <Suspense fallback={null}>
        <ArtifactEditor id={id!} backend={backend!} seed={editorSeed()} onExit={() => void lifecycle.done()} flushRef={editorFlush}
          runtimeRef={runtimeRef} sessionNonce={nonce()} initialSelectionPath={lifecycle.selectionPath()}
          onComment={editable() ? (selection) => setInitialAnnotationSelection(selection) : undefined}
          onRightInsetChange={setEditorRightInset}
          commentsOpen={railOpen()} onCommentsOpenChange={annotatable() ? setRailOpen : undefined}
          onCommentsHost={setCommentsHost} titleHost={phone() ? null : titleHost()}
          sharingContent={sharingContent} onPwaEnabledChange={setPwaEnabled}
          onEditorMount={() => setEditorMounted(true)} onEditorReady={lifecycle.ready}
          onTitleChange={setEditorTitle} onCodeViewChange={setEditorCodeOpen} />
      </Suspense>
    </Show>
    <Show when={sharingOpen() && id}>
      <DocumentSharing refs={page?.surface?.refs} id={id!} title={shownTitle()} owner={isOwner()} editable={editable()} variant="dialog" version={currentVersion()}
        onClose={() => setSharingOpen(false)} onSocialPreview={editable() ? () => { setSharingOpen(false); setSocialPreviewOpen(true); } : undefined} />
    </Show>
    <Show when={socialPreviewOpen() && editorPart()}>{(part) => (
      <Suspense fallback={null}>
        <SocialPreviewEditor id={id!} source={part().source} editId={part().editId} version={part().version} onClose={() => setSocialPreviewOpen(false)} />
      </Suspense>
    )}</Show>
    </TrustedUi>
  </Show>;
}
