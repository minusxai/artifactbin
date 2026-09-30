/* @jsxImportSource solid-js */
import { createEffect, createSignal, lazy, on, onCleanup, onMount, Show, Suspense, untrack, type JSX } from 'solid-js';
import { useLocation } from '@solidjs/router';
import { startIslandLive } from '@/lib/islands/live';
import { islandDocumentOf } from '@/lib/islands/handover';
import { PAGE_TAKEOVER_EVENT } from '@/lib/islands/page-lifetime';
import { reloadKeepingPlace } from '@/lib/islands/live-update';
import { applyReaderChoice } from '@/lib/story-runtime/reader-chrome-actions';
import { chromeAfterSample, type ChromeState } from '@/lib/story-runtime/reader-chrome-policy';
import { READER_CHROME_HIDDEN_CLASS } from '@/lib/story/reader-chrome';
import { wireReaderSharing } from '@/lib/story-runtime/reader-share';
import { currentAnchor } from '@/lib/story-runtime/anchor';
import { writeReloadAnchor } from '@/lib/story-runtime/reader-mode';
import type { ScrollAnchor } from '@/lib/story/scroll-anchor';
import { STORY_DATA_MESSAGE, STORY_DOCUMENT_MESSAGE, STORY_READER_MODE_MESSAGE, type StoryEditSelection } from '@/lib/story-runtime/contract';
import type { DocumentRuntimeRef } from '@/lib/story-runtime/document-endpoint';
import type { ServedStoryRuntime } from '@/lib/story/prepared-runtime';
import type { DocumentGraph } from '@artifactbin/contracts';
import { createHttpBackend } from '@/lib/artifact-backend/http';
import { loginHref } from '../shared/login-href';
import { takeBootstrap } from '@/web/bootstrap';
import { takeChromeIntent } from '@/web/idle-boot';
import { adoptInitialStory } from '@/web/initial-story';
import { useSession } from '../web/session';
import { NotFoundPage } from './NotFound';
import type { AnnotationWire } from '@/lib/annotations';
import { canAnnotate as canAnnotateRole, canEdit as canEditRole, canGovern, type ArtifactRole } from '@/lib/share-roles';
import { DocumentActions } from '../document/DocumentActions';
import { AnnotationLayer } from '../document/AnnotationLayer';
import { SelectionActions } from '../document/SelectionActions';
import { ForkConfirm } from '../document/ForkArtifact';
import { DocumentSharing } from '../document/DocumentSharing';
import { DocumentPeople } from '../document/DocumentPeople';
import { createIslandStory, type IslandStory } from '../document/create-island-story';
import { moveInto } from '@/lib/story-runtime/island-controller';
import { createLiveArtifact } from '../editor/create-live-artifact';
import { createWideEditViewport, editPanelWidth, readEditPanelCollapsed } from '../editor/create-edit-panel';
import { createIsPhoneViewport } from '../components/MobileSheet';
import { panelFitsInMargin } from '@/lib/story/edit-panel-fit';
import { APP_BAR_H, EDIT_BAR_H, RIGHT_RAIL_W } from '@/lib/story/edit-bar';
import { ARTIFACT_ID_PATTERN } from '@artifactbin/contracts';
import type { EditorArtifact } from '../editor/InPlaceEditor';
import { TrustedUi } from '../components/TrustedUi';
import { NotificationsPanel, PageMenuPanel } from '../components/PageChrome';
import Sun from 'lucide-solid/icons/sun';
import Moon from 'lucide-solid/icons/moon';
import X from 'lucide-solid/icons/x';
import { STORY_CHROME_CSS } from '@/lib/story-runtime/chrome-css';

/** The page panels wear the reader chrome's own sheet; inside the trusted root they need its tokens too. */
const PANEL_CSS = `${STORY_CHROME_CSS}
.mx-reader-panel, .mx-reader-scrim { --mx-reader-bg: #ffffff; --mx-reader-fg: #1a2129; --mx-reader-muted: #5a6572; --mx-reader-border: #e1e6ea; --mx-reader-accent: #0e9d4f; --mx-reader-on-accent: #ffffff; --mx-reader-scheme: light; }
/* The app's panels never dim the document (React's PageControls did not); the scrim only catches the outside click. */
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
    heading?: string | null;
  };
  archived?: { version: number; head: number } | null;
  like?: { liked: boolean; count: number };
  follow?: { userId: string; following: boolean; count: number } | null;
}

/** THE EDITOR'S DOOR (lib/artifact-page `?part=editor`): what only writing needs. */
interface EditorPart { editId: string; version: number; source: string; document?: DocumentGraph; compiledCss: string | null; authorCss: string | null }

export function readerProvenancePath(href: string | null | undefined): string | null {
  return href && /^\/(?:a\/[^/?#]+|@[^/?#]+\/[^/?#]+)$/.test(href) ? href : null;
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
const READING_ONLY = '[data-mx-reader-action="share"],[data-mx-reader-action="like"],[data-mx-reader-action="comment"],[data-mx-reader-action="fork"],[data-mx-reader-action="membership"],[data-mx-github-star]';

/** Put the served chrome in (or out of) edit mode; answers the breadcrumb slot the title editor renders into. */
export function markChromeEditing(chrome: HTMLElement, editing: boolean, titleSlot: boolean): HTMLElement | null {
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
  if (title.hasAttribute('data-mx-title-editor')) {
    title.removeAttribute('data-mx-title-editor');
    title.textContent = title.getAttribute('data-mx-title-text') ?? '';
  }
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
  const [ready, setReady] = createSignal(false);
  const [railOpen, setRailOpen] = createSignal(false);
  const [annotationItems, setAnnotationItems] = createSignal<AnnotationWire[] | null>(null);
  const [liveAnnotations, setLiveAnnotations] = createSignal<AnnotationWire[] | null>(null);
  const openAnnotationCount = () => (annotationItems() ?? liveAnnotations())?.filter((row) => row.status === 'open').length ?? page?.surface?.openAnnotations ?? 0;
  const [panel, setPanel] = createSignal<'controls' | 'menu' | 'notifications' | null>(null);
  const [fork, setFork] = createSignal(false);
  const [mode, setMode] = createSignal<'light' | 'dark'>('light');
  const [editing, setEditing] = createSignal(false);
  const [initialEditSelectionPath, setInitialEditSelectionPath] = createSignal<string | null>(null);
  const [initialAnnotationSelection, setInitialAnnotationSelection] = createSignal<StoryEditSelection | null>(null);
  const [titleHost, setTitleHost] = createSignal<HTMLElement | null>(null);
  const [commentsHost, setCommentsHost] = createSignal<HTMLElement | null>(null);
  const [editorRightInset, setEditorRightInset] = createSignal(0);
  const [panelFits, setPanelFits] = createSignal<boolean | null>(null);
  const [sharingOpen, setSharingOpen] = createSignal(false);
  const [socialPreviewOpen, setSocialPreviewOpen] = createSignal(false);
  const [editorPart, setEditorPart] = createSignal<EditorPart | null>(null);
  const [editorPartFailed, setEditorPartFailed] = createSignal(false);
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
  let pushedEdit = false;
  let draining = false;
  let editedCompiledPage = false;
  let exitAnchor: ScrollAnchor | null = null;
  let exitScroll: number | null = null;
  const pendingData: string[] = [];

  const chooseMode = (next: 'light' | 'dark') => {
    // One reader choice, two surfaces: the app shell (its stored preference) and the document.
    if (next === 'dark') document.documentElement.dataset.theme = 'dark';
    else delete document.documentElement.dataset.theme;
    try { localStorage.setItem('mx_theme', next); } catch { /* private mode */ }
    applyReaderChoice(window, document, next);
    adoptedStory?.classList.toggle('dark', next === 'dark');
    adoptedStory?.classList.toggle('light', next !== 'dark');
    runtimeRef.current?.send({ type: STORY_READER_MODE_MESSAGE, mode: next });
    setMode(next);
  };

  // ── the editor's door: fetched on idle for a writer, or the moment edit mode opens ──
  let editorPartRequest: Promise<EditorPart | null> | null = null;
  const loadEditorPart = (): Promise<EditorPart | null> => {
    if (!id || !editable()) return Promise.resolve(null);
    return editorPartRequest ??= fetch(`/api/page/artifact/${encodeURIComponent(id)}?part=editor`, { credentials: 'same-origin' })
      .then((response) => (response.ok ? response.json() as Promise<EditorPart> : null))
      .catch(() => null)
      .then((part) => {
        if (part) setEditorPart(part);
        else { editorPartRequest = null; setEditorPartFailed(true); }
        return part;
      });
  };

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

  // ── edit mode: a MODE of the one address, mirrored in `#edit` (and accepted as `/edit`) ──
  const editRoute = () => /\/edit\/?$/.test(window.location.pathname) || window.location.hash === '#edit';
  const beginEdit = (selectionPath: string | null) => {
    if (!editable() || window.location.hash === '#edit' || editing()) return;
    setInitialEditSelectionPath(selectionPath);
    window.history.pushState(window.history.state, '', window.location.pathname + window.location.search + '#edit');
    pushedEdit = true;
    setEditing(true);
  };
  const enterEdit = () => beginEdit(null);
  const rememberPlace = () => {
    exitScroll = window.scrollY;
    exitAnchor = currentAnchor(window);
    if (exitAnchor) writeReloadAnchor(window, exitAnchor);
  };
  const drainEditor = async () => {
    const flush = editorFlush.current;
    if (!flush || draining) return;
    draining = true;
    await Promise.race([flush(), new Promise((resolve) => setTimeout(resolve, 3000))]).finally(() => { draining = false; });
  };
  const exitEdit = () => {
    setInitialEditSelectionPath(null);
    rememberPlace();
    if (pushedEdit) { pushedEdit = false; window.history.back(); return; }
    window.history.replaceState(window.history.state, '', window.location.pathname.replace(/\/edit\/?$/, '') + window.location.search);
    setEditing(false);
  };
  const finishEdit = async () => { await editorFlush.current?.(); exitEdit(); };
  const syncEditRoute = () => {
    if (editRoute()) { if (editable()) setEditing(true); return; }
    if (!editing()) return;
    rememberPlace();
    setInitialEditSelectionPath(null);
    if (!editorFlush.current || draining) { setEditing(false); return; }
    void drainEditor().finally(() => setEditing(false));
  };
  createEffect(on(editing, (now, before) => {
    if (now) { editedCompiledPage = true; void loadEditorPart(); return; }
    if (!before) return;
    island?.stopEditing();
    // The compiled islands were frozen for editing: return to the compiled page at the reader's place.
    if (!editedCompiledPage) return;
    const target = Math.max(0, (exitScroll ?? window.scrollY) - EDIT_BAR_H);
    const anchor = exitAnchor;
    const scrollFrame = requestAnimationFrame(() => {
      window.scrollTo(0, target);
      requestAnimationFrame(() => reloadKeepingPlace(window, anchor));
    });
    onCleanup(() => cancelAnimationFrame(scrollFrame));
  }, { defer: true }));
  createEffect(() => { if (page?.surface) document.title = editing() ? `${page.surface.title ?? page.surface.runtime?.title ?? 'Untitled'} [edit mode]` : document.title.replace(/ \[edit mode\]$/, ''); });

  // The edit panel's width comes out of the document's margin, or its width — decided ONCE per session.
  createEffect(() => {
    if (!editing()) { setPanelFits(null); return; }
    if (!wide() || untrack(panelFits) !== null) return;
    let frame = 0; let frames = 0;
    const decide = () => {
      const root = host?.querySelector('[data-mx-inline-story]');
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
    host.style.paddingTop = `${(phone() ? 0 : APP_BAR_H) + (editing() ? EDIT_BAR_H : 0)}px`;
    host.style.paddingRight = railInset() ? `${railInset()}px` : '';
    host.style.paddingBottom = editing() && !wide() ? '50vh' : '';
  });
  createEffect(() => {
    if (!ready() || !chromeElement) return;
    setTitleHost(markChromeEditing(chromeElement, editing(), !phone()));
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
    island = createIslandStory({
      id, host, story, islands, nodes: page.surface?.runtime?.data.nodes ?? [],
      editId: () => editorPart()?.editId ?? page.surface?.editId ?? '',
      source: () => editorPart()?.source ?? null,
    });
    runtimeRef.current = island.controller();
    setNonce(island.nonce());
    if (pendingData.length) runtimeRef.current?.send({ type: STORY_DATA_MESSAGE, datasets: [...new Set(pendingData.splice(0))] });
    setReady(true);
    const sharing = wireReaderSharing(window, document, chrome);
    const action = async (name: string) => {
      if (name === 'controls' || name === 'menu') {
        const trigger = chrome.querySelector<HTMLElement>(`[data-mx-reader-trigger="${name}"]`);
        const expanded = panel() !== name;
        setPanel(expanded ? name : null);
        chrome.classList.remove(READER_CHROME_HIDDEN_CLASS);
        chrome.setAttribute('data-mx-reader-state', 'shown');
        trigger?.setAttribute('aria-expanded', String(expanded));
        trigger?.setAttribute('aria-label', `${expanded ? 'Close' : 'Open'} ${name === 'controls' ? 'artifact controls' : 'menu'}`);
      } else if (name === 'like' || name === 'follow') {
        if (page.kind !== 'account' && session()?.kind !== 'account') { window.location.assign(loginHref(window.location, name)); return; }
        const control = chrome.querySelector<HTMLElement>(`[data-mx-reader-action="${name}"]`);
        const on = control?.getAttribute(name === 'like' ? 'data-mx-liked' : 'data-mx-following') === 'true';
        const href = name === 'like' ? `/api/my/artifacts/${id}/like` : page.follow ? `/api/users/${page.follow.userId}/follow` : '';
        if (!href || href.includes('/undefined/')) return;
        const response = await fetch(href, { method: on ? 'DELETE' : 'POST', credentials: 'same-origin' }).catch(() => null);
        if (!response?.ok) return;
        const answer = await response.json() as { liked?: boolean; following?: boolean; count: number };
        const next = name === 'like' ? answer.liked : answer.following;
        control?.setAttribute(name === 'like' ? 'data-mx-liked' : 'data-mx-following', String(next));
        control?.setAttribute('aria-label', name === 'like' ? next ? 'Unlike' : 'Like' : `${next ? 'Unfollow' : 'Follow'} @${control.getAttribute('data-mx-author') ?? ''}`);
        const count = control?.querySelector('[data-mx-reader-count]'); if (count) count.textContent = answer.count > 0 ? String(answer.count) : '';
      } else if (name === 'comment') {
        if (!annotatable()) { window.location.assign(loginHref(window.location, 'comment')); return; }
        setRailOpen((open) => !open);
      } else if (name === 'fork') setFork(true);
      else if (name === 'share') { if (isOwner()) setSharingOpen(true); else void sharing.share(); }
      else if (name === 'notifications') setPanel((open) => (open === 'notifications' ? null : 'notifications'));
      else if (name === 'membership' || name === 'join') {
        // The rail's Join/Joined/Pending pill: joining needs an account; the people panel is where it happens.
        if (!accountSession()) { window.location.assign(loginHref(window.location, 'join')); return; }
        void action('controls');
      }
      else if (name === 'edit' && editable()) { if (editing()) void finishEdit(); else enterEdit(); }
    };
    const click = (event: MouseEvent) => {
      const target = (event.target as Element).closest<HTMLElement>('[data-mx-reader-action],[data-mx-reader-trigger],[data-mx-mode-choice]');
      if (!target || !chrome.contains(target)) return;
      if (target.closest('[data-mx-title-editor]')) return;
      event.preventDefault();
      const choice = target.getAttribute('data-mx-mode-choice');
      if (choice === 'light' || choice === 'dark') { chooseMode(choice); return; }
      void action(target.getAttribute('data-mx-reader-action') ?? target.getAttribute('data-mx-reader-trigger') ?? '');
    };
    chrome.addEventListener('click', click);
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') setPanel(null); };
    // The rail's triggers say whether their panel is open, however it closed (scrim, Escape, an action inside it).
    createEffect(() => {
      const open = panel();
      for (const name of ['controls', 'menu'] as const) {
        const trigger = chrome.querySelector<HTMLElement>(`[data-mx-reader-trigger="${name}"]`);
        trigger?.setAttribute('aria-expanded', String(open === name));
        trigger?.setAttribute('aria-label', `${open === name ? 'Close' : 'Open'} ${name === 'controls' ? 'artifact controls' : 'menu'}`);
      }
    });
    window.addEventListener('keydown', escape);
    window.addEventListener('hashchange', syncEditRoute);
    const intent = takeChromeIntent();
    const address = new URL(window.location.href);
    const carried = address.searchParams.get('intent');
    if (carried) {
      address.searchParams.delete('intent');
      window.history.replaceState(window.history.state, '', address.pathname + address.search + address.hash);
    }
    if (intent || carried) void action(intent ?? carried!);
    syncEditRoute();
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
    const stopLive = !islands && liveId && editId && typeof EventSource === 'function' ? startIslandLive(window, liveId, editId) : null;
    const stopIdle = editable() ? whenIdle(() => { void loadEditorPart(); void import('../editor/ArtifactEditor').catch(() => {}); }) : null;
    onCleanup(() => { chrome.removeEventListener('click', click); window.removeEventListener('keydown', escape); window.removeEventListener('hashchange', syncEditRoute); window.removeEventListener('scroll', schedule); window.removeEventListener('resize', schedule); window.cancelAnimationFrame(frame); stopLive?.(); stopIdle?.(); sharing.dispose(); runtimeRef.current = null; });
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
    <hr class="border-edge" />
    <DocumentPeople id={id!} initialOpen revision={membershipRevision()} onChange={() => setMembershipRevision((n) => n + 1)} />
  </div>;
  return <Show when={id && page} fallback={<NotFoundPage />}>
    <div ref={host} aria-label="Artifact viewport" />
    {/* First in document order: lib/islands/trusted-portal hands its portal to every popover, tooltip and dialog. */}
    <TrustedUi overlay layer="navigation">
      <style>{PANEL_CSS}</style>
      <Show when={panel()}>
        <Show when={panel() === 'controls'} fallback={<button type="button" aria-label="Close the menu" onClick={() => setPanel(null)} class={`fixed inset-0 z-40 cursor-default border-0 p-0 ${phone() ? 'bg-black/25' : 'bg-transparent'}`} />}>
          <button type="button" aria-label="Close page controls" class="mx-reader-scrim" onClick={() => setPanel(null)} />
        </Show>
        <Show when={panel() === 'controls'}><section role="dialog" aria-label="Artifact controls" class="mx-reader-panel mx-reader-panel--controls" ref={placePanel}><div style={{ display: 'flex', 'align-items': 'center', 'justify-content': 'space-between' }}><h2>artifact controls</h2><button type="button" aria-label="Dismiss artifact controls" onClick={() => setPanel(null)} class="-mt-3 inline-flex h-6 w-6 cursor-pointer items-center justify-center rounded-[3px] text-muted hover:bg-raised hover:text-fg"><X size={14} /></button></div><h3>appearance</h3><div class="mx-reader-modes" role="group" aria-label="Color mode"><button type="button" aria-label="Light mode" aria-pressed={mode() === 'light'} onClick={() => chooseMode('light')}><Sun size={14} />light</button><button type="button" aria-label="Dark mode" aria-pressed={mode() === 'dark'} onClick={() => chooseMode('dark')}><Moon size={14} />dark</button></div>
          <DocumentActions id={id!} title={shownTitle()} version={currentVersion()} archived={archivedNow()}
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
    <Show when={ready() && editing() && backend && (editorSeed() || editorPartFailed())}>
      <Suspense fallback={null}>
        <ArtifactEditor id={id!} backend={backend!} seed={editorSeed()} onExit={() => void finishEdit()} flushRef={editorFlush}
          runtimeRef={runtimeRef} sessionNonce={nonce()} initialSelectionPath={initialEditSelectionPath()}
          onComment={editable() ? (selection) => setInitialAnnotationSelection(selection) : undefined}
          onRightInsetChange={setEditorRightInset}
          commentsOpen={railOpen()} onCommentsOpenChange={annotatable() ? setRailOpen : undefined}
          onCommentsHost={setCommentsHost} titleHost={phone() ? null : titleHost()}
          sharingContent={sharingContent} />
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
