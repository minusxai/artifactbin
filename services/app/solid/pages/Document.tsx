import { needsCommentPresentation } from '../document/comment-presentation';
import {createReaderPresence} from '../document/create-reader-presence';
import { replaceDocument } from '../lib/document-navigation';
/* @jsxImportSource solid-js */
import {artifactAppPath} from '@/lib/serving/artifact-pwa';
import { createEffect, createSignal, lazy, on, onCleanup, onMount, Show, Suspense, type JSX } from 'solid-js';
import { APP_BAR_H, RIGHT_RAIL_W } from '@/lib/story-ui/edit-bar';
import { Portal } from 'solid-js/web';
import { useLocation, useNavigate } from '@solidjs/router';
import { chooseTheme, storedTheme } from '@/lib/story-runtime/reader-mode';
import { rowTitle } from '@/lib/document/display-title';
import { STORY_FRAME_HASH_MESSAGE, STORY_READER_MODE_MESSAGE } from '@/lib/story-runtime/contract';
import type { StoryEditSelection } from '@/lib/edit-protocol';
import type { DocumentRuntimeRef } from '@/lib/story-runtime/document-endpoint';
import type { FramedRuntime } from '@/lib/serving';
import {createReaderHttpBackend} from '@/lib/artifact-backend/reader-http';
import { loginHref } from '@/lib/http/login-href';
import { takeBootstrap } from '@/solid/lib/bootstrap';
import { adoptServedFrame } from '@/solid/lib/served-frame';
import { reportArtifactView } from '@/solid/lib/artifact-view-report';
import { useSession } from '../lib/session';
import { commentAccess } from '../document/comment-access';
import type { AnnotationWire } from '@/lib/annotations/store';
import { ARTIFACT_ID_PATTERN, type ArtifactRole, canEdit as canEditRole, canGovern, type Visibility } from '@artifactbin/contracts';
import {ReaderNotice} from '../document/ReaderNotice';
import type { CspRequest } from '@/lib/document';
import { SelectionActions } from '../document/SelectionActions';
import { createFramedStory, fetchFrameNodes, framedDocumentFor, onFirstPressInto, type FramedStory } from '../document/create-framed-story';
import { answerFrameNavigation } from '../document/frame-navigation';
import { createLiveArtifact } from '../editor/create-live-artifact';
import { createAppAppearance } from '../ui/theme';
import { createIsPhoneViewport } from '../ui/MobileSheet';
import { TrustedUi } from '../components/TrustedUi';
import type { Panel } from '../components/PageChrome';
import { DocumentChrome } from '../document/DocumentChrome';
import {PendingReaderAction} from '../document/PendingReaderAction';
import {PendingReaderDialog} from '../document/PendingReaderDialog';

/** The document's own ground around its frame (a starter shows the app's dotted page instead). These hexes are the document's colors, not the app theme: they match the served reader's ground in each mode. */
const DOCUMENT_GROUND = { light: '#ffffff', dark: '#0b0b0c' } as const;

/** Dialogs and controls load on first use. Discussion tools load when there are comments or the reader requests them.
 * SelectionActions stays eager so the first native selection/right-click retains its capability bridge. */
const CopyAgentButton = lazy(() => import('../components/CopyAgentButton').then(m => ({default:m.CopyAgentButton})));
const NotFoundPage = lazy(() => import('./NotFound').then(m => ({default:m.NotFoundPage})));
const ReaderPresenceControls = lazy(() => import('../document/ReaderPresenceControls').then(m => ({ default: m.ReaderPresenceControls })));
const DocumentActions = lazy(() => import('../document/DocumentActions').then(m => ({ default: m.DocumentActions })));
const AnnotationLayer = lazy(() => import('../document/AnnotationLayer').then(m => ({ default: m.AnnotationLayer })));
const ForkConfirm = lazy(() => import('../document/ForkArtifact').then(m => ({ default: m.ForkConfirm })));
const DocumentSharing = lazy(() => import('../document/DocumentSharing').then(m => ({ default: m.DocumentSharing })));
const DocumentSettings = lazy(() => import('../document/DocumentSettings'));
const SocialPreviewEditor = lazy(() => import('../document/SocialPreviewEditor').then((m) => ({ default: m.SocialPreviewEditor })));

interface DocumentAnswer {
  role: ArtifactRole; kind: string;
  surface?: {
    group_id?:string|null;
    id: string; title: string | null; format: string; version: number; editId?: string;
    openAnnotations?: number; accountSession?: boolean; anonSession?: boolean;
    runtime?: FramedRuntime;
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
  /** Why the head runs without its script: the builder's messages, for a writer only (lib/serving/artifact-page). */
  scriptFailure?: { errors: string[] };
  like?: { liked: boolean; count: number };
  follow?: { userId: string; following: boolean; count: number } | null;
}

/**
 * The admitted document page: reading for everyone and commenting for those who may.
 *
 * THE DOCUMENT IS ITS FRAME (lib/serving/document-frame): the server drew one frame on the document's own origin
 * into this page, and the document runs there — its islands, its script, its own live stream and its doors. This
 * page is the app's: its bar (solid/document/DocumentChrome), the consent slot above the frame, the comments rail,
 * and sharing. Comments, selections and the reader's colour choice reach the document through the
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
  const editable = () => canEditRole(role()) && !archivedNow() && page?.surface?.format === 'html';
  const comments = () => commentAccess(role(), accountSession(), archivedNow());
  const annotatable = () => comments().canCreateComment;
  const backend = id ? createReaderHttpBackend(id) : null;
  const [pwaEnabled, setPwaEnabled] = createSignal(page?.surface?.pwaEnabled === true);
  const [ready, setReady] = createSignal(false);
  const [railOpen, setRailOpen] = createSignal(false);
  const [annotationItems, setAnnotationItems] = createSignal<AnnotationWire[] | null>(null);
  const [liveAnnotations, setLiveAnnotations] = createSignal<AnnotationWire[] | null>(null);
  const openAnnotationCount = () => (annotationItems() ?? liveAnnotations())?.filter((row) => row.status === 'open').length ?? page?.surface?.openAnnotations ?? 0;
  const [discussionActive, setDiscussionActive] = createSignal(false);
  const [panel, setPanel] = createSignal<Panel>(null);
  const [fork, setFork] = createSignal(false);
  /**
   * The reader's ONE light/dark pick (lib/story-runtime/reader-mode chooseTheme), made here or anywhere else in the app:
   * every document they read shows it. Null for a reader who never picked: documents show their author's mode. The
   * server drew the frame in it already (its ground, and its first URL: lib/serving/artifact-page readerPickOf).
   */
  const [pick, setPick] = createSignal(storedTheme());
  const authorMode = page?.surface?.colorMode === 'dark' ? 'dark' : 'light';
  const documentMode = () => pick() ?? authorMode;
  const toldMode = pick;
  /** The APP's appearance, which the bar's controls panel shows: never the document's mode (see bug: a light document read the app's toggle as light). */
  const appAppearance = createAppAppearance();
  const [initialAnnotationSelection, setInitialAnnotationSelection] = createSignal<StoryEditSelection | null>(null);
  createEffect(() => {
    setDiscussionActive(needsCommentPresentation({ canRead: comments().canReadComments, active: discussionActive(), linked: !!(new URLSearchParams(location.search).get('comment') || new URLSearchParams(location.search).get('thread')), railOpen: railOpen(), composing: !!initialAnnotationSelection(), openCount: openAnnotationCount(), liveCount: liveAnnotations()?.length ?? 0 }));
  });
  const [sharingOpen, setSharingOpen] = createSignal(false);
  const [settingsOpen, setSettingsOpen] = createSignal(false);
  const [socialPreviewOpen, setSocialPreviewOpen] = createSignal(false);
  const [previewHead, setPreviewHead] = createSignal<{ source: string; editId: string; version: number } | null>(null);
  const [metadataError, setMetadataError] = createSignal<string | null>(null);
  const openSocialPreview = async () => {
    if (!backend || !editable()) return;
    setMetadataError(null);
    try {
      const head = await backend.load();
      if (!head) throw new Error('Social preview is unavailable. Refresh and try again.');
      setPreviewHead({ source: head.html ?? '', editId: head.edit_id, version: head.version });
      setSocialPreviewOpen(true); setSharingOpen(false);
    } catch (cause) { setMetadataError(cause instanceof Error ? cause.message : 'Could not load social preview.'); }
  };
  const [membershipRevision, setMembershipRevision] = createSignal(0);
  const [nonce, setNonce] = createSignal<string | null>(null);
  const phone = createIsPhoneViewport();
  const runtimeRef: DocumentRuntimeRef = { current: null };
  const readerPresence = createReaderPresence({id: id!, revision: String(page?.archived?.version ?? page?.surface?.version ?? 1), runtimeRef, nonce, backend, enabled: () => ready() && page?.surface?.format === 'html' && !archivedNow()});
  let story: FramedStory | null = null;
  /** The document's frame (create-framed-story), once this page has adopted the one the server drew. */
  const [documentFrame, setDocumentFrame] = createSignal<HTMLIFrameElement | null>(null);
  /**
   * The slot ABOVE the frame, in the layout rather than over it: page notices about the document (the
   * CspConsentBar renders here, `<Portal mount={frameSlot()}>`), so the frame shrinks to make room.
   */
  const [frameSlot, setFrameSlot] = createSignal<HTMLElement | null>(null);
  const framedOrigin = page?.surface?.framedOrigin ?? null;
  const postToFrame = (message: Record<string, unknown>) => {
    const target = documentFrame()?.contentWindow;
    if (target && framedOrigin) target.postMessage(message, framedOrigin);
  };
  const forwardHash = () => {
    const hash = window.location.hash;
    if (hash && hash !== '#edit') postToFrame({ type: STORY_FRAME_HASH_MESSAGE, hash });
  };
  /** The viewport: the served frame's own host, where the server drew it (see the adoption below). */
  const [host, setHost] = createSignal<HTMLElement>();

  const chooseMode = (next: 'light' | 'dark') => {
    // One reader choice, two surfaces: the app shell (its stored preference) and the document in its frame.
    chooseTheme(next);
    setPick(next);
  };

  // The framed document hears its own stream; this page follows metadata and discussion.
  // The framed document hears its own stream (lib/islands/live on its origin) and draws its own new versions: this
  // one keeps the page's own state — the title, the comments and the membership — current.
  const live = backend && page?.surface ? createLiveArtifact({
    backend, id: id!, initialEditId: page.surface.editId ?? '', initialVersion: page.surface.version,
    get enabled() { return ready() && !archivedNow() && typeof EventSource === 'function'; },
    onData: (event) => {
      if (event.datasets.includes('_members')) {
        setMembershipRevision((n) => n + 1);
        // Refresh the server's role projection and frame ticket together after an ACL change.
        replaceDocument(window.location.href);
      }
      if (page.surface?.format === 'html') runtimeRef.current?.invalidate?.(event.datasets);
    },
    // Reload the original server shell and its ticketed frame together: their trusted
    // revision changes atomically, while viewer state stays in browser storage.
    onPublication: page.surface.format === 'html' ? () => replaceDocument(window.location.href) : undefined,
    onAnnotations: setLiveAnnotations,
    onPresence: readerPresence.receive,
    since: page.surface.runtime?.data.dataflow?.results?.since,
  }) : () => null;

  const railInset = () => railOpen() && !phone() ? RIGHT_RAIL_W : 0;
  // The frame scrolls beneath the bar; the comments rail reserves its own width.
  createEffect(() => {
    const viewport = host();
    if (!viewport) return;
    Object.assign(viewport.style, {
      position: 'fixed', top: `${APP_BAR_H}px`, left: '0px', right: railInset() ? `${railInset()}px` : '0px', bottom: '0px',
      display: 'flex', flexDirection: 'column', background: DOCUMENT_GROUND[documentMode()], padding: '0px', minHeight: '0px',
    });
  });

  const accountSession = () => page?.kind === 'account' || session()?.kind === 'account';
  // This is permission to start the comment flow, not to write a comment:
  // guests get sign-in; only annotatable readers get the composer below.
  const canStartComment = () => !archivedNow() && (annotatable() || !accountSession());
  /** A rail action by name: a press, a carried `?intent=` (after a sign-in), or a pill. */
  const act = (name: string) => {
    if (name === 'controls' || name === 'menu' || name === 'notifications') setPanel(name);
    else if (name === 'comment') {
      setRailOpen((open) => !open);
    } else if (name === 'fork') setFork(true);
    else if (name === 'share') { if (isOwner()) setSharingOpen(true); }
    else if (name === 'membership' || name === 'join') {
      // The bar's Join/Joined/Pending pill: joining needs an account; the people panel is where it happens.
      if (!accountSession()) { window.location.assign(loginHref(window.location, 'join')); return; }
      setPanel('controls');
    }
  };

  onMount(() => {
    if (!page || !id) return;
    const served = adoptServedFrame();
    const framed = served ? framedDocumentFor(served, framedOrigin) : null;
    if (!served || !framed) return;
    // The served frame is never moved: it stays where the server drew it, a child of <body>. A frame taken out of the
    // document and put back is a NEW frame that loads its first URL again — every browser without `moveBefore` (Safari,
    // Firefox) does that — and that URL's one-time ticket was spent by the first load. So the page lays out around the
    // frame instead: the frame's host is the viewport (the effect above), and the notices' slot is drawn in it, above the frame.
    const slot = document.createElement('div');
    slot.setAttribute('data-mx-frame-slot', '');
    slot.style.flex = '0 0 auto';
    served.insertBefore(slot, served.firstChild);
    served.setAttribute('aria-label', 'Artifact viewport');
    setHost(served);
    setFrameSlot(slot);
    setDocumentFrame(framed.frame);
    // The tree the frame's controller classifies comments, selections and edits against is its own request (not in the
    // page's data), and on a large document most of the page's bytes. A commenter or editor asks for it now, while the
    // frame loads, and the bridge attaches when it is here. Every other reader's bridge attaches at once without it
    // (reading, the mode pick and the `$` values need none of it): a guest's selection bubble (Comment → sign-in) is
    // the one use left, so a guest asks for it on the first press into the document — the frame reports a press,
    // touch, key or selection itself (a touch may never move focus), and the page's window losing focus to the frame
    // is a second signal — and the tree goes to the running frame controller, which shows the bubble for a selection
    // made while it was on its way. A signed-in viewer and an archived version never ask.
    const nodes = new AbortController();
    onCleanup(() => nodes.abort());
    const askTree = () => fetchFrameNodes(id, window.location.search, nodes.signal);
    const treeOnLoad = annotatable();
    let treeAsked = treeOnLoad;
    const askTreeOnPress = () => {
      if (treeAsked || !story || !canStartComment()) return;
      treeAsked = true;
      story.attachTree(askTree());
    };
    story = createFramedStory({
      id, framed, nodes: treeOnLoad ? askTree() : [],
      editId: () => page.surface?.editId ?? '',
      source: () => null,
      htmlContext: page.surface?.format === 'html' ? () => ({
        revision: String(page.archived?.version ?? page.surface?.version ?? 1),
        readOnly: !!page.archived,
      }) : undefined,
      version: live, reading: () => true,
      onPressed: askTreeOnPress,
    });
    if (!treeOnLoad && !archivedNow()) onCleanup(onFirstPressInto(framed.frame, askTreeOnPress));
    // The document's links to app paths take this page (another document by a full load, an app page by the router).
    const stopNavigation = answerFrameNavigation({ win: window, frame: framed.frame, frameOrigin: framed.origin, navigate: (path) => navigate(path) });
    // The document is on screen: one view (a prerendered page counts when it is shown).
    reportArtifactView(window, id);
    const framedStory = story;
    framedStory.setTopInset(0);
    window.addEventListener('hashchange', forwardHash);
    framed.frame.addEventListener('load', forwardHash);
    // The served frame may have loaded before the app did: forward now as well.
    forwardHash();
    // Null until the bridge is made (the tree arrives), then the bridge's stand-in for the document's controller.
    runtimeRef.current = framedStory.controller();
    createEffect(on(framedStory.controller, (next) => { runtimeRef.current = next; }, { defer: true }));
    // The frame's controller signs its events once it runs: the nonce arrives then (and again after the frame loads
    // anew). It is told the mode then, and whenever that changes (the reader's pick).
    createEffect(on(() => story?.nonce() ?? null, setNonce));
    createEffect(on([nonce, toldMode], ([signed, mode]) => {
      if (signed && mode) runtimeRef.current?.send({ type: STORY_READER_MODE_MESSAGE, mode });
    }));
    setReady(true);
    const address = new URL(window.location.href);
    const carried = address.searchParams.get('intent');
    if (carried) {
      address.searchParams.delete('intent');
      window.history.replaceState(window.history.state, '', address.pathname + address.search + address.hash);
      act(carried);
    }
    onCleanup(() => {
      stopNavigation();
      framed.frame.removeEventListener('load', forwardHash);
      window.removeEventListener('hashchange', forwardHash);
      runtimeRef.current = null;
      served.remove();
    });
  });
  const currentVersion = () => page?.archived?.version ?? live()?.version ?? page?.surface?.version ?? 0;
  /**
   * The head the page SHOWS: the newest of the version it loaded and the version the live stream
   * drew in place. Comments, screenshots and their images are made against it — the id the page loaded with is a
   * version the frame may no longer show, and the server refuses an image staged against it.
   */
  const shownEditId = () => {
    const heads = [
      { version: page?.surface?.version ?? 0, editId: page?.surface?.editId },
      { version: live()?.version ?? -1, editId: live()?.editId },
    ];
    return heads.reduce((best, head) => (head.editId && head.version > best.version ? head : best), { version: -1, editId: undefined as string | undefined }).editId;
  };
  const [renamed, setRenamed] = createSignal<{ title: string; version: number } | null>(null);
  const shownTitle = () => {
    const local = renamed();
    return local && currentVersion() <= local.version ? rowTitle({ title: local.title, heading: live()?.heading ?? page?.surface?.heading }) : rowTitle(live() ?? page?.surface ?? {});
  };
  return <Show when={id && page && page.surface?.framedOrigin} fallback={<Suspense fallback={<main role="status" aria-busy="true">Loading page…</main>}><NotFoundPage /></Suspense>}>
    <DocumentChrome id={id!} title={shownTitle} author={page!.surface?.author ?? null} follow={page!.follow ?? null}
      like={page!.like ?? { liked: false, count: 0 }} signedIn={accountSession} comments={openAnnotationCount}
      archived={page!.archived ?? null} canFork={!archivedNow()} owner={isOwner()}
      install={pwaEnabled() && !archivedNow()} visibility={page!.surface?.visibility} hasInvitedUsers={page!.surface?.hasInvitedUsers}
      membership={page!.surface?.membership}
      panel={panel} setPanel={setPanel} mode={appAppearance} onMode={chooseMode}
      onComment={() => act('comment')} onFork={() => act('fork')} onShare={() => act('share')} onMembership={() => act('membership')}
      controls={(close) => <Suspense fallback={<p role="status" aria-busy="true">Loading artifact controls…</p>}><><ReaderPresenceControls preferences={readerPresence.preferences()} onChange={readerPresence.setPreference} viewers={readerPresence.viewers()} /><DocumentActions groupId={page?.surface?.group_id} pwaEnabled={page?.surface?.pwaEnabled} membershipAvailable={page?.surface?.membershipAvailable} id={id!} title={shownTitle()} version={currentVersion()} archived={archivedNow()}
        onSettings={() => { close(); setSettingsOpen(true); }}
        onSocialPreview={() => { close(); void openSocialPreview(); }}
        onRenamed={(title) => setRenamed({ title, version: currentVersion() })}
        owner={isOwner()} canEdit={editable()} canAnnotate={annotatable()} accountSession={accountSession()}
        like={page?.like ?? { liked: false, count: 0 }} commentsOpen={railOpen()} onCommentsChange={(open) => { close(); setRailOpen(open); }}
        openAnnotations={openAnnotationCount()} forkedFrom={page?.surface?.author?.forkedFrom ?? null} hideFork={!phone()}
        membershipRevision={membershipRevision()} onMembershipChange={() => setMembershipRevision((n) => n + 1)}
        onShare={() => { close(); setSharingOpen(true); }}
        onDeleted={isOwner() ? () => window.location.assign('/') : undefined} /></></Suspense>} />
    {/* First in document order: lib/islands/trusted-portal hands its portal to every popover, tooltip and dialog. */}
    <TrustedUi overlay layer="navigation">
      <Show when={editable() && (live()?.template ?? page!.surface?.template) === 'doc'}>
        <div class="fixed left-6" style={{ top: `${APP_BAR_H + 12}px` }}><Suspense fallback={<PendingReaderAction label="Loading agent handoff" readyLabel="Copy for agent" />}><CopyAgentButton id={id!} template="doc" /></Suspense></div>
      </Show>
      <Show when={page?.surface?.pwaEnabled && location.pathname === artifactAppPath(id!) && new URLSearchParams(location.search).has('install')}><ReaderNotice label="App installation" load={() => import('../document/InstallArtifact')}>{({InstallArtifact}) => <InstallArtifact id={id!} title={page?.surface?.title ?? 'Untitled artifact'} />}</ReaderNotice></Show>
      <Show when={fork() && id}><Suspense fallback={<PendingReaderDialog title="Fork artifact" onClose={() => setFork(false)} />}><ForkConfirm id={id!} title={page?.surface?.title ?? 'this artifact'} onClose={() => setFork(false)} /></Suspense></Show>
    </TrustedUi>
    {/* The document's notice takes its own row above the frame (the frame shrinks), never over it. */}
    <Show when={page?.cspRequest?.status === 'blocked' && frameSlot()}>{(slot) => (
      <Portal mount={slot()}><TrustedUi><ReaderNotice label="Document network access" load={() => import('../document/CspConsentBar')}>{module => <module.CspConsentBar id={id!} request={page!.cspRequest!} accountSession={accountSession()} />}</ReaderNotice></TrustedUi></Portal>
    )}</Show>
    {/* Gone once a newer version is shown: publish refuses a script that does not build, so any newer head built its own. */}
    <Show when={!!page?.scriptFailure?.errors.length && currentVersion() <= (page?.surface?.version ?? 0) && frameSlot()}>{(slot) => (
      <Portal mount={slot()}><TrustedUi><ReaderNotice label="Page script error" load={() => import('../document/ScriptFailureNotice')}>{module => <module.ScriptFailureNotice errors={page!.scriptFailure!.errors} />}</ReaderNotice></TrustedUi></Portal>
    )}</Show>
    <TrustedUi overlay layer="discussion">
    <Show when={ready() && nonce()}>
      <SelectionActions runtimeRef={runtimeRef} nonce={nonce()} canAnnotate={canStartComment()}
        onAnnotate={(selection) => {
          if (annotatable()) setInitialAnnotationSelection(selection);
          else if (!accountSession()) window.location.assign(loginHref(window.location, 'comment'));
        }} />
    </Show>
    <Show when={ready() && id && discussionActive() && comments().canReadComments}>
      <Suspense fallback={null}><AnnotationLayer id={id!} canCreateComment={annotatable()} onSignIn={!accountSession() && !archivedNow() ? () => window.location.assign(loginHref(window.location, 'comment')) : undefined} canDeleteAny={isOwner()} editId={shownEditId()} runtimeRef={runtimeRef} sessionNonce={nonce()}
        railOpen={railOpen()} onRailOpenChange={setRailOpen} membershipRevision={membershipRevision()} showViewComments={comments().canReadComments} liveAnnotations={liveAnnotations()}
        initialSelection={initialAnnotationSelection()} onSelectionConsumed={() => setInitialAnnotationSelection(null)}
        pickOnOpen onAnnotationsChange={setAnnotationItems} topOffset={APP_BAR_H} /></Suspense>
    </Show>
    <Show when={sharingOpen() && id}>
      <Suspense fallback={<PendingReaderDialog title="Share artifact" onClose={() => setSharingOpen(false)} />}><DocumentSharing refs={page?.surface?.refs} id={id!} title={shownTitle()} owner={isOwner()} editable={editable()} variant="dialog" version={currentVersion()}
        onClose={() => setSharingOpen(false)} onSocialPreview={editable() ? () => void openSocialPreview() : undefined} /></Suspense>
    </Show>
    <Show when={metadataError()}><p role="alert">{metadataError()}</p></Show>
    <Show when={settingsOpen() && backend}><Suspense fallback={null}><DocumentSettings id={id!} title={shownTitle()} onPwaEnabledChange={setPwaEnabled} onClose={() => setSettingsOpen(false)} /></Suspense></Show>
    <Show when={socialPreviewOpen() && previewHead()}>{(head) => <Suspense fallback={null}><SocialPreviewEditor id={id!} source={head().source} editId={head().editId} version={head().version} onClose={() => setSocialPreviewOpen(false)} /></Suspense>}</Show>
    </TrustedUi>
  </Show>;
}
