/* @jsxImportSource solid-js */
import { InstallArtifact } from '../document/InstallArtifact';
import { createEffect, createSignal, lazy, on, onCleanup, onMount, Show, Suspense, untrack, type JSX } from 'solid-js';
import { useLocation } from '@solidjs/router';
import { startIslandLive } from '@/lib/islands/live';
import { islandDocumentOf } from '@/lib/islands/handover';
import { PAGE_TAKEOVER_EVENT } from '@/lib/islands/page-lifetime';
import { applyReaderChoice } from '@/lib/story-runtime/reader-actions';
import { applyColorMode, chooseTheme } from '@/lib/story-runtime/reader-mode';
import { chromeAfterSample, type ChromeState } from '@/lib/story-runtime/reader-chrome-policy';
import { READER_CHROME_HIDDEN_CLASS } from '@/lib/story/reader/reader-chrome';
import { wireReaderSharing } from '@/lib/story-runtime/reader-share';
import { keepReadingPlace } from '@/lib/story-runtime/anchor';
import { STORY_DATA_MESSAGE, STORY_DOCUMENT_MESSAGE, STORY_READER_MODE_MESSAGE, type StoryEditSelection } from '@/lib/story-runtime/contract';
import type { DocumentRuntimeRef } from '@/lib/story-runtime/document-endpoint';
import type { ServedStoryRuntime } from '@/lib/story/prepared/prepared-runtime';
import { createHttpBackend } from '@/lib/artifact-backend/http';
import { loginHref } from '@/lib/http/login-href';
import { takeBootstrap } from '@/web/bootstrap';
import { takeChromeIntent } from '@/web/idle-boot';
import { adoptInitialStory, removeServedHeadStyles } from '@/web/initial-story';
import { useSession } from '../lib/session';
import { NotFoundPage } from './NotFound';
import type { AnnotationWire } from '@/lib/annotations/store';
import { canAnnotate as canAnnotateRole, canEdit as canEditRole, canGovern, type ArtifactRole } from '@/lib/artifacts/share-roles';
import { DocumentActions } from '../document/DocumentActions';
import { AnnotationLayer } from '../document/AnnotationLayer';
import { SelectionActions } from '../document/SelectionActions';
import { ForkConfirm } from '../document/ForkArtifact';
import { DocumentSharing } from '../document/DocumentSharing';
import { DocumentPeople } from '../document/DocumentPeople';
import { createIslandStory, type IslandStory } from '../document/create-island-story';
import { createFramedStory, framedDocumentFor } from '../document/create-framed-story';
import { createEditLifecycle, createEditorPartLoader } from '../document/create-edit-lifecycle';
import { moveInto } from '@/lib/story-runtime/island-controller';
import { createLiveArtifact } from '../editor/create-live-artifact';
import { createWideEditViewport, editPanelWidth, readEditPanelCollapsed } from '../editor/create-edit-panel';
import { EditEntryChrome } from '../editor/EditEntryChrome';
import { createIsPhoneViewport } from '../components/MobileSheet';
import { panelFitsInMargin } from '@/lib/story/reader/edit-panel-fit';
import { APP_BAR_H, EDIT_BAR_H, RIGHT_RAIL_W } from '@/lib/story/reader/edit-bar';
import { ARTIFACT_ID_PATTERN } from '@artifactbin/contracts';
import type { EditorArtifact } from '../editor/InPlaceEditor';
import { TrustedUi } from '../components/TrustedUi';
import { NotificationsPanel, PageMenuPanel } from '../components/PageChrome';
import Sun from 'lucide-solid/icons/sun';
import Moon from 'lucide-solid/icons/moon';
import X from 'lucide-solid/icons/x';
import { STORY_CHROME_CSS } from '@/lib/story-runtime/chrome-css';
import { toggleReaction, wireReaderChrome, type ReaderPanel } from '../document/reader-chrome-adapter';

/** The page panels wear the reader chrome's own sheet; inside the trusted root they need its tokens too. */
const PANEL_CSS = `${STORY_CHROME_CSS}
.mx-reader-panel, .mx-reader-scrim { --mx-reader-bg: #ffffff; --mx-reader-fg: #1a2129; --mx-reader-muted: #5a6572; --mx-reader-border: #e1e6ea; --mx-reader-accent: #0e9d4f; --mx-reader-on-accent: #ffffff; --mx-reader-scheme: light; }
/* The app's panels never dim the document (the controls never did); the scrim only catches the outside click. */
.mx-reader-scrim { background: transparent !important; }
[data-theme="dark"] .mx-reader-panel, [data-theme="dark"] .mx-reader-scrim { --mx-reader-bg: #10151b; --mx-reader-fg: #e6edf3; --mx-reader-muted: #7d8590; --mx-reader-border: #202832; --mx-reader-accent: #3fe77b; --mx-reader-on-accent: #10151b; --mx-reader-scheme: dark; }`;
/** The document's own ground while the app holds it (a starter shows the app's dotted page instead). */
const DOCUMENT_GROUND = { light: '#ffffff', dark: '#0b0b0c' } as const;

const ArtifactEditor = lazy(() => import('../editor/ArtifactEditor'));
const SocialPreviewEditor = lazy(() => import('../document/SocialPreviewEditor').then((m) => ({ default: m.SocialPreviewEditor })));

interface DocumentAnswer {
  role: ArtifactRole; kind: string;
  surface?: {
    id: string; title: string | null; format: string; version: number; editId?: string;
    openAnnotations?: number; accountSession?: boolean; anonSession?: boolean;
    author?: { forkedFrom?: { label: string; href: string | null } | null } | null;
    runtime?: ServedStoryRuntime;
    refs?: Array<{ id: string; kind: string; title?: string | null }>;
    template?: string | null; theme?: string | null; colorMode?: 'light' | 'dark' | null;
    heading?: string | null; pwaEnabled?: boolean; membershipAvailable?: boolean;
  };
  archived?: { version: number; head: number } | null;
  like?: { liked: boolean; count: number };
  follow?: { userId: string; following: boolean; count: number } | null;
}

/** Move the server's existing nodes; the island document and its listeners retain identity. */
export function adoptReaderDocument(host: HTMLElement): { story: HTMLElement | null; chrome: HTMLElement | null } {
  const chrome = Array.from(document.body.children).find((child): child is HTMLElement => child instanceof HTMLElement && child.hasAttribute('data-mx-reader-chrome')) ?? null;
  // moveBefore where the browser has it: the story's iframes (a managed frame's realm) and focus survive the move.
  if (chrome) moveInto(host, chrome);
  const story = adoptInitialStory() ?? Array.from(document.body.children).find((child): child is HTMLElement => child instanceof HTMLElement && child.hasAttribute('data-mx-inline-story')) ?? null;
  if (story) {
    if (story.parentElement === document.body) window.dispatchEvent(new Event(PAGE_TAKEOVER_EVENT));
    moveInto(host, story);
    document.getElementById('root')?.removeAttribute('hidden');
  }
  return { story, chrome };
}

/** The served rail's reading actions: the draft is not the published document, so editing hides them. */
const READING_ONLY = '[data-mx-reader-install],[data-mx-reader-action="share"],[data-mx-reader-action="like"],[data-mx-reader-action="comment"],[data-mx-reader-action="fork"],[data-mx-reader-action="membership"],[data-mx-github-star]';

/** Put the served chrome in (or out of) edit mode; answers the breadcrumb slot the title editor renders into. */
export function markChromeEditing(chrome: HTMLElement, editing: boolean, titleSlot: boolean, titleText?: string | null): HTMLElement | null {
  chrome.classList.toggle('mx-reader-chrome--pinned', editing);
  chrome.classList.toggle('mx-reader-chrome--editing', editing);
  chrome.toggleAttribute('data-mx-editing', editing);
  for (const element of chrome.querySelectorAll<HTMLElement>(READING_ONLY)) element.hidden = editing;
  const edit = chrome.querySelector<HTMLElement>('[data-mx-reader-action="edit"]');
  edit?.setAttribute('aria-label', editing ? 'Done editing' : 'Edit');
  const title = chrome.querySelector<HTMLElement>('.mx-reader-title');
  if (!title) return null;
  if (editing && titleSlot) {
    if (!title.hasAttribute('data-mx-title-editor')) { title.setAttribute('data-mx-title-text', title.textContent ?? ''); title.textContent = ''; }
    title.setAttribute('data-mx-title-editor', '');
    return title;
  }
  // Leaving edit mode names the document as the editor last did (a title typed, a heading rewritten).
  if (title.hasAttribute('data-mx-title-editor')) {
    title.removeAttribute('data-mx-title-editor');
    title.textContent = (!editing && titleText) || title.getAttribute('data-mx-title-text') || '';
  } else if (!editing && titleText && title.textContent !== titleText) title.textContent = titleText;
  return null;
}

const whenIdle = (task: () => void): (() => void) => {
  const w = window as unknown as { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number; cancelIdleCallback?: (h: number) => void };
  if (w.requestIdleCallback) { const handle = w.requestIdleCallback(task, { timeout: 3000 }); return () => w.cancelIdleCallback?.(handle); }
  const timer = setTimeout(task, 1500);
  return () => clearTimeout(timer);
};

/** The admitted document page: reading for everyone, commenting and editing in place for those who may. */
export function DocumentPage(): JSX.Element {
  const location = useLocation();
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
  const [annotationItems, setAnnotationItems] = createSignal<AnnotationWire[] | null>(null);
  const [liveAnnotations, setLiveAnnotations] = createSignal<AnnotationWire[] | null>(null);
  const openAnnotationCount = () => (annotationItems() ?? liveAnnotations())?.filter((row) => row.status === 'open').length ?? page?.surface?.openAnnotations ?? 0;
  const [panel, setPanel] = createSignal<ReaderPanel | null>(null);
  const [fork, setFork] = createSignal(false);
  const [mode, setMode] = createSignal<'light' | 'dark'>('light');
  /** The editor's bar is on screen (it replaces the entry skeleton). */
  const [editorMounted, setEditorMounted] = createSignal(false);
  /** The name the editor's title field last showed: the breadcrumb's when editing ends. */
  let editorTitle: string | null = null;
  const [initialAnnotationSelection, setInitialAnnotationSelection] = createSignal<StoryEditSelection | null>(null);
  const [titleHost, setTitleHost] = createSignal<HTMLElement | null>(null);
  const [commentsHost, setCommentsHost] = createSignal<HTMLElement | null>(null);
  const [editorRightInset, setEditorRightInset] = createSignal(0);
  const [panelFits, setPanelFits] = createSignal<boolean | null>(null);
  const [sharingOpen, setSharingOpen] = createSignal(false);
  const [socialPreviewOpen, setSocialPreviewOpen] = createSignal(false);
  const [membershipRevision, setMembershipRevision] = createSignal(0);
  const [nonce, setNonce] = createSignal<string | null>(null);
  const wide = createWideEditViewport();
  const phone = createIsPhoneViewport();
  const runtimeRef: DocumentRuntimeRef = { current: null };
  const editorFlush: { current: (() => Promise<void>) | null } = { current: null };
  let island: IslandStory | null = null;
  let adoptedStory: HTMLElement | null = null;
  let chromeElement: HTMLElement | null = null;
  let host!: HTMLDivElement;
  const pendingData: string[] = [];

  const chooseMode = (next: 'light' | 'dark') => {
    // One reader choice, two surfaces: the app shell (its stored preference) and the document.
    chooseTheme(next);
    applyReaderChoice(window, document, next);
    applyColorMode(adoptedStory, next);
    runtimeRef.current?.send({ type: STORY_READER_MODE_MESSAGE, mode: next });
    setMode(next);
  };

  // ── the editor's door, and the edit mode's one owner (enter → ready → done → restored) ──
  const parts = createEditorPartLoader(id, editable);
  const { part: editorPart, failed: editorPartFailed, load: loadEditorPart } = parts;
  const lifecycle = createEditLifecycle({
    editable,
    pwaChanged: () => pwaEnabled() !== (page?.surface?.pwaEnabled === true),
    controller: () => island?.controller() ?? null,
  });
  const { editing } = lifecycle;
  /** Done was pressed and the page is drawing the saved version to read in place (the slim bar runs). */
  const restoring = () => lifecycle.phase() === 'restoring';
  /** The document is editable (the loading bar ends). */
  const editorReady = () => lifecycle.phase() !== 'entering';
  onCleanup(lifecycle.registerFlush(() => editorFlush.current?.() ?? Promise.resolve()));

  // ── the live document, while reading (the editor holds its own stream while editing) ──
  const live = backend && page?.surface ? createLiveArtifact({
    backend, id: id!, initialEditId: page.surface.editId ?? '', initialVersion: page.surface.version,
    get enabled() { return ready() && !editing() && !archivedNow() && typeof EventSource === 'function'; },
    onData: (event) => {
      if (event.datasets.includes('_members')) setMembershipRevision((n) => n + 1);
      if (!runtimeRef.current) { pendingData.push(...event.datasets); return; }
      runtimeRef.current.send({ type: STORY_DATA_MESSAGE, datasets: event.datasets });
    },
    onAnnotations: setLiveAnnotations,
    since: page.surface.runtime?.data.dataflow?.results?.since,
  }) : () => null;
  createEffect(() => {
    const frame = live();
    if (!frame || untrack(editing) || !frame.nodes) return;
    runtimeRef.current?.update({
      type: STORY_DOCUMENT_MESSAGE, nodes: frame.nodes,
      ...(frame.dataflow ? { dataflow: frame.dataflow } : {}),
      compiledCss: frame.compiledCss, authorCss: frame.authorCss,
      authorScript: frame.authorScript, theme: frame.theme,
      ...(frame.colorMode ? { colorMode: frame.colorMode } : {}),
    });
  });

  // ── edit mode: a MODE of the one address, mirrored in `#edit` (solid/document/create-edit-lifecycle) ──
  /** Everything the switch into editing downloads, started on idle for a writer and again on the click (both deduplicate). */
  const prefetchEditor = () => {
    void loadEditorPart();
    void import('../editor/ArtifactEditor').catch(() => {});
    void import('@/lib/story-runtime/edit/session').catch(() => {});
    void import('../editor/dom-mounter').catch(() => {});
  };
  const beginEdit = (selectionPath: string | null) => {
    if (editable() && !editing()) prefetchEditor();
    lifecycle.enter(selectionPath);
  };
  const enterEdit = () => beginEdit(null);
  createEffect(on(lifecycle.phase, (now, before) => {
    if (now === 'entering') void loadEditorPart();
    if (!editing()) setEditorMounted(false);
    // Back to reading in place: the next edit opens on the version just saved, not the part this session opened on.
    if (now === 'reading' && before === 'restoring') { parts.reset(); if (editable()) void loadEditorPart(); }
  }, { defer: true }));
  createEffect(() => { if (page?.surface) document.title = editing() ? `${page.surface.title ?? page.surface.runtime?.title ?? 'Untitled'} [edit mode]` : document.title.replace(/ \[edit mode\]$/, ''); });

  // The edit panel's width comes out of the document's margin, or its width — decided ONCE per session.
  createEffect(() => {
    if (!editing()) { setPanelFits(null); return; }
    if (!wide() || untrack(panelFits) !== null) return;
    let frame = 0; let frames = 0;
    const decide = () => {
      // A framed document (create-framed-story) is the frame itself: it has its content, and no margin to fit in.
      const root = host?.querySelector('[data-mx-inline-story]') ?? host?.querySelector('iframe');
      const hasContent = !!root && root.childElementCount > 0;
      if (!hasContent && !untrack(railOpen) && frames++ < 300) { frame = requestAnimationFrame(decide); return; }
      setEditorRightInset(editPanelWidth(readEditPanelCollapsed()));
      setPanelFits(!untrack(railOpen) && hasContent && panelFitsInMargin(root!, document.documentElement.clientWidth, RIGHT_RAIL_W));
    };
    decide();
    onCleanup(() => cancelAnimationFrame(frame));
  });
  const readingRail = () => (railOpen() && !phone() ? RIGHT_RAIL_W : 0);
  const railInset = () => (!editing() ? readingRail() : !wide() ? 0 : panelFits() === null ? readingRail() : panelFits() ? 0 : editorRightInset());
  createEffect(() => {
    if (!host) return;
    host.style.position = 'relative';
    // Full-width whatever the rail does: the rail's width is the host's padding, never its box.
    host.style.right = '0px';
    host.style.minHeight = '100vh';
    host.style.background = DOCUMENT_GROUND[mode()];
    // The served page reserved the bar on <body> (`body:has(> [data-mx-inline-story])`, compiled-page/assembler);
    // the story now lives in this host, so the host reserves it — and the editor toolbar under it.
    const top = `${(phone() ? 0 : APP_BAR_H) + (editing() ? EDIT_BAR_H : 0)}px`;
    const right = railInset() ? `${railInset()}px` : '';
    const bottom = editing() && !wide() ? '50vh' : '';
    if (host.style.paddingTop === top && host.style.paddingRight === right && host.style.paddingBottom === bottom) return;
    // Entering or leaving edit (and the panel taking its width) must not move what the reader is looking at:
    // the paragraph under them keeps its place on screen in the frame that paints the new chrome.
    const apply = () => { host.style.paddingTop = top; host.style.paddingRight = right; host.style.paddingBottom = bottom; };
    if (untrack(ready)) keepReadingPlace(window, apply); else apply();
  });
  createEffect(() => {
    if (!ready() || !chromeElement) return;
    // The breadcrumb keeps its text until the title editor is there to take its place (one swap, no blank title).
    setTitleHost(markChromeEditing(chromeElement, editing(), !phone() && editorMounted(), editorTitle));
  });
  // The rail's comment count follows the layer's list (a thread opened or resolved here, or by the stream).
  createEffect(() => {
    if (!ready() || !chromeElement) return;
    const count = chromeElement.querySelector('[data-mx-reader-count="comment"]');
    if (count) count.textContent = openAnnotationCount() > 0 ? String(openAnnotationCount()) : '';
  });

  const editorSeed = (): EditorArtifact | undefined => {
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
  };

  onMount(() => {
    if (!page) return;
    const { story, chrome } = adoptReaderDocument(host);
    if (!story || !chrome || !id) { window.location.replace(location.pathname + location.search + location.hash); return; }
    adoptedStory = story;
    chromeElement = chrome;
    setMode(story.classList.contains('dark') ? 'dark' : 'light');
    const islands = islandDocumentOf(story);
    // The frame condition (create-framed-story `framedDocumentFor`): the document runs in a frame on its own origin,
    // and the served story here is put away; everything below talks to it through the bridge's stand-in.
    const framedAt = framedDocumentFor(id, window.location.href);
    const storyInputs = {
      id, nodes: page.surface?.runtime?.data.nodes ?? [],
      editId: () => editorPart()?.editId ?? page.surface?.editId ?? '',
      source: () => editorPart()?.source ?? null,
    };
    if (framedAt) { islands?.dispose(); story.remove(); adoptedStory = null; }
    island = framedAt
      ? createFramedStory({ ...storyInputs, host, frame: framedAt, height: () => `calc(100vh - ${(phone() ? 0 : APP_BAR_H) + (editing() ? EDIT_BAR_H : 0)}px)` })
      : createIslandStory({ ...storyInputs, host, story, islands });
    runtimeRef.current = island.controller();
    // A framed document's controller signs its events once it runs in the frame: the nonce arrives then.
    createEffect(() => setNonce(island?.nonce() ?? null));
    if (pendingData.length) runtimeRef.current?.send({ type: STORY_DATA_MESSAGE, datasets: [...new Set(pendingData.splice(0))] });
    setReady(true);
    const sharing = wireReaderSharing(window, document, chrome);
    const wiring = wireReaderChrome(chrome, {
      panel, setPanel, onMode: chooseMode,
      onAction: async (name) => {
        if (name === 'like' || name === 'follow') {
          const href = name === 'like' ? `/api/my/artifacts/${id}/like` : page.follow ? `/api/users/${page.follow.userId}/follow` : null;
          await toggleReaction(chrome, name, href, { signedIn: page.kind === 'account' || session()?.kind === 'account' });
        } else if (name === 'comment') {
          if (!annotatable()) { window.location.assign(loginHref(window.location, 'comment')); return; }
          setRailOpen((open) => !open);
        } else if (name === 'fork') setFork(true);
        else if (name === 'share') { if (isOwner()) setSharingOpen(true); else void sharing.share(); }
        else if (name === 'notifications') setPanel((open) => (open === 'notifications' ? null : 'notifications'));
        else if (name === 'membership' || name === 'join') {
          // The rail's Join/Joined/Pending pill: joining needs an account; the people panel is where it happens.
          if (!accountSession()) { window.location.assign(loginHref(window.location, 'join')); return; }
          void wiring.act('controls');
        }
        else if (name === 'edit' && editable()) { if (editing()) void lifecycle.done(); else enterEdit(); }
      },
    });
    window.addEventListener('hashchange', lifecycle.sync);
    const intent = takeChromeIntent();
    const address = new URL(window.location.href);
    const carried = address.searchParams.get('intent');
    if (carried) {
      address.searchParams.delete('intent');
      window.history.replaceState(window.history.state, '', address.pathname + address.search + address.hash);
    }
    if (intent || carried) void wiring.act(intent ?? carried!);
    lifecycle.sync();
    let chromeState: ChromeState | null = null;
    let frame = 0;
    const sample = () => {
      frame = 0;
      const visible = editing() || panel() !== null || railOpen() || fork() || (chromeState = chromeAfterSample(chromeState, {
        scrollY: Math.max(0, window.scrollY), viewportHeight: window.innerHeight, documentHeight: document.documentElement.scrollHeight,
      })).visible;
      chrome.classList.toggle(READER_CHROME_HIDDEN_CLASS, !visible);
      chrome.setAttribute('data-mx-reader-state', visible ? 'shown' : 'hidden');
    };
    const schedule = () => { if (!frame) frame = window.requestAnimationFrame(sample); };
    createEffect(on(editing, () => sample(), { defer: true }));
    window.addEventListener('scroll', schedule, { passive: true });
    window.addEventListener('resize', schedule);
    sample();
    const liveId = document.body.getAttribute('data-mx-live-id');
    const editId = document.body.getAttribute('data-mx-live-edit');
    const stopLive = !framedAt && !islands && liveId && editId && typeof EventSource === 'function' ? startIslandLive(window, liveId, editId) : null;
    const stopIdle = editable() ? whenIdle(prefetchEditor) : null;
    onCleanup(() => { wiring.dispose(); window.removeEventListener('hashchange', lifecycle.sync); window.removeEventListener('scroll', schedule); window.removeEventListener('resize', schedule); window.cancelAnimationFrame(frame); stopLive?.(); stopIdle?.(); sharing.dispose(); runtimeRef.current = null;
      // The route is leaving this (already-adopted) document: `clearInitialStory` never runs for it
      // (`adoptReaderDocument` nulled `initialStory` on the way in), so this is the one place its own
      // served head sheets — data-mx-story-css chief among them — get removed with it.
      removeServedHeadStyles(); });
  });
  const accountSession = () => page?.kind === 'account' || session()?.kind === 'account';
  const currentVersion = () => page?.archived?.version ?? live()?.version ?? page?.surface?.version ?? 0;
  const shownTitle = () => live()?.title ?? page?.surface?.title ?? page?.surface?.heading ?? 'Untitled';
  createEffect(() => { if (socialPreviewOpen() && !editorPart()) void loadEditorPart(); });
  const placePanel = (element: HTMLElement) => createEffect(() => {
    if (editing()) element.style.setProperty('top', `${APP_BAR_H + EDIT_BAR_H + 8}px`, 'important');
    else element.style.removeProperty('top');
  });
  const sharingContent = () => <div class="mx-auto max-w-3xl space-y-6">
    <DocumentSharing id={id!} title={shownTitle()} owner={isOwner()} editable variant="embedded" version={currentVersion()} onSocialPreview={() => setSocialPreviewOpen(true)} />
    <Show when={page?.surface?.membershipAvailable}><hr class="border-edge" />
    <DocumentPeople id={id!} initialOpen revision={membershipRevision()} onChange={() => setMembershipRevision((n) => n + 1)} /></Show>
  </div>;
  return <Show when={id && page} fallback={<NotFoundPage />}>
    <div ref={host} aria-label="Artifact viewport" />
    {/* First in document order: lib/islands/trusted-portal hands its portal to every popover, tooltip and dialog. */}
    <TrustedUi overlay layer="navigation">
      <Show when={page?.surface?.pwaEnabled}><InstallArtifact id={id!} title={page?.surface?.title ?? 'Untitled artifact'} /></Show>
      <style>{PANEL_CSS}</style>
      <Show when={panel()}>
        <Show when={panel() === 'controls'} fallback={<button type="button" aria-label="Close the menu" onClick={() => setPanel(null)} class={`fixed inset-0 z-40 cursor-default border-0 p-0 ${phone() ? 'bg-black/25' : 'bg-transparent'}`} />}>
          <button type="button" aria-label="Close page controls" class="mx-reader-scrim" onClick={() => setPanel(null)} />
        </Show>
        <Show when={panel() === 'controls'}><section role="dialog" aria-label="Artifact controls" class="mx-reader-panel mx-reader-panel--controls" ref={placePanel}><div style={{ display: 'flex', 'align-items': 'center', 'justify-content': 'space-between' }}><h2>artifact controls</h2><button type="button" aria-label="Dismiss artifact controls" onClick={() => setPanel(null)} class="-mt-3 inline-flex h-6 w-6 cursor-pointer items-center justify-center rounded-[3px] text-muted hover:bg-raised hover:text-fg"><X size={14} /></button></div><h3>appearance</h3><div class="mx-reader-modes" role="group" aria-label="Color mode"><button type="button" aria-label="Light mode" aria-pressed={mode() === 'light'} onClick={() => chooseMode('light')}><Sun size={14} />light</button><button type="button" aria-label="Dark mode" aria-pressed={mode() === 'dark'} onClick={() => chooseMode('dark')}><Moon size={14} />dark</button></div>
          <DocumentActions pwaEnabled={page?.surface?.pwaEnabled} membershipAvailable={page?.surface?.membershipAvailable} id={id!} title={shownTitle()} version={currentVersion()} archived={archivedNow()}
            owner={isOwner() && !editing()} canEdit={editable() && !editing()} canAnnotate={annotatable()} accountSession={accountSession()}
            like={page?.like ?? { liked: false, count: 0 }} commentsOpen={railOpen()} onCommentsChange={(open) => { setPanel(null); setRailOpen(open); }}
            openAnnotations={openAnnotationCount()} forkedFrom={page?.surface?.author?.forkedFrom ?? null} hideFork
            onEdit={() => { setPanel(null); enterEdit(); }}
            onShare={() => { setPanel(null); setSharingOpen(true); }}
            onDeleted={isOwner() ? () => window.location.assign('/') : undefined} />
        </section></Show>
        <Show when={panel() === 'menu'}><PageMenuPanel dropdown phone={phone()} top={editing() ? APP_BAR_H + EDIT_BAR_H + 8 : undefined} close={() => setPanel(null)} /></Show>
        <Show when={panel() === 'notifications'}><NotificationsPanel close={() => setPanel(null)} /></Show>
      </Show>
      <Show when={fork() && id}><ForkConfirm id={id!} title={page?.surface?.title ?? 'this artifact'} onClose={() => setFork(false)} /></Show>
    </TrustedUi>
    <TrustedUi overlay layer="discussion">
    <Show when={ready() && nonce()}>
      <SelectionActions runtimeRef={runtimeRef} nonce={nonce()} canEdit={editable()} canAnnotate={annotatable()} editing={editing()}
        onEdit={(path) => beginEdit(path)} onAnnotate={(selection) => setInitialAnnotationSelection(selection)} />
    </Show>
    <Show when={ready() && annotatable() && id}>
      <AnnotationLayer id={id!} backend={backend ?? undefined} editId={editorPart()?.editId ?? page?.surface?.editId} runtimeRef={runtimeRef} sessionNonce={nonce()}
        railOpen={railOpen()} onRailOpenChange={setRailOpen} showViewComments={annotatable()} liveAnnotations={liveAnnotations()}
        initialSelection={initialAnnotationSelection()} onSelectionConsumed={() => setInitialAnnotationSelection(null)}
        pickOnOpen={!editing()} onAnnotationsChange={setAnnotationItems}
        topOffset={(phone() ? 0 : APP_BAR_H) + (editing() ? EDIT_BAR_H : 0)}
        railHost={editing() && wide() ? commentsHost() : undefined}
        railSheet={editing() && !wide()}
        panelWidth={editing() && wide() ? editorRightInset() : undefined} />
    </Show>
    <Show when={ready() && editing()}>
      <EditEntryChrome top={phone() ? 0 : APP_BAR_H} mode={mode()} panelWidth={wide() ? editorRightInset() : 0}
        skeleton={!editorMounted()} loading={!editorReady() && !editorPartFailed()} />
    </Show>
    <Show when={ready() && !editing() && restoring()}>
      <EditEntryChrome top={phone() ? 0 : APP_BAR_H} mode={mode()} panelWidth={0} skeleton={false} loading leaving />
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
          onTitleChange={(title) => { editorTitle = title; }} />
      </Suspense>
    </Show>
    <Show when={sharingOpen() && id}>
      <DocumentSharing id={id!} title={shownTitle()} owner={isOwner()} editable={editable()} variant="dialog" version={currentVersion()}
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
