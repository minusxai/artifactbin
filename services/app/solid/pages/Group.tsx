/* @jsxImportSource solid-js */
import { createSignal, For, Show, type JSX } from 'solid-js';
import type { GroupDetail, GroupMember, GroupRole } from '@artifactbin/contracts';
import type { AccountWorkspaceCore } from '@/lib/workspace/dashboard';
import { buildGroupSetupInstructions } from '@/lib/platform/setup-instructions';
import { copyText } from '../lib/copy-text';
import { apiRequest } from '../lib/api';
import { usePageData } from '../lib/use-page-data';
import Shelf from '../components/Shelf';
import WorkspaceShell from '../components/WorkspaceShell';
import Users from 'lucide-solid/icons/users';
import { DefaultDestinationControl, type DefaultDestinationState } from '../components/DefaultDestinationControl';
import { FORM_INPUT, FORM_PRIMARY_BUTTON, FORM_SECONDARY_BUTTON, FORM_DANGER_BUTTON } from '../ui/FormControls';
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
 return <><p role="alert">This group is unavailable. Your default may no longer be accessible.</p><a href="/?personal=1">Open Personal</a><button type="button" onClick={props.retry}>Retry group</button></>;
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
 <header class="group-page-header"><a href="/groups" class="text-sm font-medium text-muted hover:text-accent">Groups</a><div class="mt-5 flex items-start gap-4"><span class="group-avatar group-avatar-large" aria-hidden="true"><Users size={26}/></span><div class="min-w-0 flex-1"><div class="flex flex-wrap items-center gap-3"><h1 class="break-words text-3xl font-semibold tracking-tight">{value().group.name}</h1><span class="group-role">{value().group.role==='editor'?'Editor':'Viewer'}</span></div><p class="mt-1 break-all text-sm text-muted"><a href={`/@${encodeURIComponent(value().group.handle)}`} class="rounded-sm underline-offset-4 hover:text-accent hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent">@{value().group.handle}</a></p><Show when={value().group.description}><p class="mt-3 max-w-2xl text-sm leading-relaxed text-muted">{value().group.description}</p></Show></div></div><div class="group-default-panel"><DefaultDestinationControl group={value().group} initial={props.defaults} onSaved={props.onDefaultSaved}/><button type="button" class={FORM_SECONDARY_BUTTON} onClick={()=>void copy()}>{copied()?'Instructions copied':'Copy agent setup'}</button></div></header>
 <Show when={error()}><p role="alert" class="group-error">{error()}</p></Show>
 <section aria-label="Group artifacts" class="workspace-library"><h2 class="mb-5 text-lg font-semibold">Files and folders</h2><Show when={props.shelf} fallback={<Show when={props.shelfFailed} fallback={<p role="status">Loading artifacts…</p>}><p role="alert">Could not load group artifacts. <button type="button" onClick={props.retryShelf}>Retry artifacts</button></p></Show>}>{rows=><Shelf groupId={value().group.id} rows={rows().artifacts} actions={value().group.role==='editor'?'full':'share'} assets={false} scopeParentId={null}/>}</Show></section>
 <GroupManagement detail={value()} refresh={props.refresh}/>
 </div></WorkspaceShell>;
}

/** Membership edits use server-confirmed state. Refusals, including the last editor, stay visible. */
export function GroupManagement(props:{detail:GroupDetail;refresh:()=>void}):JSX.Element {
 const [query,setQuery]=createSignal(''); const [email,setEmail]=createSignal(''); const [role,setRole]=createSignal<GroupRole>('viewer'); const [link,setLink]=createSignal(''); const [error,setError]=createSignal(''); const [busy,setBusy]=createSignal(false);
 const editor=()=>props.detail.group.role==='editor'; const root=()=>`/api/groups/${props.detail.group.id}`;
 const searching=()=>!!query().trim();
 const search=usePageData<{members:GroupMember[]}>(()=>`${root()}/members?query=${encodeURIComponent(query().trim())}`,{enabled:searching});
 const mutate=async(path:string,method:'POST'|'PUT'|'DELETE',body?:unknown)=>{if(busy())return;setBusy(true);setError('');try{await apiRequest(path,method,body);props.refresh();if(searching())void search.refresh(true);}catch(e){setError(e instanceof Error ? e.message === 'last_editor' ? 'Keep at least one editor in this group. Add another editor before changing this person.' : e.message : 'Could not update group.');}finally{setBusy(false);}};
 const members=()=>searching() ? search.data()?.members ?? [] : props.detail.members;
 return <div class="group-management"><Show when={error()}><p role="alert" class="group-error">{error()}</p></Show><section aria-label="Group people" class="group-panel"><h2 class="text-lg font-semibold">People</h2><input type="search" aria-label="Search people" placeholder="Search people" value={query()} onInput={e=>setQuery(e.currentTarget.value)} class={`${FORM_INPUT} my-4`}/><Show when={searching() && search.pending()}><p role="status">Searching people…</p></Show><Show when={searching() && search.error()}><p role="alert">Could not search people. <button type="button" onClick={()=>void search.refresh(true)}>Retry people search</button></p></Show><Show when={searching() && search.data() && !search.pending() && !search.error() && !members().length}><p>No people match your search.</p></Show><ul><For each={members()}>{person=><li class="flex flex-wrap items-center gap-3 border-b border-edge py-4 text-sm"><Show when={person.username} fallback={<span>{person.name??'Member'}</span>}><a class="min-w-0 flex-1 break-words font-medium hover:text-accent" href={`/@${encodeURIComponent(person.username!)}`}>{person.name??person.username}</a></Show><Show when={editor()} fallback={<span>{person.role}</span>}><select class={`${FORM_INPUT} !w-auto`} aria-label={`Role for ${person.name??person.username??'member'}`} value={person.role} disabled={busy()} onChange={e=>{const select=e.currentTarget;const next=select.value;select.value=person.role;void mutate(`${root()}/members/${person.user_id}`,'PUT',{role:next});}}><option value="editor">Editor</option><option value="viewer">Viewer</option></select><button class={FORM_DANGER_BUTTON} type="button" disabled={busy()} aria-label={`Remove ${person.name??person.username??'member'}`} onClick={()=>void mutate(`${root()}/members/${person.user_id}`,'DELETE')}>Remove</button></Show></li>}</For></ul>
 <Show when={editor()}><form class="group-invite-form" onSubmit={e=>{e.preventDefault();void mutate(`${root()}/invitations`,'POST',{email:email(),role:role()});}}><input class={FORM_INPUT} type="email" required aria-label="Invitation email" placeholder="Email address" value={email()} onInput={e=>setEmail(e.currentTarget.value)}/><select class={FORM_INPUT} aria-label="Invitation role" value={role()} onChange={e=>setRole(e.currentTarget.value as GroupRole)}><option value="viewer">Viewer</option><option value="editor">Editor</option></select><button class={FORM_PRIMARY_BUTTON} disabled={busy()} type="submit">Invite person</button></form><ul><For each={props.detail.invitations}>{invite=><li class="flex flex-wrap items-center justify-between gap-3 border-b border-edge py-3 text-sm">{invite.email} · {invite.role}<button class={FORM_SECONDARY_BUTTON} type="button" disabled={busy()} aria-label={`Cancel invitation to ${invite.email}`} onClick={()=>void mutate(`${root()}/invitations/${invite.id}`,'DELETE')}>Cancel invitation</button></li>}</For></ul></Show></section>
 <section aria-label="Linked groups" class="group-panel"><h2 class="text-lg font-semibold">Linked groups</h2><p class="mt-2 text-sm leading-relaxed text-muted">Links help you navigate. Each group keeps its own membership and access.</p><Show when={!props.detail.linked_groups.length}><p class="my-5 text-sm text-muted">No linked groups yet.</p></Show><ul><For each={props.detail.linked_groups}>{group=><li class="flex flex-wrap items-center justify-between gap-3 border-b border-edge py-3 text-sm"><a class="font-medium hover:text-accent" href={`/@${group.handle}`}>{group.name}</a><Show when={editor()}><button class={FORM_SECONDARY_BUTTON} type="button" disabled={busy()} aria-label={`Unlink ${group.name}`} onClick={()=>void mutate(`${root()}/links/${group.id}`,'DELETE')}>Unlink</button></Show></li>}</For></ul><Show when={editor()}><form class="mt-5 flex flex-wrap gap-3" onSubmit={async e=>{e.preventDefault();setError('');try{const group=await apiRequest<GroupDetail>(`/api/groups/${encodeURIComponent(link())}`);await mutate(`${root()}/links/${group.group.id}`,'PUT');}catch(err){setError(err instanceof Error?err.message:'Group unavailable.');}}}><input class={`${FORM_INPUT} flex-1 basis-40`} required aria-label="Linked group handle" placeholder="Group handle" value={link()} onInput={e=>setLink(e.currentTarget.value)}/><button class={FORM_SECONDARY_BUTTON} type="submit" disabled={busy()}>Link group</button></form></Show></section></div>;
}
