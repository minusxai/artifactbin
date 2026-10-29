/* @jsxImportSource solid-js */
/**
 * THE APP BAR'S THREE PANELS (menu, page controls, notifications), each a solid/ui Drawer under the bar. They are
 * interaction-only, so PageChrome loads this module with `lazy()` the first time a panel opens: on the document
 * page (the reader, whose prose budget is 250 KB) the Drawer, ToggleGroup and the inbox stay out of the bytes
 * a reader loads.
 */
import { Show, type JSX } from 'solid-js';
import { BookOpen, FileText, LogIn, LogOut, Moon, Sun, User, X } from 'lucide-solid';
import { useLocation } from '@solidjs/router';
import { REPO_URL } from '@/lib/http/urls';
import { loginHref } from '@/lib/http/login-href';
import { endPagesSessions } from './browser-session';
import { PageControlsBody } from './PageBar';
import { PeopleInbox } from './PeopleInbox';
import { useSession } from '../lib/session';
import { GitHubIcon } from '../ui/brand-icons';
import { Button } from '../ui/Button';
import { Drawer } from '../ui/Drawer';
import { SectionHeading } from '../ui/PageHeader';
import { ToggleGroup } from '../ui/ToggleGroup';
import { MicroLabel } from '../ui/ui';

/** The app bar's height: the panels and their scrim start under it. */
const BAR_HEIGHT = 44;

/**
 * The app menu (links, then sign out / disconnect / login), shared by the app bar and the document
 * page. It opens under the bar at the right, or as a bottom sheet on a phone.
 */
export function MenuPanel(props: { close: () => void; phone?: boolean; top?: number }): JSX.Element {
  const { session } = useSession();
  const location = useLocation();
  const person = () => session()?.kind === 'account' ? session()?.user : null;
  const close = () => props.close();
  /** Every row is a ghost Button: md (a finger's row) in the phone sheet, sm chrome in the side panel. */
  const size = () => (props.phone ? 'md' : 'sm');
  const link = (href: string, label: string, icon: JSX.Element) => <Button variant="ghost" size={size()} href={href} current={location.pathname === href}
    rel={['/', '/assets', '/trash', '/login', '/start', '/welcome', '/notifications', '/account', '/docs-human'].includes(href) ? undefined : 'external'} aria-label={label}
    class="w-full justify-start" onClick={close}>{icon}{label}</Button>;
  return (
    <Drawer label="Menu" role="navigation" side={props.phone ? 'bottom' : 'right'} top={props.top ?? BAR_HEIGHT} onClose={close}>
      <Button variant="secondary" size="sm" icon aria-label="Dismiss menu" onClick={close} style={{ top: 'max(12px, env(safe-area-inset-top))' }} class="absolute right-3 top-3 sm:hidden"><X size={17} stroke-width={1.5} /></Button>
      <a href="/" aria-label="Hosted at artifactbin" class="mb-3 flex items-center gap-2.5 px-2 font-mono text-sm font-semibold text-fg no-underline transition-colors hover:text-accent"><img src="/logo-128.png" alt="" class="h-7 w-7" />artifactbin</a>
      {link('/', 'Artifacts', <FileText size={15} stroke-width={1.5} />)}
      {link('/notifications', 'Notifications', <User size={15} stroke-width={1.5} />)}
      {link('/account', 'Account', <User size={15} stroke-width={1.5} />)}
      {link('/docs-human', 'Human Docs', <BookOpen size={15} stroke-width={1.5} />)}
      <Button variant="ghost" size={size()} href={REPO_URL} target="_blank" rel="noopener noreferrer" class="w-full justify-start" onClick={close}><GitHubIcon size={15} />Support artifactbin</Button>
      <div class="mt-auto" /><div class="my-1 h-px bg-edge" />
      <Show when={person()} fallback={link(loginHref(window.location), 'Login', <LogIn size={15} stroke-width={1.5} />)}>
        <Button variant="ghost" size={size()} aria-label="Sign out" class="w-full justify-start" onClick={() => void endPagesSessions().then(() => fetch('/api/auth/sign-out', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }).catch(() => null)).then(() => { window.location.href = '/'; })}><LogOut size={15} stroke-width={1.5} />Sign out</Button>
      </Show>
    </Drawer>
  );
}

/** The notifications panel, shared by the app bar and the document page. */
export function NotificationsPanel(props: { close: () => void }): JSX.Element {
  const close = () => props.close();
  return <Drawer label="Notifications" role="region" top={BAR_HEIGHT} onClose={close}>
    <header class="mb-3 flex items-center justify-between gap-3 px-1"><SectionHeading>Notifications</SectionHeading><Button variant="ghost" size="sm" icon aria-label="Close notifications" onClick={close}><X size={18} /></Button></header>
    <div class="max-h-[55vh] overflow-y-auto"><PeopleInbox compact close={close} /></div>
    <nav aria-label="Notification links" class="mt-2 flex flex-col gap-2 border-t border-edge pt-3"><a href="/notifications" onClick={close}>All notifications</a><a href="/account#notifications" onClick={close}>Notification settings</a></nav>
  </Drawer>;
}

/** The page controls: the appearance picker, then the artifact's own rows (`children`). */
export function ControlsPanel(props: { label: string; title: string; mode: 'light' | 'dark'; onMode: (next: 'light' | 'dark') => void; onClose: () => void; children?: JSX.Element }): JSX.Element {
  return <Drawer label={props.label} role="region" top={BAR_HEIGHT} onClose={props.onClose}>
    <div class="font-sans"><PageControlsBody title={props.title} onClose={props.onClose}>
      <section aria-label="Appearance"><h2 class="mb-2"><MicroLabel>appearance</MicroLabel></h2><ToggleGroup label="Color mode" fill value={props.mode} onChange={next => props.onMode(next as 'light' | 'dark')}
        options={[{ value: 'light', label: 'light', ariaLabel: 'Light mode', icon: () => <Sun size={14} strokeWidth={1.5} /> }, { value: 'dark', label: 'dark', ariaLabel: 'Dark mode', icon: () => <Moon size={14} strokeWidth={1.5} /> }]} /></section>
      {props.children}
    </PageControlsBody></div>
  </Drawer>;
}
