/* @jsxImportSource solid-js */
import { createSignal, onCleanup, onMount, Show, type JSX } from 'solid-js';
import { useLocation } from '@solidjs/router';
import { startIslandLive } from '@/lib/islands/live';
import { islandDocumentOf } from '@/lib/islands/handover';
import { PAGE_TAKEOVER_EVENT } from '@/lib/islands/page-lifetime';
import { applyReaderChoice } from '@/lib/story-runtime/reader-chrome-actions';
import { wireReaderSharing } from '@/lib/story-runtime/reader-share';
import { loginHref } from '../shared/login-href';
import { takeBootstrap } from '@/web/bootstrap';
import { takeChromeIntent } from '@/web/idle-boot';
import { adoptInitialStory } from '@/web/initial-story';
import { useSession } from '../web/session';
import { NotFoundPage } from './NotFound';

interface DocumentAnswer { role: string; surface?: { id: string; title: string | null; format: string; like?: { liked: boolean; count: number }; archived?: unknown }; like?: { liked: boolean; count: number } }

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
  const [fork, setFork] = createSignal(false);
  const [busy, setBusy] = createSignal(false);
  const [forkError, setForkError] = createSignal<string | null>(null);
  let forkInFlight = false;
  let host!: HTMLDivElement;
  onMount(() => {
    if (!page) return;
    const { story, chrome } = adoptReaderDocument(host);
    if (!story || !chrome || !id) { window.location.replace(location.pathname + location.search + location.hash); return; }
    setReady(true);
    const sharing = wireReaderSharing(window, document, chrome);
    const action = async (name: string) => {
      if (name === 'controls' || name === 'menu') {
        const open = chrome.querySelector<HTMLElement>(`[data-mx-reader-panel="${name}"]`);
        const trigger = chrome.querySelector<HTMLElement>(`[data-mx-reader-trigger="${name}"]`);
        if (open && trigger) { const expanded = trigger.getAttribute('aria-expanded') !== 'true'; open.hidden = !expanded; trigger.setAttribute('aria-expanded', String(expanded)); trigger.setAttribute('aria-label', `${expanded ? 'Close' : 'Open'} ${name === 'controls' ? 'artifact controls' : 'menu'}`); }
      } else if (name === 'like' || name === 'follow') {
        if (session()?.kind !== 'account') { window.location.assign(loginHref(window.location, name)); return; }
        const control = chrome.querySelector<HTMLElement>(`[data-mx-reader-action="${name}"]`);
        const on = control?.getAttribute(name === 'like' ? 'data-mx-liked' : 'data-mx-following') === 'true';
        const href = name === 'like' ? `/api/my/artifacts/${id}/like` : page?.surface ? `/api/users/${(page as { follow?: { userId: string } }).follow?.userId}/follow` : '';
        if (!href || href.includes('/undefined/')) return;
        const response = await fetch(href, { method: on ? 'DELETE' : 'POST', credentials: 'same-origin' }).catch(() => null);
        if (!response?.ok) return;
        const answer = await response.json() as { liked?: boolean; following?: boolean; count: number };
        const next = name === 'like' ? answer.liked : answer.following;
        control?.setAttribute(name === 'like' ? 'data-mx-liked' : 'data-mx-following', String(next));
        control?.setAttribute('aria-label', name === 'like' ? next ? 'Unlike' : 'Like' : `${next ? 'Unfollow' : 'Follow'} @${control.getAttribute('data-mx-author') ?? ''}`);
        const count = control?.querySelector('[data-mx-reader-count]'); if (count) count.textContent = answer.count > 0 ? String(answer.count) : '';
      } else if (name === 'comment') {
        if (session()?.kind !== 'account') { window.location.assign(loginHref(window.location, 'comment')); return; }
        setComments(value => !value);
      } else if (name === 'fork') setFork(true);
      else if (name === 'share') void sharing.share();
      else if (name === 'notifications') window.location.assign('/notifications');
    };
    const click = (event: MouseEvent) => {
      const target = (event.target as Element).closest<HTMLElement>('[data-mx-reader-action],[data-mx-reader-trigger],[data-mx-mode-choice]');
      if (!target || !chrome.contains(target)) return;
      event.preventDefault();
      const mode = target.getAttribute('data-mx-mode-choice');
      if (mode === 'light' || mode === 'dark') { applyReaderChoice(window, document, mode); return; }
      void action(target.getAttribute('data-mx-reader-action') ?? target.getAttribute('data-mx-reader-trigger') ?? '');
    };
    chrome.addEventListener('click', click);
    const intent = takeChromeIntent(); if (intent) void action(intent);
    const liveId = document.body.getAttribute('data-mx-live-id');
    const editId = document.body.getAttribute('data-mx-live-edit');
    const stopLive = !islandDocumentOf(story) && liveId && editId && typeof EventSource === 'function' ? startIslandLive(window, liveId, editId) : null;
    onCleanup(() => { chrome.removeEventListener('click', click); stopLive?.(); sharing.dispose(); islandDocumentOf(story)?.dispose(); });
  });
  const forkNow = async () => {
    if (!id || forkInFlight) return;
    if (session()?.kind !== 'account') { window.location.assign(loginHref(window.location, 'fork')); return; }
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
    <Show when={ready() && comments()}><aside aria-label="Comments" class="fixed right-0 top-12 z-50 max-h-[80vh] w-80 overflow-auto border border-edge bg-surface p-4 shadow-xl"><button type="button" aria-label="Close comments" onClick={() => setComments(false)}>Close</button><h2>Comments</h2></aside></Show>
    <Show when={fork()}><div role="dialog" aria-label="Fork this artifact?" class="fixed inset-0 z-50 flex items-center justify-center bg-black/40"><div class="rounded border border-edge bg-surface p-6"><h2>Fork this artifact?</h2><p>A copy of “{page?.surface?.title ?? 'this artifact'}” will be added to your artifacts.</p><Show when={forkError()}><p role="alert">{forkError()}</p></Show><button type="button" aria-label="Cancel fork" onClick={() => setFork(false)}>Cancel</button><button type="button" aria-label="Confirm fork" disabled={busy()} onClick={() => void forkNow()}>Fork and open copy</button></div></div></Show>
  </Show>;
}
