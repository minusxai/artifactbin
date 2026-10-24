/* @jsxImportSource solid-js */
import { isChunkLoadError, reloadForNewBuild } from '../lib/app-build';
import { createContext, createEffect, createSignal, For, on, onMount, onCleanup, Show, useContext, type Accessor, type JSX, type Setter } from 'solid-js';
/** Shared Solid app chrome. One owner closes one panel before another opens. */
import { Bell, ChevronRight, CircleUser, SlidersVertical, X } from 'lucide-solid';
import { Dynamic } from 'solid-js/web';
import { useLocation } from '@solidjs/router';
import { crumbsFor } from '@/lib/workspace/breadcrumb';
import { PageBar } from './PageBar';
import { CHROME_IDENTITY } from './chrome-identity';
import { githubStarMarkup, wireGithubStar } from '@/lib/serving/github-star';
import { useSession } from '../lib/session';
import { Tooltip } from '../ui/Tooltip';
import { Button } from '../ui/Button';
import { Dialog } from '../ui/Dialog';
import { useOptionalInbox } from '../lib/notifications';
import { Avatar } from '../ui/Avatar';
import { chooseTheme } from '@/lib/story-runtime/reader-mode';
import { createIsPhoneViewport } from '../ui/MobileSheet';

// The three panels are interaction-only (see PageChromePanels), so the reader's bytes do not carry the Drawer or the inbox: the module
// is fetched when a panel first opens. Not `lazy()` in a <Suspense>: a boundary that lives as long as the page holds the router's
// navigation transition (frame-navigation.test), so the page keeps its own signal and renders the panels once it is set.
type Panels = typeof import('./PageChromePanels');
const loadPanels = () => import('./PageChromePanels');

/** Artifact controls from the editor seam; the named export below owns app pages. */
export default function ArtifactPageChrome(props: { authed: boolean; anon: boolean; title: string; label: string; children: JSX.Element }): JSX.Element {
  const [open, setOpen] = createSignal(false);
  return <aside class="fixed right-4 top-4 z-40">
    <Button variant="secondary" size="sm" aria-label="Open artifact controls" aria-expanded={open()} onClick={() => setOpen(value => !value)}>{props.title || 'Artifact'} ···</Button>
    <Show when={open()}><Dialog title={props.label} onClose={() => setOpen(false)} footer={<Button variant="secondary" aria-label={`Dismiss ${props.label.toLowerCase()}`} onClick={() => setOpen(false)}>Close</Button>}>{props.children}</Dialog></Show>
  </aside>;
}

export type Panel = 'menu' | 'controls' | 'notifications' | null;
/** A route may suppress the app bar while it owns the whole viewport (the 404 page). */
export const ChromeVisibilityContext = createContext<Setter<boolean>>();
export function useChromeVisibility(): Setter<boolean> | undefined { return useContext(ChromeVisibilityContext); }

function Star(props: { mobile: boolean }): JSX.Element {
  let root!: HTMLSpanElement;
  createEffect(() => wireGithubStar(root));
  return <span ref={root} data-mx-github-star="" class={`${props.mobile ? 'inline-flex max-[380px]:hidden sm:hidden' : 'hidden sm:inline-flex'} h-7 shrink-0 items-center text-fg print:hidden`} innerHTML={githubStarMarkup(!props.mobile)} />;
}

/**
 * What an artifact page adds to the one bar (`PageChromeProps`): its `title` as the
 * crumb, the controls panel's `label` ("Artifact controls"), bar `actions` beside the star, and
 * `controls` — the artifact's own rows under the appearance picker.
 *
 * A document page (solid/document/DocumentChrome) also replaces the crumbs with its own `byline` (the
 * author, the title, the follow and membership pills), owns which panel is open (`panel`/`setPanel`, so a
 * carried intent or a pill can open one), hears the reader's colour choice (`mode`/`onMode`: the document
 * in its frame takes it too) and drops the star while it is being edited (`star: false`).
 */
interface PageChromeProps {
  title?: string | null;
  label?: string;
  actions?: JSX.Element;
  /** Below the wide navigation breakpoint, retain secondary actions in the page's compact surface. */
  compactActions?: () => JSX.Element;
  controls?: (close: () => void) => JSX.Element;
  byline?: JSX.Element;
  panel?: Accessor<Panel>;
  setPanel?: (next: Panel) => void;
  mode?: Accessor<'light' | 'dark'>;
  onMode?: (next: 'light' | 'dark') => void;
  star?: boolean;
}

export function PageChrome(props: PageChromeProps = {}): JSX.Element {
  const location = useLocation();
  const phone = createIsPhoneViewport();
  // Matches PageBar's lg navigation breakpoint; the shared phone helper is fixed at sm (640px).
  const [compact, setCompact] = createSignal(typeof window !== 'undefined' && window.innerWidth < 1024);
  onMount(() => {
    const resize = () => setCompact(window.innerWidth < 1024);
    resize();
    window.addEventListener('resize', resize);
    onCleanup(() => window.removeEventListener('resize', resize));
  });
  const { session } = useSession();
  // The app shell provides the inbox; a page rendered on its own (a test) has none and shows no unread mark.
  const inbox = useOptionalInbox();
  const [ownPanel, setOwnPanel] = createSignal<Panel>(null);
  const panel = () => (props.panel ? props.panel() : ownPanel());
  const setPanel = (next: Panel | ((current: Panel) => Panel)) => {
    const value = typeof next === 'function' ? next(panel()) : next;
    if (props.setPanel) props.setPanel(value); else setOwnPanel(value);
  };
  const [ownMode, setMode] = createSignal<'light' | 'dark'>(typeof document !== 'undefined' && document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light');
  const mode = () => (props.mode ? props.mode() : ownMode());
  const person = () => session()?.kind === 'account' ? session()?.user : null;
  const crumbs = () => crumbsFor(location.pathname, props.title);
  const label = () => props.label ?? 'Page controls';
  const controlsName = () => label().toLowerCase();
  let opener: HTMLElement | undefined;
  const toggle = (next: Panel, event?: Event) => { opener = (event?.currentTarget as HTMLElement | null) ?? undefined; setPanel(current => current === next ? null : next); };
  const close = () => setPanel(null);
  const pick = (next: 'light' | 'dark') => {
    setMode(next);
    if (props.onMode) props.onMode(next); else chooseTheme(next);
  };
  const [panels, setPanels] = createSignal<Panels>();
  // A panel's code missing after a deploy (solid/lib/app-build): the press loads the new build rather than doing nothing.
  createEffect(() => { if (panel() && !panels()) void loadPanels().then(setPanels, (error: unknown) => { if (isChunkLoadError(error)) reloadForNewBuild(); }); });
  const unread = () => Boolean(inbox?.state()?.unread);
  // Whatever closes a panel (Escape, scrim, its own close button, a link) returns focus to the bar button that opened it.
  createEffect(on(panel, (now, before) => { if (!now && before && opener?.isConnected) opener.focus(); }, { defer: true }));
  return <>
    <PageBar logo={<img src="/logo-128.png" alt="" style={{ width: `${CHROME_IDENTITY.logoSize}px`, height: `${CHROME_IDENTITY.logoSize}px` }} />} mobileTitle={props.byline ? props.title ?? undefined : crumbs().at(-1)?.label}
      compactNavigation={Boolean(props.compactActions)} navigation={<>        <a href="/" class={`shrink-0 no-underline hover:text-accent ${crumbs().length || props.byline ? 'text-muted' : 'font-semibold text-fg'}`}>artifactbin</a>
        <Show when={props.byline} fallback={<>
          <Show when={!crumbs().length}><span aria-hidden="true" class="text-faint">·</span><span class="truncate font-normal text-muted">Google Docs for agents</span></Show>
          <For each={crumbs()}>{crumb => <span class="flex min-w-0 items-center gap-2"><ChevronRight size={14} class="shrink-0 text-faint" aria-hidden="true" /><Show when={crumb.href} fallback={<span aria-current="page" class="min-w-0 truncate font-semibold text-fg">{crumb.label}</span>}><a href={crumb.href} class="shrink-0 text-muted no-underline hover:text-accent">{crumb.label}</a></Show></span>}</For>
        </>}>{props.byline}</Show>
</>} actions={<>
        <Show when={compact() && props.compactActions} fallback={<><Show when={props.star !== false}><Star mobile={false} /><Star mobile={true} /></Show>{props.actions}</>}>{render => render()()}</Show>
        <Show when={person()}><Tooltip content="Notifications"><Button icon size="bar" variant={panel() === 'notifications' ? 'secondary' : 'ghost'} aria-label={unread() ? 'Notifications, unread updates' : 'Notifications'} aria-expanded={panel() === 'notifications'} onClick={event => toggle('notifications', event)} class="relative"><Bell size={20} strokeWidth={1.5} /><Show when={unread()}><span aria-hidden="true" class="absolute right-1 top-1 h-2 w-2 rounded-full bg-danger" /></Show></Button></Tooltip></Show>
        <Tooltip content={controlsName()}><Button icon size="bar" variant={panel() === 'controls' ? 'secondary' : 'ghost'} aria-label={`${panel() === 'controls' ? 'Close' : 'Open'} ${controlsName()}`} aria-expanded={panel() === 'controls'} onClick={event => toggle('controls', event)}>{panel() === 'controls' ? <X size={17} /> : <SlidersVertical size={20} strokeWidth={1.5} />}</Button></Tooltip>
        <Tooltip content="menu"><Button icon size="bar" variant={panel() === 'menu' ? 'secondary' : 'ghost'} aria-label={panel() === 'menu' ? 'Close menu' : 'Open menu'} aria-expanded={panel() === 'menu'} onClick={event => toggle('menu', event)}><Show when={person()} fallback={panel() === 'menu' ? <X size={17} /> : <CircleUser size={20} strokeWidth={1.5} />}><span class={`rounded-full ring-offset-1 ring-offset-surface ${panel() === 'menu' ? 'ring-2 ring-accent' : ''}`}><Avatar image={person()?.image ?? null} initial={person()?.username || person()?.email || '?'} userId={person()?.id ?? ''} size={24} /></span></Show></Button></Tooltip>
</>} />
    {/* Each panel is a Drawer (own scrim, in the page's trusted overlay) from PageChromePanels, loaded when one first opens. */}
    <Show when={panels()}>{loaded => <>
      <Show when={panel() === 'menu'}><Dynamic component={loaded().MenuPanel} close={close} phone={phone()} /></Show>
      <Show when={panel() === 'controls'}><Dynamic component={loaded().ControlsPanel} label={label()} title={controlsName()} mode={mode()} onMode={pick} onClose={close}>
        <Show when={props.controls}>{render => <div class="mt-4 border-t border-edge pt-3">{render()(close)}</div>}</Show>
      </Dynamic></Show>
      <Show when={panel() === 'notifications'}><Dynamic component={loaded().NotificationsPanel} close={close} /></Show>
    </>}</Show>
  </>;
}
