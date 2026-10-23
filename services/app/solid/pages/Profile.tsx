/* @jsxImportSource solid-js */
import { createMemo, createSignal, For, lazy, Show, type JSX } from 'solid-js';
import { Navigate, useLocation, useParams } from '@solidjs/router';
import { Folder, LayoutGrid, List } from 'lucide-solid';
import { canonicalArtifactPath } from '@/lib/http/urls';
import { buildShelf, groupShelfByRecency, type ShelfRow } from '@/lib/workspace/shelf';
import type { ProfileSocial } from '@/lib/accounts';
import { refusedForSignIn } from '@artifactbin/contracts';
import { loginHref } from '@/lib/http/login-href';
import { pageDataChanged } from '@/solid/lib/page-data-events';
import { takeBootstrap } from '@/solid/lib/bootstrap';
import { Avatar } from '../ui/Avatar';
import { usePageData } from '../lib/use-page-data';
import { NotFoundPage } from './NotFound';
import { apiFetch } from '../lib/api';
import { Button } from '../ui/Button';
import { SearchField } from '../ui/Field';
import { ToggleGroup } from '../ui/ToggleGroup';
import { Panel } from '../ui/Panel';
import { SectionHeading } from '../ui/PageHeader';
import { Badge } from '../ui/ui';
import { artifactLink } from '../lib/artifact-link';

// Group workspaces are a separate lazy browser chunk; artifact aliases stay reader-only.
const GroupPage = lazy(() => import('./Group').then(m=>({default:m.GroupPage})));

interface ProfileAnswer {
  kind: 'public-profile' | 'redirect' | 'artifact' | 'group';
  to?: string;
  handle?: string;
  owner?: { id: string; image: string | null };
  social?: ProfileSocial;
  authed?: boolean;
  files?: ShelfRow[];
}

/** The profile index is its own route; its artifact aliases have a separate lazy route entry (ProfileAlias.tsx). */
export function ProfilePage(): JSX.Element {
  const params = useParams();
  const location = useLocation();
  const path = () => `/${params.user}`;
  const page = usePageData<ProfileAnswer>(() => `/api/page/profile/${encodeURIComponent(params.user ?? '')}`, {
    seed: () => takeBootstrap<ProfileAnswer>(location.pathname, 'profile'),
  });
  return <Show when={page.data()} fallback={<Show when={page.error()} fallback={<main aria-label="Loading page" role="status" class="mx-auto max-w-4xl px-4 py-10">Loading profile…</main>}><NotFoundPage /></Show>}>
    {answer => <Show when={answer().kind !== 'group'} fallback={<GroupPage identity={answer().handle!}/>}><Show when={answer().kind === 'public-profile' && answer().handle} fallback={answer().kind === 'redirect' && answer().to ? <Navigate href={answer().to!} /> : <NotFoundPage />}>
      <main class="mx-auto max-w-6xl px-5 py-8 font-sans sm:px-8 sm:py-10">
        <Show when={page.error()}><Button variant="secondary" class="mb-4" type="button" aria-label="Retry profile" onClick={() => void page.refresh(true)}>Could not refresh profile. Retry</Button></Show>
        <header class="mb-8 border-b border-edge pb-7">
          <p class="text-sm text-muted">Public profile</p>
          <div class="mt-2 flex items-center gap-3"><Show when={answer().owner}><Avatar userId={answer().owner!.id} image={answer().owner!.image ?? null} initial={answer().handle!} size={48} /></Show><h1 class="flex min-w-0 flex-wrap items-baseline gap-x-1.5 text-3xl font-semibold tracking-tight text-fg"><a href={path()} aria-label="Profile root" class="min-w-0 break-all no-underline transition-colors hover:text-accent"><span class="text-accent">@</span>{answer().handle}</a></h1></div>
          <Show when={answer().owner && answer().social}><Social ownerId={answer().owner!.id} social={answer().social!} signedIn={!!answer().authed} /></Show>
          <p class="mt-4 text-sm text-muted">{(answer().files ?? []).filter(row => row.format === 'html' || row.format === 'folder').length} public artifact{(answer().files ?? []).filter(row => row.format === 'html' || row.format === 'folder').length === 1 ? '' : 's'}</p>
        </header>
        <Show when={answer().files?.length} fallback={<Panel class="px-6 py-12 text-center"><SectionHeading>No public artifacts yet</SectionHeading><p class="mt-2 text-sm text-muted">Public documents shared by this person will appear here.</p></Panel>}><ProfileShelf handle={answer().handle!} rows={answer().files!} /></Show>
      </main>
    </Show></Show>}
  </Show>;
}


function Social(props: { ownerId: string; social: ProfileSocial; signedIn: boolean }): JSX.Element {
  const [following, setFollowing] = createSignal(props.social.relation?.youFollow ?? false);
  const [followers, setFollowers] = createSignal(props.social.followers);
  const [busy, setBusy] = createSignal(false);
  let inFlight = false;
  const toggle = async () => {
    if (inFlight) return;
    inFlight = true; setBusy(true);
    try {
      const response = await apiFetch(`/api/users/${props.ownerId}/follow`, following() ? 'DELETE' : 'POST');
      if (await refusedForSignIn(response)) { window.location.assign(loginHref(window.location)); return; }
      if (response.ok) { const answer = await response.json() as { following: boolean; count: number }; setFollowing(answer.following); setFollowers(answer.count); pageDataChanged(); }
    } catch { /* Keep the server-confirmed state. */ }
    finally { inFlight = false; setBusy(false); }
  };
  const label = () => following() ? 'Following' : props.social.relation?.followsYou ? 'Follow back' : 'Follow';
  return <div role="group" aria-label="Follows" class="mt-3 flex flex-col gap-2"><div class="flex flex-wrap items-center gap-x-4 gap-y-2"><p class="flex flex-wrap items-center gap-x-3 text-sm text-muted"><span><strong class="text-fg">{props.social.following.toLocaleString('en-US')}</strong> Following</span><span><strong class="text-fg">{followers().toLocaleString('en-US')}</strong> {followers() === 1 ? 'Follower' : 'Followers'}</span><Show when={props.social.relation?.followsYou}><Badge>Follows you</Badge></Show></p><Show when={props.social.relation || !props.signedIn}><Show when={props.signedIn} fallback={<Button href={loginHref(window.location)} aria-label="Follow">Follow</Button>}><Button type="button" aria-label={label()} pressed={following()} disabled={busy()} onClick={() => void toggle()}>{label()}</Button></Show></Show></div><Show when={props.social.relation?.knownTotal}><p class="text-xs text-muted">Followed by <For each={props.social.relation?.known}>{(person, i) => <><Show when={i() > 0}>, </Show><a href={`/@${person.username}`}>{person.username}</a></>}</For></p></Show></div>;
}

function ProfileShelf(props: { handle: string; rows: ShelfRow[] }): JSX.Element {
  const [query, setQuery] = createSignal('');
  const initialView = (): 'grid' | 'list' => { try { return localStorage.getItem('artifactbin:shelf-view') === 'list' ? 'list' : 'grid'; } catch { return 'grid'; } };
  const [view, setView] = createSignal<'grid' | 'list'>(initialView());
  const choose = (next: 'grid' | 'list') => { setView(next); try { localStorage.setItem('artifactbin:shelf-view', next); } catch { /* Optional preference. */ } };
  const visible = createMemo(() => buildShelf(props.rows.filter(row => (row.format === 'html' || row.format === 'folder') && `${row.title ?? ''} ${row.description ?? ''} ${row.format}`.toLowerCase().includes(query().trim().toLowerCase()))));
  const url = (row: ShelfRow) => canonicalArtifactPath(row, props.handle);
  return <section aria-label="Shelf" data-shelf-view={view()} class="flex flex-col gap-4">
    <div class="flex items-center gap-3"><SearchField label="Search artifacts" value={query()} onValue={setQuery} class="flex-1" /><ToggleGroup label="Shelf view" iconOnly value={view()} onChange={next => choose(next as 'grid' | 'list')} options={[{ value: 'grid', label: 'Grid view', icon: () => <LayoutGrid size={14} /> }, { value: 'list', label: 'List view', icon: () => <List size={14} /> }]} /></div>
    <Show when={query() && visible().documents.length + visible().folders.length === 0}><p aria-label="No matches" class="rounded-lg border border-edge bg-surface p-6 text-sm text-muted">No artifacts match your search.</p></Show>
    <Show when={view() === 'grid'} fallback={<div aria-label="Artifact list" role="region"><For each={[...visible().folders, ...visible().documents]}>{row => <a {...artifactLink(url(row), row.format)} aria-label={`Open ${row.title ?? row.id}`} class="flex items-center justify-between gap-4 border-b border-edge px-3 py-4 text-sm text-fg no-underline transition-colors hover:bg-raised"><span>{row.title ?? 'Untitled'}</span><span class="font-mono text-xs text-muted">{new Date(row.updated_at).toLocaleDateString('en-US')}</span></a>}</For></div>}>
      <Show when={visible().folders.length}><section aria-label="Folders"><h2 class="mb-3 text-sm font-semibold text-fg">Folders</h2><ul class="grid grid-cols-2 gap-3 lg:grid-cols-4"><For each={visible().folders}>{row => <li class="rounded-lg border border-edge bg-surface p-4 transition-colors hover:bg-raised"><a {...artifactLink(url(row), row.format)} aria-label={`Open folder ${row.title ?? row.id}`} class="block text-sm font-semibold text-fg no-underline"><Folder size={24} class="mb-4 text-accent" />{row.title ?? 'Untitled'}</a></li>}</For></ul></section></Show>
      <div aria-label="Artifact grid" role="region" class="flex flex-col gap-7"><For each={groupShelfByRecency(visible().documents)}>{group => <section aria-label={`${group.label} artifacts`}><h2 class="mb-3 text-sm font-semibold text-fg">{group.label}</h2><ul class="grid grid-cols-2 gap-2 sm:gap-5 lg:grid-cols-4"><For each={group.rows}>{row => <li class="reveal group relative flex min-w-0 flex-col rounded-md p-1 transition-colors hover:bg-raised/60 sm:p-2"><a {...artifactLink(url(row), row.format)} aria-label={`Open ${row.title ?? row.id}`} class="block no-underline"><div class="aspect-[5/3] rounded-chip border border-edge bg-raised shadow-sm" style={{ 'background-image': `url(/a/${row.id}/export?format=jpg&mode=card&v=${row.version})`, 'background-position': 'center', 'background-size': 'cover' }} /><span class="mt-3 block break-words text-sm font-semibold text-fg">{row.title ?? 'Untitled'}</span></a><Show when={row.description}><p class="mt-1 line-clamp-2 text-sm text-muted">{row.description}</p></Show></li>}</For></ul></section>}</For></div>
    </Show>
  </section>;
}
