/* @jsxImportSource solid-js */
import CalendarClock from 'lucide-solid/icons/calendar-clock';
import { createContext, createEffect, createSignal, For, on, onCleanup, Show, useContext, type Accessor, type JSX, type Setter } from 'solid-js';
/** Shared Solid app chrome. One owner closes one panel before another opens. */
import { Bell, BookOpen, ChevronRight, CircleUser, FileText, LogIn, LogOut, Moon, SlidersVertical, Sun, User, X } from 'lucide-solid';
import { GitHubIcon } from '../ui/brand-icons';
import { useLocation } from '@solidjs/router';
import { Portal } from 'solid-js/web';
import { trustedPortalOf } from '@/lib/islands/trusted-portal';
import { crumbsFor } from '@/lib/workspace/breadcrumb';
import { PageBar, PageControlsPanel } from './PageBar';
import { CHROME_IDENTITY } from './chrome-identity';
import { githubStarMarkup, wireGithubStar } from '@/lib/serving/github-star';
import { REPO_URL } from '@/lib/serving/repo';
import { forgetPagesSession } from './browser-session';
import { loginHref } from '@/lib/http/login-href';
import { useSession } from '../lib/session';
import { Tooltip } from '../ui/Tooltip';
import { PeopleInbox } from './PeopleInbox';
import { useOptionalInbox } from '../lib/notifications';
import { Avatar } from '../ui/Avatar';
import { closeOnEscape } from '../lib/close-on-escape';
import { chooseTheme } from '@/lib/story-runtime/reader-mode';
import { createIsPhoneViewport } from '../ui/MobileSheet';

/** Artifact controls from the editor seam; the named export below owns app pages. */
export default function ArtifactPageChrome(props: { authed: boolean; anon: boolean; title: string; label: string; children: JSX.Element }): JSX.Element {
  const [open, setOpen] = createSignal(false);
  return <aside class="fixed right-4 top-4 z-40">
    <button type="button" aria-label="Open artifact controls" aria-expanded={open()} onClick={() => setOpen(value => !value)} class="rounded border border-edge bg-surface px-3 py-2 text-xs text-fg">{props.title || 'Artifact'} ···</button>
    <Show when={open()}><div role="dialog" aria-label={props.label} class="absolute right-0 mt-2 w-64 rounded border border-edge bg-surface p-3 shadow-xl"><div class="mb-3 flex items-center justify-between"><h1 class="font-mono text-xs font-semibold">{props.label.toLowerCase()}</h1><button type="button" aria-label={`Dismiss ${props.label.toLowerCase()}`} onClick={() => setOpen(false)}>×</button></div>{props.children}</div></Show>
  </aside>;
}

export type Panel = 'menu' | 'controls' | 'notifications' | null;
/** A route may suppress the app bar while it owns the whole viewport (the 404 page). */
export const ChromeVisibilityContext = createContext<Setter<boolean>>();
export function useChromeVisibility(): Setter<boolean> | undefined { return useContext(ChromeVisibilityContext); }
const BAR_BUTTON = 'flex h-9 w-9 cursor-pointer items-center justify-center rounded-[8px] border-0 bg-transparent text-muted transition-colors hover:bg-raised hover:text-fg';

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
  const modeClass = (value: 'light' | 'dark') => `flex flex-1 cursor-pointer items-center justify-center gap-2 border-0 px-3 py-2 font-mono text-xs transition-colors ${mode() === value ? 'bg-accent-soft text-accent' : 'bg-transparent text-muted hover:bg-raised hover:text-fg'}`;
  let opener: HTMLElement | undefined;
  const toggle = (next: Panel, event?: Event) => { opener = (event?.currentTarget as HTMLElement | null) ?? undefined; setPanel(current => current === next ? null : next); };
  const close = () => setPanel(null);
  const pick = (next: 'light' | 'dark') => {
    setMode(next);
    if (props.onMode) props.onMode(next); else chooseTheme(next);
  };
  const unread = () => Boolean(inbox?.state()?.unread);
  // Whatever closes a panel (Escape, scrim, its own close button, a link) returns focus to the bar button that opened it.
  createEffect(on(panel, (now, before) => { if (!now && before && opener?.isConnected) opener.focus(); }, { defer: true }));
  createEffect(() => { if (panel()) onCleanup(closeOnEscape(close)); });
  return <>
    <PageBar logo={<img src="/logo-128.png" alt="" style={{ width: `${CHROME_IDENTITY.logoSize}px`, height: `${CHROME_IDENTITY.logoSize}px` }} />} mobileTitle={props.byline ? props.title ?? undefined : crumbs().at(-1)?.label}
      navigation={<>        <a href="/" class={`shrink-0 no-underline hover:text-accent ${crumbs().length || props.byline ? 'text-muted' : 'font-semibold text-fg'}`}>artifactbin</a>
        <Show when={props.byline} fallback={<>
          <Show when={!crumbs().length}><span aria-hidden="true" class="text-faint">·</span><span class="truncate font-normal text-muted">Google Docs for agents</span></Show>
          <For each={crumbs()}>{crumb => <span class="flex min-w-0 items-center gap-2"><ChevronRight size={14} class="shrink-0 text-faint" aria-hidden="true" /><Show when={crumb.href} fallback={<span aria-current="page" class="min-w-0 truncate font-semibold text-fg">{crumb.label}</span>}><a href={crumb.href} class="shrink-0 text-muted no-underline hover:text-accent">{crumb.label}</a></Show></span>}</For>
        </>}>{props.byline}</Show>
</>} actions={<>        <Show when={props.star !== false}><Star mobile={false} /><Star mobile={true} /></Show>
        {props.actions}
        <Show when={person()}><Tooltip content="Notifications"><button type="button" aria-label={unread() ? 'Notifications, unread updates' : 'Notifications'} aria-expanded={panel() === 'notifications'} onClick={event => toggle('notifications', event)} class={`${BAR_BUTTON} relative`}><Bell size={20} strokeWidth={1.5} /><Show when={unread()}><span aria-hidden="true" class="absolute right-1 top-1 h-2 w-2 rounded-full bg-red-500" /></Show></button></Tooltip></Show>
        <Tooltip content={controlsName()}><button type="button" aria-label={`${panel() === 'controls' ? 'Close' : 'Open'} ${controlsName()}`} aria-expanded={panel() === 'controls'} onClick={event => toggle('controls', event)} class={`${BAR_BUTTON} ${panel() === 'controls' ? 'text-accent' : ''}`}>{panel() === 'controls' ? <X size={17} /> : <SlidersVertical size={20} strokeWidth={1.5} />}</button></Tooltip>
        <Tooltip content="menu"><button type="button" aria-label={panel() === 'menu' ? 'Close menu' : 'Open menu'} aria-expanded={panel() === 'menu'} onClick={event => toggle('menu', event)} class={BAR_BUTTON}><Show when={person()} fallback={panel() === 'menu' ? <X size={17} /> : <CircleUser size={20} strokeWidth={1.5} />}><span class={`rounded-full ring-offset-1 ring-offset-surface ${panel() === 'menu' ? 'ring-2 ring-accent' : ''}`}><Avatar image={person()?.image ?? null} initial={person()?.username || person()?.email || '?'} userId={person()?.id ?? ''} size={24} /></span></Show></button></Tooltip>
</>} />
    {/*
      * The panels open in the page's trusted overlay where it has one (the document page's "navigation" layer,
      * lib/islands/trusted-portal), like every other popover there: the comments rail is a top-layer overlay, and the
      * top layer ignores z-index, so a panel left on the ordinary page would paint under the rail and its rows could
      * not be pressed. A page without trusted UI keeps them on its body.
      */}
    <Show when={panel()}><Portal mount={trustedPortalOf(document) ?? document.body}>
      <button type="button" aria-label="Close panel" class="fixed inset-0 z-40 cursor-default border-0 bg-black/25 p-0" onClick={close} />
      <Show when={panel() === 'menu'}>
        <PageMenuPanel close={close} phone={phone()} />
      </Show>
      <Show when={panel() === 'controls'}><PageControlsPanel label={label()} title={controlsName()} onClose={close}><section aria-label="Appearance"><h2 class="mb-2 font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-faint">appearance</h2><div role="group" aria-label="Color mode" class="flex overflow-hidden rounded-[5px] border border-edge"><button type="button" aria-label="Light mode" aria-pressed={mode() === 'light'} onClick={() => pick('light')} class={modeClass('light')}><Sun size={14} strokeWidth={1.5} />light</button><button type="button" aria-label="Dark mode" aria-pressed={mode() === 'dark'} onClick={() => pick('dark')} class={modeClass('dark')}><Moon size={14} strokeWidth={1.5} />dark</button></div></section>
        <Show when={props.controls}>{render => <div class="mt-4 border-t border-edge pt-3">{render()(close)}</div>}</Show>
      </PageControlsPanel></Show>
      <Show when={panel() === 'notifications'}><NotificationsPanel close={close} /></Show>
    </Portal></Show>
  </>;
}

const MENU_ROW = 'flex w-full items-center gap-3 rounded-[5px] border-0 bg-transparent px-3 py-3 text-left font-mono text-sm no-underline transition-colors sm:gap-2.5 sm:px-2.5 sm:py-2 sm:text-xs';

/**
 * The app menu (links, then sign out / disconnect / login), shared by the app bar and the document
 * page. It opens under the bar at the right, or as a bottom sheet on a phone.
 */
function PageMenuPanel(props: { close: () => void; phone?: boolean; top?: number }): JSX.Element {
  const { session } = useSession();
  const location = useLocation();
  const person = () => session()?.kind === 'account' ? session()?.user : null;
  const close = () => props.close();
  const link = (href: string, label: string, icon: JSX.Element) => {
    const active = () => location.pathname === href;
    return <a href={href} rel={['/', '/assets', '/trash', '/login', '/start', '/welcome', '/notifications', '/account', '/docs-human', '/chat', '/schedules', '/programs/new'].includes(href) ? undefined : 'external'} aria-label={label}
      class={`${MENU_ROW} cursor-pointer ${active() ? 'bg-accent-soft text-accent' : 'text-muted hover:bg-raised hover:text-fg'}`} onClick={close}>{icon}{label}</a>;
  };
  const placement = () => props.phone
    ? 'fixed inset-x-0 bottom-0 z-50 flex animate-[rise_.14s_ease-out] flex-col rounded-t-[10px] border-t border-edge bg-surface p-3 pb-[max(20px,env(safe-area-inset-bottom))] shadow-xl'
    : 'fixed right-3 top-14 z-50 flex w-72 animate-[rise_.14s_ease-out] flex-col rounded-[7px] border border-edge bg-surface p-2 shadow-xl';
  return (
    <nav aria-label="Menu" class={placement()} style={!props.phone && props.top !== undefined ? { top: `${props.top}px` } : undefined}>
      <button type="button" aria-label="Dismiss menu" onClick={close} style={{ top: 'max(12px, env(safe-area-inset-top))' }}
        class="absolute right-3 top-3 flex h-9 w-9 cursor-pointer items-center justify-center rounded-full border border-edge bg-surface text-muted hover:bg-raised hover:text-fg sm:hidden"><X size={17} stroke-width={1.5} /></button>
      <a href="/" aria-label="Hosted at artifactbin" class="mb-3 flex items-center gap-2.5 px-2 font-mono text-sm font-semibold text-fg no-underline transition-colors hover:text-accent"><img src="/logo-128.png" alt="" class="h-7 w-7" />artifactbin</a>
      {link('/', 'Artifacts', <FileText size={15} stroke-width={1.5} />)}
      {link('/schedules', 'Schedules', <CalendarClock size={15} />)}
      {link('/chat', 'Connected Agents', <User size={15} stroke-width={1.5} />)}
      {link('/notifications', 'Notifications', <User size={15} stroke-width={1.5} />)}
      {link('/account', 'Account', <User size={15} stroke-width={1.5} />)}
      {link('/docs-human', 'Human Docs', <BookOpen size={15} stroke-width={1.5} />)}
      <a href={REPO_URL} target="_blank" rel="noopener noreferrer" class={`${MENU_ROW} cursor-pointer text-muted hover:bg-raised hover:text-fg`} onClick={close}><GitHubIcon size={15} />Support artifactbin</a>
      <div class="mt-auto" /><div class="my-1 h-px bg-edge" />
      <Show when={person()} fallback={link(loginHref(window.location), 'Login', <LogIn size={15} stroke-width={1.5} />)}>
        <button type="button" aria-label="Sign out" class={`${MENU_ROW} cursor-pointer text-muted hover:bg-raised hover:text-fg`} onClick={() => void Promise.all([forgetPagesSession(), fetch('/api/auth/sign-out', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }).catch(() => null)]).then(() => { window.location.href = '/'; })}><LogOut size={15} stroke-width={1.5} />Sign out</button>
      </Show>
    </nav>
  );
}

/** The notifications panel, shared by the app bar and the document page. */
function NotificationsPanel(props: { close: () => void }): JSX.Element {
  const close = () => props.close();
  return <section aria-label="Notifications" class="fixed right-3 top-14 z-50 w-80 rounded-[7px] border border-edge bg-surface p-4 shadow-xl"><div class="mb-3 flex items-center justify-between"><h2 class="text-sm font-semibold">Notifications</h2><button type="button" aria-label="Close notifications" onClick={close}><X size={18} /></button></div><div class="max-h-[55vh] overflow-y-auto"><PeopleInbox compact close={close} /></div><nav aria-label="Notification links" class="mt-2 flex flex-col gap-2 border-t border-edge pt-3"><a href="/notifications" onClick={close}>All notifications</a><a href="/account#notifications" onClick={close}>Notification settings</a></nav></section>;
}
