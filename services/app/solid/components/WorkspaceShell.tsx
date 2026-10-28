/* @jsxImportSource solid-js */
import { createSignal, For, Show, type JSX } from 'solid-js';
import { useLocation } from '@solidjs/router';
import { Bell, BookOpen, Database, FileText } from 'lucide-solid';
import Menu from 'lucide-solid/icons/menu';
import X from 'lucide-solid/icons/x';
import Settings2 from 'lucide-solid/icons/settings-2';
import Trash2 from 'lucide-solid/icons/trash-2';
import UserRound from 'lucide-solid/icons/user-round';
import { pageDataChanged } from '@/solid/lib/page-data-events';
import { useOptionalInbox } from '../lib/notifications';
import WorkspaceCreate from './WorkspaceCreate';
import { Avatar } from '../ui/Avatar';
import { Badge } from '../ui/ui';
import { Button } from '../ui/Button';
import { useSession } from '../lib/session';
import './workspace.css';

/** Workspace navigation owns route links and creation; pages own their content and data. */
export default function WorkspaceShell(props: { children: JSX.Element; parentId?: string | null; onCreated?: () => void; groupId?: string; canCreate?: boolean; personal?: boolean }): JSX.Element {
  const location = useLocation();
  const [navigationOpen, setNavigationOpen] = createSignal(false);
  const inbox = useOptionalInbox();
  const { session } = useSession();
  const person = () => session()?.kind === 'account' ? session()?.user : null;
  const links = [
    { label: 'Artifacts', href: '/', Icon: FileText },
    { label: 'Groups', href: '/groups', Icon: UserRound },
    { label: 'Personal', href: '/?personal=1', Icon: UserRound },
    { label: 'Assets', href: '/assets', Icon: Database },
    { label: 'Trash', href: '/trash', Icon: Trash2 },
    { label: 'Notifications', href: '/notifications', Icon: Bell },
  ];
  const personalView = () => location.pathname === '/' && new URLSearchParams(location.search).get('personal') === '1';
  const active = (href: string) => href === '/?personal=1' ? personalView() : href === '/' ? (location.pathname === '/' && !personalView()) || Boolean(props.parentId) : href === '/groups' ? location.pathname === '/groups' || (Boolean(props.groupId) && location.pathname.startsWith('/@')) : location.pathname === href;
  return <div class="workspace-shell">
    <nav aria-label="Workspace" class="workspace-nav" data-expanded={navigationOpen()}>
      <div class="workspace-nav-top">
      <Show when={props.canCreate !== false}><WorkspaceCreate parentId={props.parentId} groupId={props.groupId} personal={props.personal} onCreated={props.onCreated ?? pageDataChanged} /></Show>
      <Button variant="secondary" class="workspace-mobile-toggle" aria-label="Toggle navigation" aria-controls="workspace-navigation" aria-expanded={navigationOpen()} onClick={()=>setNavigationOpen(open=>!open)}><Show when={navigationOpen()} fallback={<Menu size={18}/>}><X size={18}/></Show><span>Navigation</span></Button></div>
      <div id="workspace-navigation" class="workspace-navigation">
      <p class="workspace-nav-label">Workspace</p>
      <div class="workspace-nav-links"><For each={links}>{({ label, href, Icon }, index) => <a href={href} aria-label={label} aria-current={active(href) ? 'page' : undefined} class={`workspace-nav-link ${index() === 3 ? 'workspace-nav-divider' : ''}`}><Icon size={17} stroke-width={1.6} /><span>{label}</span><Show when={href === '/notifications' && inbox?.state()?.unread}>{count => <span aria-label={`${count()} unread notifications`} class="ml-auto"><Badge tone="accent">{Number(count()) > 99 ? '99+' : count()}</Badge></span>}</Show></a>}</For>
      </div>
      <div class="workspace-nav-footer"><a href="/docs-human" aria-current={active('/docs-human') ? 'page' : undefined} class="workspace-nav-link"><BookOpen size={15} stroke-width={1.6} /><span>Human docs</span></a><Show when={person()?.username}>{username => <a href={`/@${encodeURIComponent(username())}`} class="workspace-nav-link"><UserRound size={15} stroke-width={1.6} /><span>Public profile</span></a>}</Show><a href="/account" aria-label="Account settings" aria-current={active('/account') ? 'page' : undefined} class="workspace-nav-link workspace-account"><Show when={person()} fallback={<Settings2 size={15} stroke-width={1.6} />}>
        {user => <Avatar image={user().image} initial={user().username || user().email || '?'} userId={user().id} size={24} />}
      </Show><span class="workspace-account-copy"><span>{person()?.email || person()?.username || 'Account'}</span></span></a><p class="workspace-tagline">Google Docs for agents</p></div>
      </div>
    </nav>
    <div class="workspace-content">{props.children}</div>
  </div>;
}
