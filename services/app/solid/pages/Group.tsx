import { personLabel } from '../lib/person-label';
import {canEditGroupContent} from '@artifactbin/contracts/groups';
/* @jsxImportSource solid-js */
import { createSignal, For, lazy, Show, type JSX } from 'solid-js';
import type { GroupDetail, GroupMember, GroupRole } from '@artifactbin/contracts/groups';
import type { AccountWorkspaceCore } from '@/lib/workspace';
import { buildGroupSetupInstructions } from '@/lib/skills/setup-instructions';
import { usePageBreadcrumbs } from '../lib/page-breadcrumbs';
import { copyText } from '../lib/copy-text';
import { apiRequest } from '../lib/api';
import { usePageData } from '../lib/use-page-data';
import Shelf from '../components/Shelf';
import WorkspaceShell from '../components/WorkspaceShell';
import Users from 'lucide-solid/icons/users';
import Settings from 'lucide-solid/icons/settings';
import { Tooltip } from '../ui/Tooltip';
import { DefaultDestinationControl, type DefaultDestinationState } from '../components/DefaultDestinationControl';
import { Button } from '../ui/Button';
import { Input, SearchField } from '../ui/Field';
import { Select } from '../ui/Select';
import { ListRow, Panel } from '../ui/Panel';
import { PageHeader, SectionHeading } from '../ui/PageHeader';
import { StatusMessage } from '../ui/StatusMessage';
import { Badge } from '../ui/ui';
import { HOME_WORKSPACE_COLUMN, WorkspaceSkeleton } from '../components/WorkspaceLayout';
import { GroupTreePanel, GroupTreeSummary, SubgroupAudience } from './GroupTree';
import { GroupAddresses } from './GroupAddresses';
import { GroupSignIns } from './GroupSignIns';
import { GroupServiceSignIns } from './GroupServiceSignIns';

// The audience notice is only needed on the company group's shelf.
const GroupAudienceNotice = lazy(() => import('./GroupAudienceNotice'));

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
 const value=()=>props.detail;
 usePageBreadcrumbs(()=>[{label:value().group.name}]);
 return <WorkspaceShell onCreated={props.refresh} groupId={value().group.id} canCreate={canEditGroupContent(value().group.role) || value().can_publish_pages===true} publishOnly={!canEditGroupContent(value().group.role)}><div class="workspace-page groups-page">
 <a href="/groups" class="font-sans text-sm font-medium text-muted hover:text-accent">Groups</a>
 <PageHeader class="mb-9 mt-5" title={value().group.name} leading={<span class="group-avatar group-avatar-large" aria-hidden="true"><Users size={26}/></span>} actions={<><DefaultDestinationControl compact group={value().group} initial={props.defaults} onSaved={props.onDefaultSaved}/><Tooltip content="Manage people, invitations, subgroups and linked groups."><Button size="sm" variant="secondary" icon aria-label="Group settings" href={`/groups/${encodeURIComponent(value().group.handle)}/settings`}><Settings size={16} aria-hidden="true"/></Button></Tooltip></>} badge={<Badge>{value().group.role==='admin'?'Admin':'Member'}</Badge>}
  description={<><p class="break-all"><a href={`/@${encodeURIComponent(value().group.handle)}`} class="rounded-chip underline-offset-4 hover:text-accent hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent">/@{value().group.handle}</a></p><Show when={value().group.description}><p class="mt-3">{value().group.description}</p></Show><InheritedAdmin detail={value()}/><GroupTreeSummary detail={value()}/></>}>
 </PageHeader>
 <section aria-label="Group artifacts" class="workspace-library"><SectionHeading class="mb-5">Files and folders</SectionHeading><Show when={value().group.company_root}><GroupAudienceNotice/></Show><Show when={props.shelf} fallback={<Show when={props.shelfFailed} fallback={<StatusMessage kind="loading">Loading artifacts…</StatusMessage>}><StatusMessage kind="error" action={<Button variant="link" type="button" onClick={props.retryShelf}>Retry artifacts</Button>}>Could not load group artifacts.</StatusMessage></Show>}>{rows=><Shelf groupId={value().group.id} rows={rows().artifacts} actions={value().group.role==='admin'?'full':'share'} assets={false} scopeParentId={null}/>}</Show></section>
 </div></WorkspaceShell>;
}

/** An inherited admin's authority, said where they act: it comes from the parent group, and they are not a member here. */
function InheritedAdmin(props:{detail:GroupDetail}):JSX.Element {
 return <Show when={props.detail.admin_via}>{via=><p class="mt-3 text-sm text-muted">You are an admin here through <a class="font-medium hover:text-accent" href={`/@${encodeURIComponent(via().handle)}`}>{via().name}</a>, a parent group. You are not a member of {props.detail.group.name}.</p>}</Show>;
}

/** Group administration has its own address; it never loads the artifact shelf. */
export function GroupSettingsPage(props:{identity:string}):JSX.Element {
 const detail=usePageData<GroupDetail>(()=>`/api/groups/${encodeURIComponent(props.identity)}`);
 return <main class={HOME_WORKSPACE_COLUMN}><Show when={detail.data()} fallback={<div class="p-8"><Show when={detail.error()} fallback={<WorkspaceSkeleton/>}><GroupUnavailable retry={()=>void detail.refresh(true)}/></Show></div>}>
 {value=><WorkspaceShell groupId={value().group.id} canCreate={false}><GroupSettings detail={value()} refresh={()=>void detail.refresh(true)}/></WorkspaceShell>}
 </Show></main>;
}

function GroupSettings(props:{detail:GroupDetail;refresh:()=>void}):JSX.Element {
 usePageBreadcrumbs(()=>[{label:props.detail.group.name,href:`/@${props.detail.group.handle}`},{label:'Group settings'}]);
 const [error,setError]=createSignal(''); const [copied,setCopied]=createSignal(false);
 const copy=async()=>{try{if(await copyText(buildGroupSetupInstructions({serverOrigin:window.location.origin,groupHandle:props.detail.group.handle})))setCopied(true);else setError('Could not copy instructions.');}catch{setError('Could not copy instructions.');}};
 return <div class="workspace-page groups-page">
 <a href={`/@${encodeURIComponent(props.detail.group.handle)}`} class="font-sans text-sm font-medium text-muted hover:text-accent">Back to {props.detail.group.name}</a>
 <PageHeader class="mt-5" title="Group settings" description={props.detail.group.name} actions={<Button size="sm" variant="secondary" type="button" onClick={()=>void copy()}>{copied()?'Instructions copied':'Copy agent setup'}</Button>}/>
 <Show when={error()}><StatusMessage kind="error" class="my-3">{error()}</StatusMessage></Show>
 <GroupManagement detail={props.detail} refresh={props.refresh}/>
 <div class="mt-6"><GroupTreePanel detail={props.detail} refresh={props.refresh}/></div>
 <div class="mt-6"><GroupAddresses group={props.detail.group}/></div>
 <div class="mt-6 empty:hidden"><GroupSignIns group={props.detail.group}/></div>
 <div class="mt-6 empty:hidden"><GroupServiceSignIns group={props.detail.group}/></div>
 </div>;
}

const ROLE_OPTIONS=[{value:'member',label:'Member'},{value:'admin',label:'Admin'}];
const INVITE_ROLE_OPTIONS=ROLE_OPTIONS;

/** Membership edits use server-confirmed state. Refusals, including the last admin, stay visible. */
export function GroupManagement(props:{detail:GroupDetail;refresh:()=>void}):JSX.Element {
 const [query,setQuery]=createSignal(''); const [email,setEmail]=createSignal(''); const [role,setRole]=createSignal<GroupRole>('member'); const [link,setLink]=createSignal(''); const [error,setError]=createSignal(''); const [busy,setBusy]=createSignal(false);
 const admin=()=>props.detail.group.role==='admin'; const root=()=>`/api/groups/${props.detail.group.id}`;
 const searching=()=>!!query().trim();
 const search=usePageData<{members:GroupMember[]}>(()=>`${root()}/members?query=${encodeURIComponent(query().trim())}`,{enabled:searching});
 const mutate=async(path:string,method:'POST'|'PUT'|'PATCH'|'DELETE',body?:unknown)=>{if(busy())return;setBusy(true);setError('');try{await apiRequest(path,method,body);props.refresh();if(searching())void search.refresh(true);}catch(e){setError(e instanceof Error ? e.message === 'last_admin' ? 'Keep at least one admin in this group. Add another admin before changing this person.' : e.message === 'deployment_owner_required' ? 'The company owner must remain in this group.' : e.message : 'Could not update group.');}finally{setBusy(false);}};
 const members=()=>searching() ? search.data()?.members ?? [] : props.detail.members;
 const nameOf=(person:GroupMember)=>personLabel(person, 'Member');
 return <div class="mt-10 grid items-start gap-6 min-[1100px]:grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)]"><Show when={error()}><StatusMessage kind="error" class="min-[1100px]:col-span-2">{error()}</StatusMessage></Show>
 <Show when={admin()}><Panel title="Tenancy ID" label="Group tenancy">
  <Show when={props.detail.group.host_provisioned === false} fallback={<p>{props.detail.group.tenancy_id ?? 'Unset'} · Managed by the sign-in provider</p>}>
   <form class="flex gap-3" onSubmit={e=>{
    e.preventDefault();
    const value=new FormData(e.currentTarget).get('tenancy_id');
    if(typeof value==='string')void mutate(root(),'PATCH',{tenancy_id:value || null});
   }}>
    <Input aria-label="Tenancy ID" name="tenancy_id" maxLength={200} value={props.detail.group.tenancy_id ?? ''}/>
    <Button type="submit" disabled={busy()}>Save tenancy ID</Button>
   </form>
  </Show>
 </Panel></Show>
 <Panel label="Group people" title="People">
  <p class="mb-3 text-sm leading-relaxed text-muted">Members of {props.detail.group.name} itself. Membership is direct: it does not come from a parent group or a subgroup.</p>
  <p class="mb-3 text-sm leading-relaxed text-muted">Members read group files and can publish new pages in their own ordinary groups. Only root Admins can publish into the company root. Admins can edit group files and manage people, settings and group-owned sharing, here and in every subgroup. Personal files stay private unless shared.</p>
  <Show when={props.detail.group.host_provisioned}><p class="mb-3 text-sm leading-relaxed text-muted">The sign-in provider decides who can join this group.</p></Show>
  <Show when={admin() && props.detail.group.company_root}><p class="mb-3 text-sm leading-relaxed text-muted">Removing someone from this group ends their access to the company workspace.</p></Show>
  <InheritedAdmin detail={props.detail}/>
  <SearchField label="Search people" value={query()} onValue={setQuery} clearOnEscape/>
  <div class="mt-3 empty:hidden"><Show when={searching() && search.pending()}><StatusMessage kind="loading">Searching people…</StatusMessage></Show><Show when={searching() && search.error()}><StatusMessage kind="error" action={<Button variant="link" type="button" onClick={()=>void search.refresh(true)}>Retry people search</Button>}>Could not search people.</StatusMessage></Show><Show when={searching() && search.data() && !search.pending() && !search.error() && !members().length}><StatusMessage kind="empty">No people match your search.</StatusMessage></Show></div>
  <ul class="mt-2"><For each={members()}>{person=><ListRow><Show when={person.username} fallback={<span class="min-w-0 flex-1">{nameOf(person)}</span>}><a class="min-w-0 flex-1 break-words font-medium hover:text-accent" href={`/@${encodeURIComponent(person.username!)}`}>{nameOf(person)}</a></Show><Show when={admin() && !props.detail.group.host_provisioned} fallback={<Badge tone="dim">{person.role === 'admin' ? 'Admin' : 'Member'}</Badge>}><Select class="w-32" ariaLabel={`Role for ${nameOf(person)}`} value={person.role} options={ROLE_OPTIONS} disabled={busy()} onChange={next=>{if(next!==person.role)void mutate(`${root()}/members/${person.user_id}`,'PUT',{role:next});}}/><Button variant="danger" type="button" disabled={busy()} aria-label={`Remove ${nameOf(person)}`} onClick={()=>void mutate(`${root()}/members/${person.user_id}`,'DELETE')}>Remove</Button></Show></ListRow>}</For></ul>
  <Show when={admin()}><Show when={!props.detail.group.host_provisioned}><form class="mt-6 grid gap-3 sm:grid-cols-[minmax(0,1fr)_8rem]" onSubmit={e=>{e.preventDefault();void mutate(`${root()}/invitations`,'POST',{email:email(),role:role()});}}><Input type="email" required aria-label="Invitation email" placeholder="Email address" value={email()} onInput={e=>setEmail(e.currentTarget.value)}/><Select ariaLabel="Invitation role" value={role()} options={INVITE_ROLE_OPTIONS} onChange={next=>setRole(next as GroupRole)}/><Button class="justify-self-start sm:col-span-2" disabled={busy()} type="submit">Invite person</Button></form></Show><ul class="mt-2"><For each={props.detail.invitations}>{invite=><ListRow class="justify-between"><span class="min-w-0 break-words">{invite.email} · {invite.role}</span><Button variant="secondary" type="button" disabled={busy()} aria-label={`Cancel invitation to ${invite.email}`} onClick={()=>void mutate(`${root()}/invitations/${invite.id}`,'DELETE')}>Cancel invitation</Button></ListRow>}</For></ul></Show>
  <SubgroupAudience detail={props.detail}/>
 </Panel>
 <Panel label="Linked groups" title="Linked groups"><p class="text-sm leading-relaxed text-muted">Links help you navigate. Each group keeps its own membership and access.</p><Show when={!props.detail.linked_groups.length}><StatusMessage kind="empty" class="my-5">No linked groups yet.</StatusMessage></Show><ul class="mt-2"><For each={props.detail.linked_groups}>{group=><ListRow class="justify-between"><a class="font-medium hover:text-accent" href={`/@${group.handle}`}>{group.name}</a><Show when={admin()}><Button variant="secondary" type="button" disabled={busy()} aria-label={`Unlink ${group.name}`} onClick={()=>void mutate(`${root()}/links/${group.id}`,'DELETE')}>Unlink</Button></Show></ListRow>}</For></ul><Show when={admin()}><form class="mt-5 flex flex-wrap gap-3" onSubmit={async e=>{e.preventDefault();setError('');try{const group=await apiRequest<GroupDetail>(`/api/groups/${encodeURIComponent(link())}`);await mutate(`${root()}/links/${group.group.id}`,'PUT');}catch(err){setError(err instanceof Error?err.message:'Group unavailable.');}}}><Input class="flex-1 basis-40" required aria-label="Linked group handle" placeholder="Group handle" value={link()} onInput={e=>setLink(e.currentTarget.value)}/><Button variant="secondary" type="submit" disabled={busy()}>Link group</Button></form></Show></Panel></div>;
}
