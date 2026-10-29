/* @jsxImportSource solid-js */
import { createSignal, For, Show, type JSX } from 'solid-js';
import type { GroupDetail, GroupMember, GroupRole } from '@artifactbin/contracts';
import type { AccountWorkspaceCore } from '@/lib/workspace/dashboard';
import { buildGroupSetupInstructions } from '@/lib/skills/setup-instructions';
import { copyText } from '../lib/copy-text';
import { apiRequest } from '../lib/api';
import { usePageData } from '../lib/use-page-data';
import Shelf from '../components/Shelf';
import WorkspaceShell from '../components/WorkspaceShell';
import Users from 'lucide-solid/icons/users';
import { DefaultDestinationControl, type DefaultDestinationState } from '../components/DefaultDestinationControl';
import { Button } from '../ui/Button';
import { Input, SearchField } from '../ui/Field';
import { Select } from '../ui/Select';
import { ListRow, Panel } from '../ui/Panel';
import { PageHeader, SectionHeading } from '../ui/PageHeader';
import { StatusMessage } from '../ui/StatusMessage';
import { Badge } from '../ui/ui';
import { HOME_WORKSPACE_COLUMN, WorkspaceSkeleton } from '../components/WorkspaceLayout';

/** A group's page at its own address: details first, then its shelf. Home hands `GroupWorkspace` both at once. */
export function GroupPage(props: { identity: string }): JSX.Element {
 const detail=usePageData<GroupDetail>(()=>`/api/groups/${encodeURIComponent(props.identity)}`);
 const shelf=usePageData<AccountWorkspaceCore>(()=>`/api/page/home?part=core&groupId=${encodeURIComponent(detail.data()?.group.id ?? '')}`,{enabled:()=>!!detail.data()});
 const refresh=()=>{void detail.refresh(true);void shelf.refresh(true);};
 return <main class={HOME_WORKSPACE_COLUMN}><Show when={detail.data()} fallback={<div class="p-8"><Show when={detail.error()} fallback={<WorkspaceSkeleton/>}><GroupUnavailable retry={()=>void detail.refresh(true)}/></Show></div>}>
 {value=><GroupWorkspace detail={value()} shelf={shelf.data()} shelfFailed={!!shelf.error()} retryShelf={()=>void shelf.refresh(true)} refresh={refresh}/>}
 </Show></main>;
}

/** The recovery state for a group this account cannot open (deleted, or membership removed). */
export function GroupUnavailable(props:{retry:()=>void}): JSX.Element {
 return <StatusMessage kind="error" action={<><a href="/?personal=1" class="font-medium text-accent hover:underline">Open Personal</a><Button variant="link" type="button" onClick={props.retry}>Retry group</Button></>}>This group is unavailable. Your default may no longer be accessible.</StatusMessage>;
}

/**
 * A group's page from data already in hand. `defaults` is the account preference and deployment the caller
 * already read (Home's bootstrap), so the default control makes no requests of its own; `onDefaultSaved`
 * tells the caller the homepage may now resolve elsewhere.
 */
export function GroupWorkspace(props: { detail: GroupDetail; shelf: AccountWorkspaceCore | null; shelfFailed: boolean; retryShelf: () => void; refresh: () => void; defaults?: DefaultDestinationState; onDefaultSaved?: () => void }): JSX.Element {
 const [error,setError]=createSignal(''); const [copied,setCopied]=createSignal(false);
 const copy=async()=>{try{if(await copyText(buildGroupSetupInstructions({serverOrigin:window.location.origin,groupHandle:props.detail.group.handle})))setCopied(true);else setError('Could not copy instructions.');}catch{setError('Could not copy instructions.');}};
 const value=()=>props.detail;
 return <WorkspaceShell onCreated={props.refresh} groupId={value().group.id} canCreate={value().group.role==='editor'}><div class="workspace-page groups-page">
 <a href="/groups" class="font-sans text-sm font-medium text-muted hover:text-accent">Groups</a>
 <PageHeader class="mb-9 mt-5" title={value().group.name} leading={<span class="group-avatar group-avatar-large" aria-hidden="true"><Users size={26}/></span>} badge={<Badge>{value().group.role==='editor'?'Editor':'Viewer'}</Badge>}
  description={<><p class="break-all"><a href={`/@${encodeURIComponent(value().group.handle)}`} class="rounded-chip underline-offset-4 hover:text-accent hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent">@{value().group.handle}</a></p><Show when={value().group.description}><p class="mt-3">{value().group.description}</p></Show></>}>
  <Panel class="flex flex-wrap items-start justify-between gap-5"><DefaultDestinationControl group={value().group} initial={props.defaults} onSaved={props.onDefaultSaved}/><Button variant="secondary" type="button" onClick={()=>void copy()}>{copied()?'Instructions copied':'Copy agent setup'}</Button></Panel>
 </PageHeader>
 <Show when={error()}><StatusMessage kind="error" class="my-3">{error()}</StatusMessage></Show>
 <section aria-label="Group artifacts" class="workspace-library"><SectionHeading class="mb-5">Files and folders</SectionHeading><Show when={props.shelf} fallback={<Show when={props.shelfFailed} fallback={<StatusMessage kind="loading">Loading artifacts…</StatusMessage>}><StatusMessage kind="error" action={<Button variant="link" type="button" onClick={props.retryShelf}>Retry artifacts</Button>}>Could not load group artifacts.</StatusMessage></Show>}>{rows=><Shelf groupId={value().group.id} rows={rows().artifacts} actions={value().group.role==='editor'?'full':'share'} assets={false} scopeParentId={null}/>}</Show></section>
 <GroupManagement detail={value()} refresh={props.refresh}/>
 </div></WorkspaceShell>;
}

const ROLE_OPTIONS=[{value:'editor',label:'Editor'},{value:'viewer',label:'Viewer'}];
const INVITE_ROLE_OPTIONS=[{value:'viewer',label:'Viewer'},{value:'editor',label:'Editor'}];

/** Membership edits use server-confirmed state. Refusals, including the last editor, stay visible. */
export function GroupManagement(props:{detail:GroupDetail;refresh:()=>void}):JSX.Element {
 const [query,setQuery]=createSignal(''); const [email,setEmail]=createSignal(''); const [role,setRole]=createSignal<GroupRole>('viewer'); const [link,setLink]=createSignal(''); const [error,setError]=createSignal(''); const [busy,setBusy]=createSignal(false);
 const editor=()=>props.detail.group.role==='editor'; const root=()=>`/api/groups/${props.detail.group.id}`;
 const searching=()=>!!query().trim();
 const search=usePageData<{members:GroupMember[]}>(()=>`${root()}/members?query=${encodeURIComponent(query().trim())}`,{enabled:searching});
 const mutate=async(path:string,method:'POST'|'PUT'|'DELETE',body?:unknown)=>{if(busy())return;setBusy(true);setError('');try{await apiRequest(path,method,body);props.refresh();if(searching())void search.refresh(true);}catch(e){setError(e instanceof Error ? e.message === 'last_editor' ? 'Keep at least one editor in this group. Add another editor before changing this person.' : e.message : 'Could not update group.');}finally{setBusy(false);}};
 const members=()=>searching() ? search.data()?.members ?? [] : props.detail.members;
 const nameOf=(person:GroupMember)=>person.name??person.username??'member';
 return <div class="mt-10 grid items-start gap-6 min-[1100px]:grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)]"><Show when={error()}><StatusMessage kind="error" class="min-[1100px]:col-span-2">{error()}</StatusMessage></Show>
 <Panel label="Group people" title="People">
  <SearchField label="Search people" value={query()} onValue={setQuery} clearOnEscape/>
  <div class="mt-3 empty:hidden"><Show when={searching() && search.pending()}><StatusMessage kind="loading">Searching people…</StatusMessage></Show><Show when={searching() && search.error()}><StatusMessage kind="error" action={<Button variant="link" type="button" onClick={()=>void search.refresh(true)}>Retry people search</Button>}>Could not search people.</StatusMessage></Show><Show when={searching() && search.data() && !search.pending() && !search.error() && !members().length}><StatusMessage kind="empty">No people match your search.</StatusMessage></Show></div>
  <ul class="mt-2"><For each={members()}>{person=><ListRow><Show when={person.username} fallback={<span class="min-w-0 flex-1">{person.name??'Member'}</span>}><a class="min-w-0 flex-1 break-words font-medium hover:text-accent" href={`/@${encodeURIComponent(person.username!)}`}>{person.name??person.username}</a></Show><Show when={editor()} fallback={<Badge tone="dim">{person.role}</Badge>}><Select class="w-32" ariaLabel={`Role for ${nameOf(person)}`} value={person.role} options={ROLE_OPTIONS} disabled={busy()} onChange={next=>{if(next!==person.role)void mutate(`${root()}/members/${person.user_id}`,'PUT',{role:next});}}/><Button variant="danger" type="button" disabled={busy()} aria-label={`Remove ${nameOf(person)}`} onClick={()=>void mutate(`${root()}/members/${person.user_id}`,'DELETE')}>Remove</Button></Show></ListRow>}</For></ul>
  <Show when={editor()}><form class="mt-6 grid gap-3 sm:grid-cols-[minmax(0,1fr)_8rem]" onSubmit={e=>{e.preventDefault();void mutate(`${root()}/invitations`,'POST',{email:email(),role:role()});}}><Input type="email" required aria-label="Invitation email" placeholder="Email address" value={email()} onInput={e=>setEmail(e.currentTarget.value)}/><Select ariaLabel="Invitation role" value={role()} options={INVITE_ROLE_OPTIONS} onChange={next=>setRole(next as GroupRole)}/><Button class="justify-self-start sm:col-span-2" disabled={busy()} type="submit">Invite person</Button></form><ul class="mt-2"><For each={props.detail.invitations}>{invite=><ListRow class="justify-between"><span class="min-w-0 break-words">{invite.email} · {invite.role}</span><Button variant="secondary" type="button" disabled={busy()} aria-label={`Cancel invitation to ${invite.email}`} onClick={()=>void mutate(`${root()}/invitations/${invite.id}`,'DELETE')}>Cancel invitation</Button></ListRow>}</For></ul></Show>
 </Panel>
 <Panel label="Linked groups" title="Linked groups"><p class="text-sm leading-relaxed text-muted">Links help you navigate. Each group keeps its own membership and access.</p><Show when={!props.detail.linked_groups.length}><StatusMessage kind="empty" class="my-5">No linked groups yet.</StatusMessage></Show><ul class="mt-2"><For each={props.detail.linked_groups}>{group=><ListRow class="justify-between"><a class="font-medium hover:text-accent" href={`/@${group.handle}`}>{group.name}</a><Show when={editor()}><Button variant="secondary" type="button" disabled={busy()} aria-label={`Unlink ${group.name}`} onClick={()=>void mutate(`${root()}/links/${group.id}`,'DELETE')}>Unlink</Button></Show></ListRow>}</For></ul><Show when={editor()}><form class="mt-5 flex flex-wrap gap-3" onSubmit={async e=>{e.preventDefault();setError('');try{const group=await apiRequest<GroupDetail>(`/api/groups/${encodeURIComponent(link())}`);await mutate(`${root()}/links/${group.group.id}`,'PUT');}catch(err){setError(err instanceof Error?err.message:'Group unavailable.');}}}><Input class="flex-1 basis-40" required aria-label="Linked group handle" placeholder="Group handle" value={link()} onInput={e=>setLink(e.currentTarget.value)}/><Button variant="secondary" type="submit" disabled={busy()}>Link group</Button></form></Show></Panel></div>;
}
