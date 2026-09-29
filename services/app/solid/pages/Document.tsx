/* @jsxImportSource solid-js */
import { createSignal, onCleanup, onMount, Show, type JSX } from 'solid-js';
import { useLocation } from '@solidjs/router';
import { startIslandLive } from '@/lib/islands/live';
import { islandDocumentOf } from '@/lib/islands/handover';
import { PAGE_TAKEOVER_EVENT } from '@/lib/islands/page-lifetime';
import { applyReaderChoice } from '@/lib/story-runtime/reader-chrome-actions';
import { chromeAfterSample, type ChromeState } from '@/lib/story-runtime/reader-chrome-policy';
import { READER_CHROME_HIDDEN_CLASS } from '@/lib/story/reader-chrome';
import { wireReaderSharing } from '@/lib/story-runtime/reader-share';
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
import { ForkConfirm } from '../document/ForkArtifact';
import { APP_BAR_H } from '@/lib/story/edit-bar';
import { ARTIFACT_ID_PATTERN } from '@artifactbin/contracts';

interface DocumentAnswer {
  role: ArtifactRole; kind: string;
  surface?: {
    id: string; title: string | null; format: string; version: number;
    openAnnotations?: number; accountSession?: boolean; anonSession?: boolean;
    author?: { forkedFrom?: { label: string; href: string | null } | null } | null;
  };
  archived?: { version: number; head: number } | null;
  like?: { liked: boolean; count: number };
  follow?: { userId: string; following: boolean; count: number } | null;
}

export function readerProvenancePath(href: string | null | undefined): string | null {
  return href && /^\/(?:a\/[^/?#]+|@[^/?#]+\/[^/?#]+)$/.test(href) ? href : null;
}

/** Move the server's existing nodes; the island document and its listeners retain identity. */
export function adoptReaderDocument(host: HTMLElement): { story: HTMLElement | null; chrome: HTMLElement | null } {
  const chrome = Array.from(document.body.children).find((child): child is HTMLElement => child instanceof HTMLElement && child.hasAttribute('data-mx-reader-chrome')) ?? null;
  if (chrome) host.append(chrome);
  const story = adoptInitialStory() ?? Array.from(document.body.children).find((child): child is HTMLElement => child instanceof HTMLElement && child.hasAttribute('data-mx-inline-story')) ?? null;
  if (story) {
    if (story.parentElement === document.body) window.dispatchEvent(new Event(PAGE_TAKEOVER_EVENT));
    host.append(story);
    document.getElementById('root')?.removeAttribute('hidden');
  }
  return { story, chrome };
}

/** The admitted reader page. Chrome stays the server-rendered variant so names and geometry agree. */
export function DocumentPage(): JSX.Element {
  const location = useLocation();
  const { session } = useSession();
  const page = takeBootstrap<DocumentAnswer>(location.pathname, 'artifact');
  // Both sources ultimately come back off DOM text (the embedded bootstrap script, or the URL the
  // browser is showing), so every consumer downstream — including an <a href> — sees only a value
  // that has passed the artifact id's own allowlisted shape.
  const rawId = page?.surface?.id ?? /^\/a\/([^/]+)/.exec(location.pathname)?.[1] ?? null;
  const id = rawId && ARTIFACT_ID_PATTERN.test(rawId) ? rawId : null;
  const role = () => page?.role ?? 'viewer';
  const archivedNow = () => !!page?.archived;
  const isOwner = () => canGovern(role()) && !archivedNow();
  const editable = () => canEditRole(role()) && !archivedNow();
  const annotatable = () => canAnnotateRole(role()) && !archivedNow();
  const [ready, setReady] = createSignal(false);
  const [railOpen, setRailOpen] = createSignal(false);
  const [annotationItems, setAnnotationItems] = createSignal<AnnotationWire[] | null>(null);
  const openAnnotationCount = () => annotationItems()?.filter((row) => row.status === 'open').length ?? page?.surface?.openAnnotations ?? 0;
  const [panel, setPanel] = createSignal<'controls' | 'menu' | null>(null);
  const [fork, setFork] = createSignal(false);
  const [mode, setMode] = createSignal<'light' | 'dark'>('light');
  /** Edit mode is still React's (the Solid editor runtime is not wired up yet): hand off to /a/<id>/edit. */
  const goToEdit = () => window.location.assign(location.pathname.replace(/\/edit$/, '') + '/edit');
  let adoptedStory: HTMLElement | null = null;
  let host!: HTMLDivElement;
  const chooseMode = (next: 'light' | 'dark') => {
    applyReaderChoice(window, document, next);
    adoptedStory?.classList.toggle('dark', next === 'dark');
    adoptedStory?.classList.toggle('light', next !== 'dark');
    setMode(next);
  };
  onMount(() => {
    if (!page) return;
    const { story, chrome } = adoptReaderDocument(host);
    if (!story || !chrome || !id) { window.location.replace(location.pathname + location.search + location.hash); return; }
    adoptedStory = story;
    setMode(story.classList.contains('dark') ? 'dark' : 'light');
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
      else if (name === 'share') void sharing.share();
      else if (name === 'notifications') window.location.assign('/notifications');
      else if (name === 'edit' && editable()) goToEdit();
    };
    const click = (event: MouseEvent) => {
      const target = (event.target as Element).closest<HTMLElement>('[data-mx-reader-action],[data-mx-reader-trigger],[data-mx-mode-choice]');
      if (!target || !chrome.contains(target)) return;
      event.preventDefault();
      const mode = target.getAttribute('data-mx-mode-choice');
      if (mode === 'light' || mode === 'dark') { chooseMode(mode); return; }
      void action(target.getAttribute('data-mx-reader-action') ?? target.getAttribute('data-mx-reader-trigger') ?? '');
    };
    chrome.addEventListener('click', click);
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') setPanel(null); };
    window.addEventListener('keydown', escape);
    const intent = takeChromeIntent();
    const address = new URL(window.location.href);
    const carried = address.searchParams.get('intent');
    if (carried) {
      address.searchParams.delete('intent');
      window.history.replaceState(window.history.state, '', address.pathname + address.search + address.hash);
    }
    if (intent || carried) void action(intent ?? carried!);
    let chromeState: ChromeState | null = null;
    let frame = 0;
    const sample = () => {
      frame = 0;
      const visible = panel() !== null || railOpen() || fork() || (chromeState = chromeAfterSample(chromeState, {
        scrollY: Math.max(0, window.scrollY), viewportHeight: window.innerHeight, documentHeight: document.documentElement.scrollHeight,
      })).visible;
      chrome.classList.toggle(READER_CHROME_HIDDEN_CLASS, !visible);
      chrome.setAttribute('data-mx-reader-state', visible ? 'shown' : 'hidden');
    };
    const schedule = () => { if (!frame) frame = window.requestAnimationFrame(sample); };
    window.addEventListener('scroll', schedule, { passive: true });
    window.addEventListener('resize', schedule);
    sample();
    const liveId = document.body.getAttribute('data-mx-live-id');
    const editId = document.body.getAttribute('data-mx-live-edit');
    const stopLive = !islandDocumentOf(story) && liveId && editId && typeof EventSource === 'function' ? startIslandLive(window, liveId, editId) : null;
    onCleanup(() => { chrome.removeEventListener('click', click); window.removeEventListener('keydown', escape); window.removeEventListener('scroll', schedule); window.removeEventListener('resize', schedule); window.cancelAnimationFrame(frame); stopLive?.(); sharing.dispose(); islandDocumentOf(story)?.dispose(); });
  });
  const accountSession = () => page?.kind === 'account' || session()?.kind === 'account';
  const currentVersion = () => page?.archived?.version ?? page?.surface?.version ?? 0;
  return <Show when={id && page} fallback={<NotFoundPage />}>
    <div ref={host} aria-label="Artifact viewport" />
    <Show when={panel()}>
      <button type="button" aria-label="Close page controls" class="mx-reader-scrim" onClick={() => setPanel(null)} />
      <Show when={panel() === 'controls'}><section aria-label="Artifact controls" class="mx-reader-panel mx-reader-panel--controls"><h2>artifact controls</h2><h3>appearance</h3><div class="mx-reader-modes" role="group" aria-label="Color mode"><button type="button" aria-label="Light mode" aria-pressed={mode() === 'light'} onClick={() => chooseMode('light')}>light</button><button type="button" aria-label="Dark mode" aria-pressed={mode() === 'dark'} onClick={() => chooseMode('dark')}>dark</button></div>
        <DocumentActions id={id!} title={page?.surface?.title ?? 'Untitled'} version={currentVersion()} archived={archivedNow()}
          owner={isOwner()} canEdit={editable()} canAnnotate={annotatable()} accountSession={accountSession()}
          like={page?.like ?? { liked: false, count: 0 }} commentsOpen={railOpen()} onCommentsChange={(open) => { setPanel(null); setRailOpen(open); }}
          openAnnotations={openAnnotationCount()} forkedFrom={page?.surface?.author?.forkedFrom ?? null} hideFork
          onEdit={goToEdit}
          onDeleted={isOwner() ? () => window.location.assign('/') : undefined} />
      </section></Show>
      <Show when={panel() === 'menu'}><nav aria-label="Menu" class="mx-reader-panel mx-reader-panel--menu"><a class="mx-reader-brand" href="/"><img src="/logo-128.png" alt="" />artifactbin</a><a href="/">Artifacts</a><a href="/account">Account</a><a href="/docs-human">Human Docs</a></nav></Show>
    </Show>
    <Show when={ready() && annotatable() && id}>
      <AnnotationLayer id={id!} railOpen={railOpen()} onRailOpenChange={setRailOpen} showViewComments={annotatable()}
        pickOnOpen={false} onAnnotationsChange={setAnnotationItems} topOffset={APP_BAR_H} />
    </Show>
    <Show when={fork() && id}><ForkConfirm id={id!} title={page?.surface?.title ?? 'this artifact'} onClose={() => setFork(false)} /></Show>
  </Show>;
}
