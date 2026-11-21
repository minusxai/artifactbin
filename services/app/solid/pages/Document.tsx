import {createReaderPresence} from '../document/create-reader-presence';
import { replaceDocument } from '../lib/document-navigation';
/* @jsxImportSource solid-js */
import { artifactAppPath } from '@/lib/document-serving/artifact-pwa';
import { createEffect, createSignal, getOwner, lazy, on, onCleanup, onMount, runWithOwner, Show, Suspense, type JSX } from 'solid-js';
import { APP_BAR_H, REGION_TOOLBAR_H, RIGHT_RAIL_W } from '@/lib/html-reader/edit-bar';
import { useLocation, useNavigate } from '@solidjs/router';
import { chooseTheme, storedTheme } from '@/lib/html-reader/reader-mode';
import { STORY_READER_MODE_MESSAGE } from '@/lib/html-reader/contract';
import type { DocumentRuntimeRef } from '@/lib/html-reader/document-endpoint';
import type { FramedRuntime } from '@/lib/document-serving';
import {createReaderHttpBackend} from '@/lib/artifact-backend/reader-http';
import { loginHref } from '@/lib/http/login-href';
import { takeBootstrap } from '@/solid/pages/bootstrap';
import { isEmbeddedView } from '@/solid/lib/embedded';
import { reportArtifactView } from '@/solid/pages/artifact-view-report';
import { useSession } from '../lib/session';
import type { DocumentChromeDetails } from '../document/deferred-document-chrome';
import { commentAccess } from '../document/comment-access';
import type { AnnotationWire } from '@/lib/annotations';
import { ARTIFACT_ID_PATTERN } from '@artifactbin/contracts/artifact-reference';
import { type ArtifactRole, canEdit as canEditRole, canGovern, type Visibility } from '@artifactbin/contracts/sharing';
import {ReaderNotice} from '../document/ReaderNotice';
import type { CspRequest } from '@/lib/document';
import { ReaderDiscussion } from '../document/ReaderDiscussion';
import type { FramedStory, RegionUi } from '../document/create-framed-story';
import { createLiveArtifact } from '../editor/create-live-artifact';
import { createAppAppearance } from '../ui/theme';
import { createIsPhoneViewport } from '../ui/MobileSheet';
import { TrustedUi } from '../components/TrustedUi';
import type { Panel } from '../components/PageChrome';
import { DocumentChrome } from '../document/DocumentChrome';
import { DocumentCommentAction } from '../document/DocumentBarActions';
import {PendingReaderDialog} from '../document/PendingReaderDialog';
import { createDocumentDialogs } from './document-dialog-state';
import { createDocumentHead } from './document-head';
import { createFramedPage } from './framed-page';

/** The document's own ground around its frame (a starter shows the app's dotted page instead). These hexes are the document's colors, not the app theme: they match the served reader's ground in each mode. */
const DOCUMENT_GROUND = { light: '#ffffff', dark: '#0b0b0c' } as const;

/** Dialogs and controls load on first use (the discussion's own lazy layer: ../document/ReaderDiscussion). */
/** Sharing, settings and the social preview: loaded once one is asked for. */
const DocumentDialogs = lazy(() => import('./DocumentDialogs'));
const AgentHandoffDialog = lazy(() => import('../document/AgentHandoffDialog').then(m => ({default:m.AgentHandoffDialog})));
const NotFoundPage = lazy(() => import('./NotFound').then(m => ({default:m.NotFoundPage})));
/** The bar's controls panel: loaded when it opens. */
const DocumentControls = lazy(() => import('./DocumentControls'));
const FrameNotices = lazy(() => import('../document/FrameNotices'));
const RegionEditingChrome = lazy(() => import('../document/RegionToolbar').then(m => ({ default: m.RegionEditingChrome })));
const ForkConfirm = lazy(() => import('../document/ForkArtifact').then(m => ({ default: m.ForkConfirm })));

interface DocumentAnswer {
  role: ArtifactRole; kind: string;
  /** The viewer may change who reaches the page (lib/artifact-access `managesSharing`). */
  canManageSharing?: boolean;
  deferredChrome?: boolean;
  surface?: {
    group_id?:string|null;
    id: string; title: string | null; format: string; version: number; editId?: string;
    openAnnotations?: number; accountSession?: boolean; anonSession?: boolean;
    runtime?: FramedRuntime;
    refs?: Array<{ id: string; kind: string; title?: string | null }>;
    template?: string | null; theme?: string | null; colorMode?: 'light' | 'dark' | null;
    heading?: string | null; hasEditableRegions?: boolean; pwaEnabled?: boolean; membershipAvailable?: boolean;
    visibility?: Visibility; hasInvitedUsers?: boolean;
    author?: DocumentChromeDetails['author'];
    /** The document's own origin, which the page frames (lib/document-serving/artifact-page). */
    framedOrigin?: string;
    /** The reader's standing on a document that writes to datasets (the bar's Join/Joined/Pending pill). */
    membership?: 'join' | 'pending' | 'joined';
  };
  archived?: { version: number; head: number } | null;
  /** What the document asks of the network beyond the default policy, and this reader's standing (lib/trust). */
  cspRequest?: CspRequest;
  /** Why the head runs without its script: the builder's messages, for a writer only (lib/document-serving/artifact-page). */
  scriptFailure?: { errors: string[] };
  like?: DocumentChromeDetails['like'];
  follow?: DocumentChromeDetails['follow'];
}

/**
 * The reader's ONE light/dark pick (lib/story-runtime/reader-mode chooseTheme), made here or anywhere else in the app:
 * every document they read shows it. Null for a reader who never picked: documents show their author's mode. The
 * server drew the frame in it already (its ground, and its first URL: lib/document-serving/artifact-page readerPickOf).
 * One reader choice, two surfaces: the app shell (its stored preference) and the document in its frame.
 */
function createReaderMode(authorMode: 'light' | 'dark') {
  const [pick, setPick] = createSignal(storedTheme());
  return {
    /** What the frame is told: the reader's pick, or null. */
    pick,
    documentMode: () => pick() ?? authorMode,
    chooseMode: (next: 'light' | 'dark') => { chooseTheme(next); setPick(next); },
  };
}

/**
 * The admitted document page: reading for everyone and commenting for those who may.
 *
 * THE DOCUMENT IS ITS FRAME (lib/document-serving/document-frame): the server drew one frame on the document's own origin
 * into this page, and the document runs there — its islands, its script, its own live stream and its doors. This
 * page is the app's: its bar (solid/document/DocumentChrome), the consent slot above the frame, the comments rail,
 * and sharing. Comments, selections and the reader's colour choice reach the document through the
 * bridge (solid/document/create-framed-story); the address's `#hash` goes to its page behaviour. A link to an app path
 * inside the document comes back here and this page follows it (solid/document/frame-navigation). Showing the
 * document is its view (solid/pages/artifact-view-report).
 *
 * EMBEDDED (solid/lib/embedded: `?embed=1`, framed by a trusted embedder): the same page without the bar; the frame
 * takes the whole viewport and one comment control stays, so discussion is reachable as on the bar.
 */
export function DocumentPage(): JSX.Element {
  const location = useLocation();
  const navigate = useNavigate();
  const { session, sessionError } = useSession();
  const page = takeBootstrap<DocumentAnswer>(location.pathname, 'artifact');
  const embedded = isEmbeddedView();
  /** Where the frame (and what lies over it) starts: under the bar, or at the top when embedded. */
  const barHeight = embedded ? 0 : APP_BAR_H;
  const rawId = page?.surface?.id ?? /^\/a\/([^/]+)/.exec(location.pathname)?.[1] ?? null;
  const id = rawId && ARTIFACT_ID_PATTERN.test(rawId) ? rawId : null;
  const [chrome, setChrome] = createSignal<DocumentChromeDetails | null>(null);
  const like = () => chrome()?.like ?? page?.like;
  const author = () => chrome()?.author ?? page?.surface?.author ?? null;
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
  const openAnnotationCount = () => (annotationItems() ?? liveAnnotations())?.filter((row) => row.status === 'open').length ?? chrome()?.openAnnotations ?? page?.surface?.openAnnotations ?? 0;
  const [panel, setPanel] = createSignal<Panel>(null);
  const [fork, setFork] = createSignal(false);
  const { pick, documentMode, chooseMode } = createReaderMode(page?.surface?.colorMode === 'dark' ? 'dark' : 'light');
  /** The APP's appearance, which the bar's controls panel shows: never the document's mode (see bug: a light document read the app's toggle as light). */
  const appAppearance = createAppAppearance();
  const dialogs = createDocumentDialogs({ backend, editable });
  const [handoffOpen, setHandoffOpen] = createSignal(false);
  /** A doc ("New" made it: one rich region for its whole body) is edited from the moment it loads, and can be handed to an agent. */
  const isDoc = () => (live()?.template ?? page?.surface?.template) === 'doc';
  const [membershipRevision, setMembershipRevision] = createSignal(0);
  const [nonce, setNonce] = createSignal<string | null>(null);
  const phone = createIsPhoneViewport();
  const runtimeRef: DocumentRuntimeRef = { current: null };
  /** The version shown (the frame's relayed queries, presence and selection classify against it), its title and edit id. */
  const head = createDocumentHead({ served: { version: page?.surface?.version ?? 0, editId: page?.surface?.editId ?? '' }, archivedVersion: page?.archived?.version, surface: page?.surface, live: () => live() });
  const htmlHead = head.html;
  /** The drawn version's tree, fetched again once the frame holds one (set when the frame is adopted). */
  const reload = () => replaceDocument(window.location.href);
  const readerPresence = createReaderPresence({id: id!, revision: () => String(page?.archived?.version ?? (htmlHead().version || 1)), runtimeRef, nonce, backend, enabled: () => ready() && page?.surface?.format === 'html' && !archivedNow()});
  let story: FramedStory | null = null;
  /** The region editing chrome's inputs, once the frame's bridge exists (read after `ready`). */
  const regionUi = (): RegionUi | undefined => (story as FramedStory | null)?.regionUi;
  const framedOrigin = page?.surface?.framedOrigin ?? null;

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
    // The frame draws an inert edit in place, or rebuilds its own document from any other version keeping the reader's
    // place, and this page moves its trusted revision with it; only a version the frame could not read reloads the
    // original server shell and its ticketed frame together, while viewer state stays in browser storage.
    // Loaded when a version arrives: the app shell before the frame is ready stays within its size budget.
    onPublication: page.surface.format === 'html' ? (version, editId, title, live) => (title !== undefined && head.published(title, version), import('../document/follow-html-version')).then(({ followPublication }) => followPublication({
      version, editId, live, drawn: htmlHead().version, frame: archivedNow() ? null : runtimeRef.current, show: head.show, reload,
    }), reload) : undefined,
    onAnnotations: setLiveAnnotations,
    onPresence: readerPresence.receive,
  }) : () => null;

  const railInset = () => railOpen() && !phone() ? RIGHT_RAIL_W : 0;
  const framedPage = createFramedPage({ origin: framedOrigin, top: barHeight, right: railInset, ground: () => DOCUMENT_GROUND[documentMode()] });
  const { forwardHash, settleStateFragment } = framedPage;

  const accountSession = () => page?.kind === 'account' || session()?.kind === 'account';
  /** A rail action by name: a press, a carried `?intent=` (after a sign-in), or a pill. */
  const act = (name: string) => {
    if (name === 'controls' || name === 'menu' || name === 'notifications') setPanel(name);
    else if (name === 'comment') {
      setRailOpen((open) => !open);
    } else if (name === 'fork') setFork(true);
    else if (name === 'share') { if (isOwner()) dialogs.show('sharing'); }
    else if (name === 'membership' || name === 'join') {
      // The bar's Join/Joined/Pending pill: joining needs an account; the people panel is where it happens.
      if (!accountSession()) { window.location.assign(loginHref(window.location, 'join')); return; }
      setPanel('controls');
    }
  };

  onMount(() => {
    if (!page || !id) return;
    const framed = framedPage.adopt();
    if (!framed) return;
    // The bridge to the frame (create-framed-story, frame-bridge/parent) is loaded now: the frame attaches after its own
    // document has loaded, so the app shell before the frame is ready does not carry it (page-speed size target 4).
    const owner = getOwner();
    let unmounted = false;
    onCleanup(() => { unmounted = true; runtimeRef.current = null; });
    // The document is on screen: one view (a prerendered page counts when it is shown).
    reportArtifactView(window, id);
    if (page.deferredChrome) void import('../document/deferred-document-chrome').then(({ bindDocumentChrome }) => {
      if (!unmounted) runWithOwner(owner, () => bindDocumentChrome(id, setChrome));
    }).catch(() => { /* The document and its discussion remain usable without social details. */ });
    void import('../document/create-framed-story').then(({ answerFrameNavigation, createFramedStory, opensComment, takeIntent, uploadSessionOf }) => { if (!unmounted) runWithOwner(owner, () => {
      story = createFramedStory({
        id, framed,
        editId: () => htmlHead().editId,
        source: () => null,
        htmlContext: page.surface?.format === 'html' ? () => ({
          revision: String(page.archived?.version ?? (htmlHead().version || 1)),
          readOnly: !!page.archived,
          uploadSession: uploadSessionOf(session(), sessionError()),
        }) : undefined,
        // Cells open for a browser that edits live: a person signed in, or a browser session's scripted browser.
        liveEditor: () => session()?.liveEditor === true,
        // Live editing of the page's editable regions: editors of the head only (a viewer or commenter never opens one).
        regions: backend ? {
          // The shell knows whether this saved version can have regions. Recheck after publication.
          enabled: () => editable() && (page.surface?.hasEditableRegions !== false || htmlHead().version !== page.surface.version), loadHtml: async () => (await backend.load())?.html ?? null, autoOpen: page.surface?.template === 'doc', autoFocus: !opensComment(window.location.search) } : undefined,
      });
      // The document's links to app paths take this page (another document by a full load, an app page by the router).
      const stopNavigation = answerFrameNavigation({ win: window, frame: framed.frame, frameOrigin: framed.origin, navigate: (path) => navigate(path) });
      const framedStory = story;
      // The region toolbar takes a strip over the frame's top edge while it shows: the document reserves it.
      createEffect(on(() => !!framedStory.regionUi.toolbar(), (shown) => framedStory.setTopInset(shown ? REGION_TOOLBAR_H : 0)));
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
      createEffect(on(nonce, (signed) => { if (signed) settleStateFragment(); }));
      createEffect(on([nonce, pick], ([signed, mode]) => {
        if (signed && mode) runtimeRef.current?.send({ type: STORY_READER_MODE_MESSAGE, mode });
      }));
      setReady(true);
      const carried = takeIntent();
      if (carried) act(carried);
      onCleanup(() => {
        stopNavigation();
        framed.frame.removeEventListener('load', forwardHash);
        window.removeEventListener('hashchange', forwardHash);
      });
    }); });
  });
  const currentVersion = head.version;
  const shownTitle = head.title;
  const scriptErrors = () => currentVersion() <= (page?.surface?.version ?? 0) ? page?.scriptFailure?.errors : undefined;
  return <Show when={id && page && page.surface?.framedOrigin} fallback={<Suspense fallback={<main role="status" aria-busy="true">Loading page…</main>}><NotFoundPage /></Suspense>}>
    <Show when={embedded}><TrustedUi overlay layer="navigation"><div class="fixed right-3 top-3 z-40"><DocumentCommentAction count={openAnnotationCount()} active={railOpen()} onClick={() => act('comment')} /></div></TrustedUi></Show>
    <Show when={!embedded}><DocumentChrome id={id!} title={shownTitle} author={author()} follow={chrome()?.follow ?? page!.follow ?? null}
      like={like() ?? { liked: false, count: 0 }} likeUnavailable={page?.deferredChrome && !like()} signedIn={accountSession} comments={openAnnotationCount}
      archived={page!.archived ?? null} canFork={!archivedNow()} owner={isOwner()}
      install={pwaEnabled() && !archivedNow()} visibility={page!.surface?.visibility} hasInvitedUsers={chrome()?.hasInvitedUsers ?? page!.surface?.hasInvitedUsers}
      membership={page!.surface?.membership}
      panel={panel} setPanel={setPanel} mode={appAppearance} onMode={chooseMode}
      onComment={() => act('comment')} onFork={() => act('fork')} onShare={() => act('share')} onMembership={() => act('membership')}
      controls={(close) => <Suspense fallback={<p role="status" aria-busy="true">Loading artifact controls…</p>}><DocumentControls close={close} presence={readerPresence} answer={{ ...page!, like: like(), surface: page!.surface && { ...page!.surface, author: author() } }} likeUnavailable={page?.deferredChrome && !like()}
        design={{ colorMode: documentMode(), send: (command) => runtimeRef.current?.send(command), pick }} id={id!} title={shownTitle()} version={currentVersion()} archived={archivedNow()}
        owner={isOwner()} canEdit={editable()} canAnnotate={annotatable()} accountSession={accountSession()} phone={phone()}
        commentsOpen={railOpen()} openAnnotations={openAnnotationCount()} membershipRevision={membershipRevision()} onCommentsChange={setRailOpen}
        onMembershipChange={() => setMembershipRevision((n) => n + 1)} onSettings={() => dialogs.show('settings')} onSocialPreview={() => void dialogs.openSocialPreview()}
        onRenamed={head.renamed} onShare={() => dialogs.show('sharing')} onHandToAgent={isDoc() ? () => setHandoffOpen(true) : undefined} /></Suspense>} /></Show>
    {/* First in document order: lib/islands/trusted-portal hands its portal to every popover, tooltip and dialog. */}
    <TrustedUi overlay layer="navigation">
      <Show when={ready() && (regionUi()?.toolbar() || regionUi()?.slash())}><Suspense fallback={null}><RegionEditingChrome ui={regionUi()!} top={barHeight} right={railInset()} /></Suspense></Show>
      <Show when={editable() && isDoc() && handoffOpen()}>
        <Suspense fallback={<PendingReaderDialog title="Hand to an agent" onClose={() => setHandoffOpen(false)} />}><AgentHandoffDialog id={id!} template="doc" onClose={() => setHandoffOpen(false)} /></Suspense>
      </Show>
      <Show when={page?.surface?.pwaEnabled && location.pathname === artifactAppPath(id!) && new URLSearchParams(location.search).has('install')}><ReaderNotice label="App installation" load={() => import('../document/InstallArtifact')}>{({InstallArtifact}) => <InstallArtifact id={id!} title={page?.surface?.title ?? 'Untitled artifact'} />}</ReaderNotice></Show>
      <Show when={fork() && id}><Suspense fallback={<PendingReaderDialog title="Fork artifact" onClose={() => setFork(false)} />}><ForkConfirm id={id!} title={page?.surface?.title ?? 'this artifact'} onClose={() => setFork(false)} /></Suspense></Show>
    </TrustedUi>
    {/* The document's notices take their own row above the frame (the frame shrinks), never over it. */}
    <Show when={page?.cspRequest?.status === 'blocked' || scriptErrors()?.length}>
      <Suspense fallback={null}>
        <FrameNotices slot={framedPage.slot()} id={id!} csp={page?.cspRequest} accountSession={accountSession()} scriptErrors={scriptErrors()} />
      </Suspense>
    </Show>
    <TrustedUi overlay layer="discussion">
    <Show when={id}>
      <ReaderDiscussion id={id!} role={role()} accountSession={accountSession()} archived={archivedNow()} runtimeRef={runtimeRef} ready={ready()} nonce={nonce()}
        editId={head.editId()} canDeleteAny={isOwner()} railOpen={railOpen()} onRailOpenChange={setRailOpen} liveAnnotations={liveAnnotations()}
        openCount={openAnnotationCount()} linked={!!(new URLSearchParams(location.search).get('comment') || new URLSearchParams(location.search).get('thread'))}
        onAnnotationsChange={setAnnotationItems} onSignIn={() => window.location.assign(loginHref(window.location, 'comment'))}
        beforeComment={(subject) => story ? story.beforeComment(subject) : Promise.resolve(subject)} membershipRevision={membershipRevision()}
        topOffset={barHeight} documentTopInset={regionUi()?.toolbar() ? REGION_TOOLBAR_H : 0} />
    </Show>
    <Show when={dialogs.open() && (dialogs.open() !== 'settings' || backend)}>
      <Suspense fallback={dialogs.open() === 'sharing' ? <PendingReaderDialog title="Share artifact" onClose={dialogs.close} /> : null}>
    <DocumentDialogs dialogs={dialogs} id={id!} title={shownTitle()} refs={page?.surface?.refs} owner={isOwner()} editable={editable()} queryApprovals={page?.surface?.format === 'html'} version={currentVersion()} onPwaEnabledChange={setPwaEnabled} />
      </Suspense>
    </Show>
    <Show when={dialogs.error()}><p role="alert">{dialogs.error()}</p></Show>
    </TrustedUi>
  </Show>;
}
