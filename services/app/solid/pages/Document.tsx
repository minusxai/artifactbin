/* @jsxImportSource solid-js */
import { createSignal, For, onCleanup, onMount, Show, type JSX } from 'solid-js';
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
import { readAnnotationPages } from '@/lib/annotation-pages';
import type { AnnotationWire } from '@/lib/annotations';

interface DocumentAnswer { role: string; kind: string; surface?: { id: string; title: string | null; format: string; archived?: unknown; author?: { forkedFrom?: { label: string; href: string | null } | null } | null }; like?: { liked: boolean; count: number }; follow?: { userId: string; following: boolean; count: number } | null }

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
  const id = page?.surface?.id ?? /^\/a\/([^/]+)/.exec(location.pathname)?.[1] ?? null;
  const [ready, setReady] = createSignal(false);
  const [comments, setComments] = createSignal(false);
  const [threads, setThreads] = createSignal<AnnotationWire[] | null>(null);
  const [commentError, setCommentError] = createSignal(false);
  const [panel, setPanel] = createSignal<'controls' | 'menu' | null>(null);
  const [fork, setFork] = createSignal(false);
  const [busy, setBusy] = createSignal(false);
  const [forkError, setForkError] = createSignal<string | null>(null);
  const [mode, setMode] = createSignal<'light' | 'dark'>('light');
  let forkInFlight = false;
  const commentsAbort = new AbortController();
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
        if (page.kind !== 'account' && session()?.kind !== 'account') { window.location.assign(loginHref(window.location, 'comment')); return; }
        const open = !comments();
        setComments(open);
        if (open) void readAnnotationPages(`/api/my/artifacts/${encodeURIComponent(id)}/annotations`, { signal: commentsAbort.signal })
          .then((rows) => { setThreads(rows); setCommentError(false); })
          .catch(() => { if (!commentsAbort.signal.aborted) setCommentError(true); });
      } else if (name === 'fork') setFork(true);
      else if (name === 'share') void sharing.share();
      else if (name === 'notifications') window.location.assign('/notifications');
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
      const visible = panel() !== null || comments() || fork() || (chromeState = chromeAfterSample(chromeState, {
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
    onCleanup(() => { commentsAbort.abort(); chrome.removeEventListener('click', click); window.removeEventListener('keydown', escape); window.removeEventListener('scroll', schedule); window.removeEventListener('resize', schedule); window.cancelAnimationFrame(frame); stopLive?.(); sharing.dispose(); islandDocumentOf(story)?.dispose(); });
  });
  const forkNow = async () => {
    if (!id || forkInFlight) return;
    if (page?.kind !== 'account' && session()?.kind !== 'account') { window.location.assign(loginHref(window.location, 'fork')); return; }
    forkInFlight = true;
    setBusy(true);
    try {
      const response = await fetch(`/api/my/artifacts/${id}/fork`, { method: 'POST', credentials: 'same-origin' });
      const answer = await response.json().catch(() => ({})) as { url?: string; error?: string; details?: string[] };
      if (response.status === 201 && answer.url) { const copy = new URL(answer.url, window.location.href); window.location.assign(copy.pathname + copy.search); return; }
      setForkError(answer.details?.join(' ') ?? answer.error ?? `Could not fork (${response.status}).`);
    } catch { setForkError('Could not fork. Retry.'); }
    finally { forkInFlight = false; setBusy(false); }
  };
  return <Show when={id && page} fallback={<NotFoundPage />}>
    <div ref={host} aria-label="Artifact viewport" />
    <Show when={panel()}>
      <button type="button" aria-label="Close page controls" class="mx-reader-scrim" onClick={() => setPanel(null)} />
      <Show when={panel() === 'controls'}><section aria-label="Artifact controls" class="mx-reader-panel mx-reader-panel--controls"><h2>artifact controls</h2><h3>appearance</h3><div class="mx-reader-modes" role="group" aria-label="Color mode"><button type="button" aria-label="Light mode" aria-pressed={mode() === 'light'} onClick={() => chooseMode('light')}>light</button><button type="button" aria-label="Dark mode" aria-pressed={mode() === 'dark'} onClick={() => chooseMode('dark')}>dark</button></div><Show when={page?.surface?.author?.forkedFrom}><h3>this document</h3><span class="mx-reader-forked" data-mx-forked-from>forked from <Show when={page?.surface?.author?.forkedFrom?.href} fallback={page?.surface?.author?.forkedFrom?.label}><a href="#" aria-label="Open the artifact this was forked from" onClick={(event) => { event.preventDefault(); const path = readerProvenancePath(page?.surface?.author?.forkedFrom?.href); if (path) window.location.pathname = path; }}>{page?.surface?.author?.forkedFrom?.label}</a></Show></span></Show></section></Show>
      <Show when={panel() === 'menu'}><nav aria-label="Menu" class="mx-reader-panel mx-reader-panel--menu"><a class="mx-reader-brand" href="/"><img src="/logo-128.png" alt="" />artifactbin</a><a href="/">Artifacts</a><a href="/account">Account</a><a href="/docs-human">Human Docs</a></nav></Show>
    </Show>
    <Show when={ready() && comments()}><aside aria-label="Comments" class="fixed right-0 top-12 z-50 max-h-[80vh] w-80 overflow-auto border border-edge bg-surface p-4 shadow-xl"><button type="button" aria-label="Close comments" onClick={() => setComments(false)}>Close</button><h2>Comments</h2><Show when={commentError()}><p role="alert">Could not load comments.</p></Show><Show when={threads() === null && !commentError()}><p role="status">Loading comments…</p></Show><Show when={threads()?.length === 0}><p>No open comments.</p></Show><For each={threads() ?? []}>{thread => <article class="mt-4 border-t border-edge pt-3"><p class="text-xs text-muted">{thread.snippet}</p><For each={thread.thread}>{comment => <p class="mt-2 text-sm">{comment.body}</p>}</For></article>}</For></aside></Show>
    <Show when={fork()}><div role="dialog" aria-label="Fork this artifact?" class="fixed inset-0 z-50 flex items-center justify-center bg-black/40"><div class="rounded border border-edge bg-surface p-6"><h2>Fork this artifact?</h2><p>A copy of “{page?.surface?.title ?? 'this artifact'}” will be added to your artifacts.</p><Show when={forkError()}><p role="alert">{forkError()}</p></Show><button type="button" aria-label="Cancel fork" onClick={() => setFork(false)}>Cancel</button><button type="button" aria-label="Confirm fork" disabled={busy()} onClick={() => void forkNow()}>Fork and open copy</button></div></div></Show>
  </Show>;
}
