/* @jsxImportSource solid-js */
import { createContext, createEffect, createSignal, For, onCleanup, Show, useContext, type JSX, type Setter } from 'solid-js';
/** Shared Solid app chrome. One owner closes one panel before another opens. */
import { Bell, ChevronRight, CircleUser, LogIn, LogOut, Moon, SlidersVertical, Sun, X } from 'lucide-solid';
import { useLocation } from '@solidjs/router';
import { crumbsFor } from '@/lib/breadcrumb';
import { CHROME_IDENTITY } from '@/lib/chrome-identity';
import { githubStarMarkup, wireGithubStar } from '@/lib/github-star';
import { REPO_URL } from '@/lib/repo';
import { forgetTokens } from '@/lib/browser-session';
import { loginHref } from '../shared/login-href';
import { useSession } from '../web/session';
import { Tooltip } from './Tooltip';
import { PeopleInbox } from './PeopleInbox';
import { useInbox } from '../web/notifications';
import { Avatar } from './Avatar';

/** Artifact controls from the editor seam; the named export below owns app pages. */
export default function ArtifactPageChrome(props: { authed: boolean; anon: boolean; title: string; label: string; children: JSX.Element }): JSX.Element {
  const [open, setOpen] = createSignal(false);
  return <aside class="fixed right-4 top-4 z-40">
    <button type="button" aria-label="Open artifact controls" aria-expanded={open()} onClick={() => setOpen(value => !value)} class="rounded border border-edge bg-surface px-3 py-2 text-xs text-fg">{props.title || 'Artifact'} ···</button>
    <Show when={open()}><div role="dialog" aria-label={props.label} class="absolute right-0 mt-2 w-64 rounded border border-edge bg-surface p-3 shadow-xl"><div class="mb-3 flex items-center justify-between"><h1 class="font-mono text-xs font-semibold">{props.label.toLowerCase()}</h1><button type="button" aria-label={`Dismiss ${props.label.toLowerCase()}`} onClick={() => setOpen(false)}>×</button></div>{props.children}</div></Show>
  </aside>;
}

type Panel = 'menu' | 'controls' | 'notifications' | null;
/** A route may suppress the app bar while it owns the whole viewport (the 404 page). */
export const ChromeVisibilityContext = createContext<Setter<boolean>>();
export function useChromeVisibility(): Setter<boolean> | undefined { return useContext(ChromeVisibilityContext); }
const BAR_BUTTON = 'flex h-9 w-9 cursor-pointer items-center justify-center rounded-[8px] border-0 bg-transparent text-muted transition-colors hover:bg-raised hover:text-fg';
const MENU_ITEM = 'flex w-full items-center gap-3 rounded-[5px] border-0 bg-transparent px-3 py-3 text-left font-mono text-sm no-underline text-muted hover:bg-raised hover:text-fg sm:py-2 sm:text-xs';

function Star(props: { mobile: boolean }): JSX.Element {
  let root!: HTMLSpanElement;
  createEffect(() => wireGithubStar(root));
  return <span ref={root} data-mx-github-star="" class={`${props.mobile ? 'inline-flex sm:hidden' : 'hidden sm:inline-flex'} h-7 shrink-0 items-center text-fg print:hidden`} innerHTML={githubStarMarkup(!props.mobile)} />;
}

/**
 * What an artifact page adds to the one bar (components/PageChrome's React props): its `title` as the
 * crumb, the controls panel's `label` ("Artifact controls"), bar `actions` beside the star, and
 * `controls` — the artifact's own rows under the appearance picker.
 */
export interface PageChromeProps {
  title?: string | null;
  label?: string;
  actions?: JSX.Element;
  controls?: (close: () => void) => JSX.Element;
}

export function PageChrome(props: PageChromeProps = {}): JSX.Element {
  const location = useLocation();
  const { session } = useSession();
  const inbox = useInbox();
  const [panel, setPanel] = createSignal<Panel>(null);
  const [mode, setMode] = createSignal<'light' | 'dark'>(typeof document !== 'undefined' && document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light');
  const person = () => session()?.kind === 'account' ? session()?.user : null;
  const crumbs = () => crumbsFor(location.pathname, props.title);
  const label = () => props.label ?? 'Page controls';
  const controlsName = () => label().toLowerCase();
  const modeClass = (value: 'light' | 'dark') => `flex flex-1 cursor-pointer items-center justify-center gap-2 border-0 px-3 py-2 font-mono text-xs transition-colors ${mode() === value ? 'bg-accent-soft text-accent' : 'bg-transparent text-muted hover:bg-raised hover:text-fg'}`;
  const toggle = (next: Panel) => setPanel(current => current === next ? null : next);
  const close = () => setPanel(null);
  const pick = (next: 'light' | 'dark') => {
    setMode(next);
    if (next === 'dark') document.documentElement.dataset.theme = 'dark';
    else delete document.documentElement.dataset.theme;
    try { localStorage.setItem('mx_theme', next); } catch { /* private mode */ }
  };
  const unread = () => Boolean(inbox.state()?.unread);
  createEffect(() => {
    if (!panel()) return;
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') close(); };
    window.addEventListener('keydown', escape);
    onCleanup(() => window.removeEventListener('keydown', escape));
  });
  const menuLink = (href: string, name: string) => <a href={href} rel={['/', '/assets', '/trash', '/login', '/start', '/welcome', '/notifications', '/account', '/docs-human'].includes(href) ? undefined : 'external'} aria-label={name} class={MENU_ITEM} onClick={close}>{name}</a>;
  return <>
    <header aria-label="Page bar" class="sticky top-0 z-40 flex h-11 items-center gap-2 border-b border-edge bg-surface/85 px-3 backdrop-blur-md sm:gap-3">
      <a href="/" aria-label="Home" class="flex h-9 w-9 shrink-0 items-center justify-center rounded-[8px] no-underline transition-colors hover:bg-raised"><img src="/logo-128.png" alt="" style={{ width: `${CHROME_IDENTITY.logoSize}px`, height: `${CHROME_IDENTITY.logoSize}px` }} /></a>
      <a href="/" class="min-w-0 truncate font-mono text-[13px] font-medium text-fg no-underline hover:text-accent sm:hidden">artifactbin</a>
      <nav aria-label="Current page" class="hidden min-w-0 items-center gap-2 font-mono text-fg sm:flex" style={{ 'font-size': `${CHROME_IDENTITY.fontSize}px`, 'font-weight': CHROME_IDENTITY.fontWeight }}>
        <a href="/" class={`shrink-0 no-underline hover:text-accent ${crumbs().length ? 'text-muted' : 'font-semibold text-fg'}`}>artifactbin</a>
        <Show when={!crumbs().length}><span aria-hidden="true" class="text-faint">·</span><span class="truncate font-normal text-muted">Google Docs for agents</span></Show>
        <For each={crumbs()}>{crumb => <span class="flex min-w-0 items-center gap-2"><ChevronRight size={14} class="shrink-0 text-faint" aria-hidden="true" /><Show when={crumb.href} fallback={<span class="min-w-0 truncate font-semibold text-fg">{crumb.label}</span>}><a href={crumb.href} class="shrink-0 text-muted no-underline hover:text-accent">{crumb.label}</a></Show></span>}</For>
      </nav>
      <div class="ml-auto flex shrink-0 items-center gap-1">
        <Star mobile={false} /><Star mobile={true} />
        {props.actions}
        <Show when={person()}><Tooltip content="Notifications"><button type="button" aria-label={unread() ? 'Notifications, unread updates' : 'Notifications'} aria-expanded={panel() === 'notifications'} onClick={() => toggle('notifications')} class={`${BAR_BUTTON} relative`}><Bell size={20} strokeWidth={1.5} /><Show when={unread()}><span aria-hidden="true" class="absolute right-1 top-1 h-2 w-2 rounded-full bg-red-500" /></Show></button></Tooltip></Show>
        <Tooltip content={controlsName()}><button type="button" aria-label={`${panel() === 'controls' ? 'Close' : 'Open'} ${controlsName()}`} aria-expanded={panel() === 'controls'} onClick={() => toggle('controls')} class={`${BAR_BUTTON} ${panel() === 'controls' ? 'text-accent' : ''}`}>{panel() === 'controls' ? <X size={17} /> : <SlidersVertical size={20} strokeWidth={1.5} />}</button></Tooltip>
        <Tooltip content="menu"><button type="button" aria-label={panel() === 'menu' ? 'Close menu' : 'Open menu'} aria-expanded={panel() === 'menu'} onClick={() => toggle('menu')} class={BAR_BUTTON}><Show when={person()} fallback={panel() === 'menu' ? <X size={17} /> : <CircleUser size={20} strokeWidth={1.5} />}><span class={`rounded-full ring-offset-1 ring-offset-surface ${panel() === 'menu' ? 'ring-2 ring-accent' : ''}`}><Avatar image={person()?.image ?? null} initial={person()?.username || person()?.email || '?'} userId={person()?.id ?? ''} size={24} /></span></Show></button></Tooltip>
      </div>
    </header>
    <Show when={panel()}>
      <button type="button" aria-label="Close panel" class="fixed inset-0 z-40 cursor-default border-0 bg-black/25 p-0" onClick={close} />
      <Show when={panel() === 'menu'}>
        <nav aria-label="Menu" class="fixed inset-y-0 left-0 z-50 flex w-full flex-col border-r border-edge bg-surface p-2 pt-16 shadow-xl sm:w-72">
          <button type="button" aria-label="Dismiss menu" onClick={close} class="absolute right-3 top-3 rounded-full p-2 sm:hidden"><X size={17} /></button>
          <a href="/" aria-label="Hosted at artifactbin" class="mb-3 flex items-center gap-2.5 px-2 font-mono text-sm font-semibold text-fg no-underline"><img src="/logo-128.png" alt="" class="h-7 w-7" />artifactbin</a>
          {menuLink('/', 'Artifacts')}{menuLink('/chat', 'Remote sessions')}{menuLink('/notifications', 'Notifications')}{menuLink('/account', 'Account')}{menuLink('/docs-human', 'Human Docs')}
          <a href={REPO_URL} target="_blank" rel="noopener noreferrer" class={MENU_ITEM}>Support artifactbin</a>
          <div class="mt-auto" /><div class="my-1 h-px bg-edge" />
          <Show when={person()} fallback={<Show when={session()?.kind === 'anon'} fallback={<a href={loginHref(window.location)} class={MENU_ITEM}><LogIn size={15} />Login</a>}><button type="button" aria-label="Disconnect this browser" class={MENU_ITEM} onClick={() => void forgetTokens().then(() => { window.location.href = '/'; })}>Disconnect this browser</button></Show>}><button type="button" aria-label="Sign out" class={MENU_ITEM} onClick={() => void fetch('/api/auth/sign-out', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }).finally(() => { window.location.href = '/'; })}><LogOut size={15} />Sign out</button></Show>
        </nav>
      </Show>
      <Show when={panel() === 'controls'}><section aria-label={label()} class="fixed right-3 top-14 z-50 max-h-[80vh] w-72 max-w-[calc(100vw-24px)] overflow-auto rounded-[7px] border border-edge bg-surface p-3 font-mono text-xs shadow-xl"><div class="mb-3 flex items-center justify-between"><h1 class="font-mono text-xs font-semibold">{controlsName()}</h1><button type="button" aria-label={`Dismiss ${controlsName()}`} onClick={close}><X size={15} /></button></div><section aria-label="Appearance"><h2 class="mb-2 font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-faint">appearance</h2><div role="group" aria-label="Color mode" class="flex overflow-hidden rounded-[5px] border border-edge"><button type="button" aria-label="Light mode" aria-pressed={mode() === 'light'} onClick={() => pick('light')} class={modeClass('light')}><Sun size={14} strokeWidth={1.5} />light</button><button type="button" aria-label="Dark mode" aria-pressed={mode() === 'dark'} onClick={() => pick('dark')} class={modeClass('dark')}><Moon size={14} strokeWidth={1.5} />dark</button></div></section>
        <Show when={props.controls}>{render => <div class="mt-4 border-t border-edge pt-3">{render()(close)}</div>}</Show>
      </section></Show>
      <Show when={panel() === 'notifications'}><section aria-label="Notifications" class="fixed right-3 top-14 z-50 w-80 rounded-[7px] border border-edge bg-surface p-4 shadow-xl"><div class="mb-3 flex items-center justify-between"><h2 class="text-sm font-semibold">Notifications</h2><button type="button" aria-label="Close notifications" onClick={close}><X size={18} /></button></div><div class="max-h-[55vh] overflow-y-auto"><PeopleInbox compact close={close} /></div><nav aria-label="Notification links" class="mt-2 flex flex-col gap-2 border-t border-edge pt-3"><a href="/notifications" onClick={close}>All notifications</a><a href="/account#notifications" onClick={close}>Notification settings</a></nav></section></Show>
    </Show>
  </>;
}
