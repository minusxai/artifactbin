/* @jsxImportSource solid-js */
/**
 * THE STARTER — `/a/<id>` while the document still holds the start placeholder (lib/start-placeholder).
 *
 * That version is not compiled for reading (lib/artifact-page `compiledMode`): what a person staring at
 * a brand-new document needs is not the placeholder but the paste for their agent, which is app UI
 * (solid/components/StarterInstructions). Its chrome is the reader's own (lib/story/reader-chrome), drawn
 * here as components/ArtifactSurface drew it through InlineReaderChrome, with the same panels
 * solid/pages/Document opens from it.
 *
 * Three ways out, all back onto the compiled page:
 *  - the first real version arrives on the live stream → reload, keeping the reader's place, into the
 *    compiled reader (ArtifactSurface's `props.starter && … && !showStarter` reload);
 *  - Edit (the rail, the controls panel, or landing on `#edit`) → `/edit`, which the server serves as the
 *    compiled placeholder with the editor in place (solid/pages/Document);
 *  - a capture never reaches here: a keyed request is compiled.
 */
import { createEffect, createSignal, onCleanup, onMount, Show, type JSX } from 'solid-js';
import Sun from 'lucide-solid/icons/sun';
import Moon from 'lucide-solid/icons/moon';
import { canAnnotate as canAnnotateRole, canEdit as canEditRole, canGovern, type ArtifactRole } from '@/lib/share-roles';
import { isStartPlaceholder } from '@/lib/start-placeholder';
import { reloadKeepingPlace } from '@/lib/islands/live-update';
import { renderReaderChrome, READER_CHROME_HIDDEN_CLASS, type ReaderChromeInput, type ReaderForkedFrom } from '@/lib/story/reader-chrome';
import { STORY_CHROME_CSS } from '@/lib/story-runtime/chrome-css';
import { chromeAfterSample, type ChromeState } from '@/lib/story-runtime/reader-chrome-policy';
import { wireReaderSharing } from '@/lib/story-runtime/reader-share';
import { wireFaceFallback } from '@/lib/story-runtime/reader-actions';
import { wireGithubStar } from '@/lib/github-star';
import { displayTitle } from '@/lib/story/title';
import { resolveStoryMode } from '@/lib/data/story/story-themes';
import { APP_BAR_H } from '@/lib/story/edit-bar';
import { createHttpBackend } from '@/lib/artifact-backend/http';
import { initialViewWasReported } from '@/web/artifact-view-report';
import type { StoryThemeName } from '@/lib/validation/story-theme-names';
import { loginHref } from '@/lib/login-href';
import { replaceDocument } from '../lib/document-navigation';
import { useSession } from '../lib/session';
import { TrustedUi } from '../components/TrustedUi';
import { useChromeVisibility } from '../components/PageChrome';
import { StarterInstructions } from '../components/StarterInstructions';
import { createIsPhoneViewport } from '../components/MobileSheet';
import { DocumentActions } from '../document/DocumentActions';
import { DocumentSharing } from '../document/DocumentSharing';
import { ForkConfirm } from '../document/ForkArtifact';
import { createLiveArtifact } from '../editor/create-live-artifact';
import { apiFetch } from '../lib/api';

export interface StarterAnswer {
  role: ArtifactRole;
  kind: string;
  like?: { liked: boolean; count: number };
  follow?: { userId: string; following: boolean; count: number } | null;
  surface: {
    id: string; editId: string; format: string; title: string | null; version: number; starter: true;
    heading?: string | null; visibility?: string; hasInvitedUsers?: boolean; openAnnotations?: number;
    author?: { username: string | null; id?: string | null; image?: string | null; forkedFrom?: ReaderForkedFrom | null } | null;
    theme?: StoryThemeName | null; colorMode?: 'light' | 'dark' | null;
  };
}

/** The panels wear the reader chrome's own sheet, with its tokens inside the trusted root (solid/pages/Document). */
const PANEL_CSS = `${STORY_CHROME_CSS}
.mx-reader-panel, .mx-reader-scrim { --mx-reader-bg: #ffffff; --mx-reader-fg: #1a2129; --mx-reader-muted: #5a6572; --mx-reader-border: #e1e6ea; --mx-reader-accent: #0e9d4f; --mx-reader-on-accent: #ffffff; --mx-reader-scheme: light; }
[data-theme="dark"] .mx-reader-panel, [data-theme="dark"] .mx-reader-scrim { --mx-reader-bg: #10151b; --mx-reader-fg: #e6edf3; --mx-reader-muted: #7d8590; --mx-reader-border: #202832; --mx-reader-accent: #3fe77b; --mx-reader-on-accent: #10151b; --mx-reader-scheme: dark; }`;

export function StarterPage(props: { answer: StarterAnswer }): JSX.Element {
  const { session } = useSession();
  const answer = props.answer;
  const surface = answer.surface;
  const id = surface.id;
  const owner = canGovern(answer.role);
  const editable = canEditRole(answer.role);
  const annotatable = canAnnotateRole(answer.role);
  const phone = createIsPhoneViewport();
  const [panel, setPanel] = createSignal<'controls' | 'menu' | null>(null);
  const [fork, setFork] = createSignal(false);
  const [sharingOpen, setSharingOpen] = createSignal(false);
  const [membershipRevision, setMembershipRevision] = createSignal(0);
  const [mode, setMode] = createSignal<'light' | 'dark'>(typeof document !== 'undefined' && document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light');
  const person = () => session()?.kind === 'account' ? session()!.user ?? null : null;
  const accountSession = () => answer.kind === 'account' || session()?.kind === 'account';

  // The reader chrome is this page's bar: the app's own steps aside.
  const setChromeVisible = useChromeVisibility();
  onMount(() => setChromeVisible?.(false));
  onCleanup(() => setChromeVisible?.(true));

  // ── edit mode lives on the compiled placeholder, at `/edit` ──
  const openEditor = () => {
    if (!editable) return;
    replaceDocument(`${window.location.pathname.replace(/\/+$/, '')}/edit${window.location.search}`);
  };
  const syncEditHash = () => { if (window.location.hash === '#edit') openEditor(); };
  onMount(() => {
    syncEditHash();
    window.addEventListener('hashchange', syncEditHash);
    onCleanup(() => window.removeEventListener('hashchange', syncEditHash));
  });

  // ── one view per open (web/artifact-view-report: the served page reports a compiled read itself) ──
  onMount(() => {
    if (initialViewWasReported(document, id)) return;
    document.body.setAttribute('data-mx-view-reported', id);
    void fetch(`/api/page/artifact/${encodeURIComponent(id)}/view`, { method: 'POST', credentials: 'same-origin', keepalive: true }).catch(() => {});
  });

  // ── the first real version turns this page into the compiled reader ──
  const live = createLiveArtifact({
    backend: createHttpBackend(id), id, initialEditId: surface.editId, initialVersion: surface.version,
    enabled: typeof EventSource === 'function',
  });
  let reloading = false;
  createEffect(() => {
    const frame = live();
    if (!frame || reloading || frame.format !== 'markup' || isStartPlaceholder(frame.source, frame.version)) return;
    reloading = true;
    reloadKeepingPlace(window);
  });
  const title = () => displayTitle({ title: live()?.title ?? surface.title, heading: surface.heading ?? null });

  // ── the reader chrome, drawn once from this answer; presses update it in place ──
  const chromeInput = (): ReaderChromeInput => ({
    artifactId: id, ground: resolveStoryMode(surface.theme ?? null, surface.colorMode ?? null), share: owner, archived: null,
    visibility: (surface.visibility ?? 'private') as ReaderChromeInput['visibility'], hasInvitedUsers: surface.hasInvitedUsers,
    title: title(), forkBusy: false, author: surface.author ?? null,
    viewer: person() ? { id: person()!.id, name: person()!.username || person()!.email || '', image: person()!.image ?? null } : null,
    notifications: person() ? { unread: 0 } : undefined,
    edit: editable, ownerBreadcrumb: owner, panels: false,
    reactions: {
      like: { ...(answer.like ?? { liked: false, count: 0 }), href: '#' },
      follow: answer.follow ? { following: answer.follow.following, count: answer.follow.count, href: '#' } : null,
      comment: { count: surface.openAnnotations ?? 0, href: '#' },
    },
  });
  let holder!: HTMLDivElement;
  const chooseMode = (next: 'light' | 'dark') => {
    if (next === 'dark') document.documentElement.dataset.theme = 'dark';
    else delete document.documentElement.dataset.theme;
    try { localStorage.setItem('mx_theme', next); } catch { /* private mode */ }
    holder?.querySelector('[data-mx-reader-chrome]')?.setAttribute('data-mx-ground', next);
    setMode(next);
  };
  const chromeElement = () => holder.querySelector<HTMLElement>('[data-mx-reader-chrome]');
  let sharing: ReturnType<typeof wireReaderSharing> | null = null;
  onMount(() => {
    // Drawn from this answer, and again once the session names who is reading (the rail's face).
    createEffect(() => {
      holder.innerHTML = renderReaderChrome(chromeInput()).replaceAll('target="_top"', 'target="_self"');
      const chrome = chromeElement()!;
      sharing = wireReaderSharing(window, document, chrome);
      const stopStar = wireGithubStar(chrome);
      const stopFaces = wireFaceFallback(chrome);
      onCleanup(() => { sharing?.dispose(); stopStar(); stopFaces(); });
    });
    const action = async (name: string) => {
      const chrome = chromeElement();
      if (!chrome) return;
      if (name === 'controls' || name === 'menu') { setPanel((open) => (open === name ? null : name)); return; }
      if (name === 'like' || name === 'follow') {
        if (!accountSession()) { window.location.assign(loginHref(window.location, name)); return; }
        const control = chrome.querySelector<HTMLElement>(`[data-mx-reader-action="${name}"]`);
        const on = control?.getAttribute(name === 'like' ? 'data-mx-liked' : 'data-mx-following') === 'true';
        const href = name === 'like' ? `/api/my/artifacts/${id}/like` : answer.follow ? `/api/users/${answer.follow.userId}/follow` : '';
        if (!href) return;
        const response = await apiFetch(href, on ? 'DELETE' : 'POST').catch(() => null);
        if (!response?.ok) return;
        const next = await response.json() as { liked?: boolean; following?: boolean; count: number };
        const now = name === 'like' ? next.liked : next.following;
        control?.setAttribute(name === 'like' ? 'data-mx-liked' : 'data-mx-following', String(now));
        control?.setAttribute('aria-label', name === 'like' ? now ? 'Unlike' : 'Like' : `${now ? 'Unfollow' : 'Follow'} @${control.getAttribute('data-mx-author') ?? ''}`);
        const count = control?.querySelector('[data-mx-reader-count]');
        if (count) count.textContent = next.count > 0 ? String(next.count) : '';
      } else if (name === 'comment') {
        // Nothing is written yet to comment on; a reader who may not comment is offered a way in.
        if (!annotatable) window.location.assign(loginHref(window.location, 'comment'));
      } else if (name === 'fork') setFork(true);
      else if (name === 'share') { if (owner) setSharingOpen(true); else sharing?.share(); }
      else if (name === 'notifications') window.location.assign('/notifications');
      else if (name === 'edit') openEditor();
    };
    const click = (event: MouseEvent) => {
      const target = (event.target as Element).closest<HTMLElement>('[data-mx-reader-action],[data-mx-reader-trigger]');
      if (!target || !holder.contains(target)) return;
      event.preventDefault();
      void action(target.getAttribute('data-mx-reader-action') ?? target.getAttribute('data-mx-reader-trigger') ?? '');
    };
    holder.addEventListener('click', click);
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') setPanel(null); };
    window.addEventListener('keydown', escape);
    // The rail's triggers say whether their panel is open, however it closed.
    createEffect(() => {
      const open = panel();
      person();
      for (const name of ['controls', 'menu'] as const) {
        const trigger = chromeElement()?.querySelector<HTMLElement>(`[data-mx-reader-trigger="${name}"]`);
        trigger?.setAttribute('aria-expanded', String(open === name));
        trigger?.setAttribute('aria-label', `${open === name ? 'Close' : 'Open'} ${name === 'controls' ? 'artifact controls' : 'menu'}`);
      }
    });
    // Shown while a panel is open, otherwise by the reader's scroll (lib/story-runtime/reader-chrome-policy).
    let state: ChromeState | null = null;
    let frame = 0;
    const sample = () => {
      frame = 0;
      const visible = panel() !== null || fork() || (state = chromeAfterSample(state, {
        scrollY: Math.max(0, window.scrollY), viewportHeight: window.innerHeight, documentHeight: document.documentElement.scrollHeight,
      })).visible;
      const chrome = chromeElement();
      chrome?.classList.toggle(READER_CHROME_HIDDEN_CLASS, !visible);
      chrome?.setAttribute('data-mx-reader-state', visible ? 'shown' : 'hidden');
    };
    const schedule = () => { if (!frame) frame = window.requestAnimationFrame(sample); };
    createEffect(() => { panel(); fork(); person(); sample(); });
    window.addEventListener('scroll', schedule, { passive: true });
    window.addEventListener('resize', schedule);
    onCleanup(() => {
      holder.removeEventListener('click', click); window.removeEventListener('keydown', escape);
      window.removeEventListener('scroll', schedule); window.removeEventListener('resize', schedule);
      window.cancelAnimationFrame(frame);
    });
  });

  return <>
    {/* First in document order: lib/islands/trusted-portal hands its portal to every popover, tooltip and dialog. */}
    <TrustedUi overlay layer="navigation">
      <style>{PANEL_CSS}</style>
      <div ref={holder} />
      <Show when={panel()}>
        <button type="button" aria-label="Close page controls" class="mx-reader-scrim" onClick={() => setPanel(null)} />
        <Show when={panel() === 'controls'}><section role="dialog" aria-label="Artifact controls" class="mx-reader-panel mx-reader-panel--controls"><h2>artifact controls</h2><h3>appearance</h3><div class="mx-reader-modes" role="group" aria-label="Color mode"><button type="button" aria-label="Light mode" aria-pressed={mode() === 'light'} onClick={() => chooseMode('light')}><Sun size={14} />light</button><button type="button" aria-label="Dark mode" aria-pressed={mode() === 'dark'} onClick={() => chooseMode('dark')}><Moon size={14} />dark</button></div>
          <DocumentActions id={id} title={title()} version={live()?.version ?? surface.version}
            owner={owner} canEdit={editable} canAnnotate={false} accountSession={accountSession()}
            like={answer.like ?? { liked: false, count: 0 }} onCommentsChange={() => {}}
            forkedFrom={surface.author?.forkedFrom ?? null} hideFork
            membershipRevision={membershipRevision()} onMembershipChange={() => setMembershipRevision((n) => n + 1)}
            onEdit={() => { setPanel(null); openEditor(); }}
            onShare={() => { setPanel(null); setSharingOpen(true); }}
            onDeleted={owner ? () => window.location.assign('/') : undefined} />
        </section></Show>
        <Show when={panel() === 'menu'}><nav aria-label="Menu" class="mx-reader-panel mx-reader-panel--menu"><a class="mx-reader-brand" href="/"><img src="/logo-128.png" alt="" />artifactbin</a><a href="/">Artifacts</a><a href="/account">Account</a><a href="/docs-human">Human Docs</a></nav></Show>
      </Show>
      <Show when={fork()}><ForkConfirm id={id} title={title()} onClose={() => setFork(false)} /></Show>
      <Show when={sharingOpen()}>
        <DocumentSharing id={id} title={title()} owner={owner} editable={editable} variant="dialog" version={live()?.version ?? surface.version} onClose={() => setSharingOpen(false)} />
      </Show>
    </TrustedUi>
    {/* The starter sits on the app's own dotted page, under the chrome's bar. */}
    <div aria-label="Artifact viewport" class="relative min-h-screen" style={{ 'padding-top': `${phone() ? 0 : APP_BAR_H}px` }}>
      <StarterInstructions id={id} />
    </div>
  </>;
}
