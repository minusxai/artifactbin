/* @jsxImportSource solid-js */
/**
 * A GROUP'S PLACE IN THE TREE (lib/groups hierarchy): its parent and subgroups, and who its shares reach.
 *
 * Membership is DIRECT: a member of a subgroup is not a member of this group and cannot act as it, yet receives what
 * is shared with this group. The page says both, and lists those people apart from the members (`SubgroupAudience`).
 *
 * An editor creates a subgroup (`POST /api/groups` with `parent_id`) and moves this group (`PUT /api/groups/{id}/parent`),
 * which the server allows only to someone who directly edits the group, its current parent and the new one: moving a
 * group hands its members the new parent's shares. A move always names the parent this page loaded
 * (`from_parent_id`), so the server refuses a stale one (`parent_changed`) instead of silently re-rooting. Every
 * refusal is shown in plain words (`groupTreeMessage`).
 */
import { createSignal, For, Show, type JSX } from 'solid-js';
import type { GroupDetail, GroupRelative, GroupSummary } from '@artifactbin/contracts';
import { apiRequest } from '../lib/api';
import { Button } from '../ui/Button';
import { Dialog } from '../ui/Dialog';
import { Field, Input } from '../ui/Field';
import { ListRow, Panel } from '../ui/Panel';
import { Select } from '../ui/Select';
import { StatusMessage } from '../ui/StatusMessage';
import { Badge } from '../ui/ui';

const MESSAGES: Record<string, string> = {
  forbidden: 'Only someone who is an editor of this group, of its current parent and of the new parent can move it.',
  parent_not_found: 'That parent group is unavailable. Choose a group you are an editor of.',
  already_has_parent: 'This group already has a parent. Reload the page, then move it from its current parent.',
  parent_changed: 'This group’s parent changed since the page loaded. Reload the page and try again.',
  hierarchy_cycle: 'A group cannot move under itself or one of its own subgroups.',
  group_has_children: 'This group has subgroups. Move or delete its subgroups first.',
  handle_taken: 'That handle is already taken. Choose another.',
  invalid_group: 'Enter a name, and a handle of lowercase letters, numbers and underscores.',
  invalid_parent: 'Choose a parent group, or none.',
  not_found: 'This group is unavailable. Reload the page.',
};
/** A group refusal's plain words; an unknown code is shown as the server said it. */
const groupTreeMessage = (error: unknown): string => {
  const code = error instanceof Error ? error.message : '';
  return MESSAGES[code] ?? (code || 'Could not update the group.');
};

const NO_PARENT = '';
const relativeName = (group: GroupRelative) => <Show when={group.role} fallback={<span class="font-medium">{group.name}</span>}><a class="font-medium hover:text-accent" href={`/@${encodeURIComponent(group.handle)}`}>{group.name}</a></Show>;

/** One sentence under a group's title: what it belongs to and what belongs to it. */
export function GroupTreeSummary(props: { detail: GroupDetail }): JSX.Element {
  const d = () => props.detail;
  return <Show when={d().parent || d().subgroups.length}>
    <div class="mt-3 grid gap-1 font-sans text-sm text-muted">
      <Show when={d().parent}>{(parent) => <p class="m-0">Subgroup of {relativeName(parent())}. Files shared with {parent().name} also reach this group’s members.</p>}</Show>
      <Show when={d().subgroups.length}><p class="m-0">Subgroups: <For each={d().subgroups}>{(group, index) => <>{index() ? ', ' : ''}{relativeName(group)}</>}</For>. Files shared with {d().group.name} also reach their members.</p></Show>
    </div>
  </Show>;
}

/** The people this group's shares reach through a subgroup, apart from its members. */
export function SubgroupAudience(props: { detail: GroupDetail }): JSX.Element {
  const nameOf = (person: GroupDetail['subgroup_audience'][number]) => person.name ?? person.username ?? 'Someone';
  return <Show when={props.detail.subgroups.length}>
    <section aria-label="Receives shared files through a subgroup" class="mt-6">
      <h3 class="m-0 font-sans text-sm font-semibold text-fg">Receives shared files through a subgroup</h3>
      <p class="mt-1 font-sans text-xs leading-relaxed text-muted">These people are not members of {props.detail.group.name} and cannot act as it. Files shared with {props.detail.group.name} reach them because they belong to one of its subgroups.</p>
      <Show when={props.detail.subgroup_audience.length} fallback={<StatusMessage kind="empty" class="mt-3">No one else yet: its subgroups have no other members.</StatusMessage>}>
        <ul class="mt-2"><For each={props.detail.subgroup_audience}>{(person) => <ListRow>
          <Show when={person.username} fallback={<span class="min-w-0 flex-1">{nameOf(person)}</span>}><a class="min-w-0 flex-1 break-words font-medium hover:text-accent" href={`/@${encodeURIComponent(person.username!)}`}>{nameOf(person)}</a></Show>
          <Badge tone="dim">via {person.via.name}</Badge>
        </ListRow>}</For></ul>
      </Show>
    </section>
  </Show>;
}

/** The groups this account could move `self` under: those it edits, minus `self` and anything below it. */
function parentChoices(self: GroupDetail, groups: GroupSummary[]): GroupSummary[] {
  const below = new Set([self.group.id]);
  for (let grew = true; grew;) {
    grew = false;
    for (const group of groups) if (group.parent_id && below.has(group.parent_id) && !below.has(group.id)) { below.add(group.id); grew = true; }
  }
  for (const group of self.subgroups) below.add(group.id);
  return groups.filter((group) => group.role === 'editor' && !below.has(group.id));
}

function MoveGroupDialog(props: { detail: GroupDetail; onClose: () => void; onMoved: () => void }): JSX.Element {
  const current = () => props.detail.parent?.id ?? NO_PARENT;
  const [groups, setGroups] = createSignal<GroupSummary[] | null>(null);
  const [target, setTarget] = createSignal(current());
  const [busy, setBusy] = createSignal(false);
  const [error, setError] = createSignal('');
  void apiRequest<{ groups: GroupSummary[] }>('/api/groups').then((page) => setGroups(page.groups), () => setError('Could not load your groups.'));
  const options = () => [{ value: NO_PARENT, label: 'No parent (a top-level group)' }, ...parentChoices(props.detail, groups() ?? []).map((group) => ({ value: group.id, label: group.name }))];
  const targetName = () => options().find((option) => option.value === target())?.label ?? '';
  const move = async () => {
    setBusy(true); setError('');
    try {
      await apiRequest(`/api/groups/${encodeURIComponent(props.detail.group.id)}/parent`, 'PUT', { parent_id: target() || null, from_parent_id: props.detail.parent?.id ?? null });
      props.onMoved();
    } catch (cause) { setError(groupTreeMessage(cause)); }
    finally { setBusy(false); }
  };
  return <Dialog title={`Move ${props.detail.group.name}`} busy={busy()} onClose={props.onClose}
    description={<>Only someone who is an editor of {props.detail.group.name}, of its current parent and of the new parent can move it.</>}
    footer={<>
      <Button variant="secondary" disabled={busy()} onClick={props.onClose}>Cancel</Button>
      <Button disabled={busy() || !groups() || target() === current()} onClick={() => void move()}>{busy() ? 'Moving…' : 'Move group'}</Button>
    </>}>
    <div class="grid gap-3">
      <Field label="New parent group"><Select value={target()} options={options()} disabled={busy() || !groups()} onChange={setTarget} /></Field>
      <Show when={target() !== current()}>
        <p class="m-0 font-sans text-sm text-muted">
          <Show when={target()} fallback={<>{props.detail.group.name} becomes a top-level group. Its members, and its subgroups’ members, stop receiving files shared with {props.detail.parent?.name}.</>}>
            Members of {props.detail.group.name} and of its subgroups will receive files shared with {targetName()}. They do not become members of {targetName()}.
          </Show>
        </p>
      </Show>
      <Show when={error()}><StatusMessage kind="error">{error()}</StatusMessage></Show>
    </div>
  </Dialog>;
}

/** The settings panel: the parent (with Move, for editors), the subgroups and a form to create one. */
export function GroupTreePanel(props: { detail: GroupDetail; refresh: () => void }): JSX.Element {
  const editor = () => props.detail.group.role === 'editor';
  const [moving, setMoving] = createSignal(false);
  const [name, setName] = createSignal(''); const [handle, setHandle] = createSignal('');
  const [busy, setBusy] = createSignal(false); const [error, setError] = createSignal(''); const [created, setCreated] = createSignal('');
  const create = async () => {
    setBusy(true); setError(''); setCreated('');
    try {
      const group = await apiRequest<GroupSummary>('/api/groups', 'POST', { name: name(), handle: handle(), parent_id: props.detail.group.id });
      setCreated(`${group.name} is now a subgroup of ${props.detail.group.name}. You are its first editor.`); setName(''); setHandle('');
      props.refresh();
    } catch (cause) { setError(groupTreeMessage(cause)); }
    finally { setBusy(false); }
  };
  return <Panel label="Group tree" title="Parent and subgroups">
    <div class="grid gap-1 font-sans text-sm">
      <span class="text-xs font-medium text-muted">Parent group</span>
      <div class="flex flex-wrap items-center justify-between gap-3">
        <Show when={props.detail.parent} fallback={<span>None: {props.detail.group.name} is a top-level group.</span>}>{(parent) => <span>{relativeName(parent())}</span>}</Show>
        <Show when={editor()}><Button size="sm" variant="secondary" onClick={() => setMoving(true)}>Move group</Button></Show>
      </div>
    </div>
    <div class="mt-5 grid gap-1">
      <span class="font-sans text-xs font-medium text-muted">Subgroups</span>
      <Show when={props.detail.subgroups.length} fallback={<StatusMessage kind="empty">No subgroups yet.</StatusMessage>}>
        <ul class="m-0"><For each={props.detail.subgroups}>{(group) => <ListRow class="justify-between">{relativeName(group)}<Show when={group.role} fallback={<Badge tone="dim">Not a member</Badge>}><Badge>{group.role === 'editor' ? 'Editor' : 'Viewer'}</Badge></Show></ListRow>}</For></ul>
      </Show>
      <p class="m-0 mt-2 font-sans text-xs leading-relaxed text-muted">Files shared with {props.detail.group.name} also reach every subgroup’s members. Membership never carries over: a subgroup member is not a member of {props.detail.group.name}, and a member of {props.detail.group.name} is not a member of its subgroups. A group with subgroups cannot be deleted until they are moved or deleted.</p>
    </div>
    <Show when={editor()}>
      <form class="mt-5 grid gap-3 sm:grid-cols-2" onSubmit={(event) => { event.preventDefault(); if (!busy()) void create(); }}>
        <Field label="Subgroup name"><Input required placeholder="e.g. Retail" value={name()} disabled={busy()} onInput={(event) => setName(event.currentTarget.value)} /></Field>
        <Field label="Subgroup handle"><Input required placeholder="e.g. retail_team" value={handle()} disabled={busy()} onInput={(event) => setHandle(event.currentTarget.value)} /></Field>
        <Show when={error()}><StatusMessage kind="error" class="sm:col-span-2">{error()}</StatusMessage></Show>
        <Show when={created()}><StatusMessage kind="notice" class="sm:col-span-2">{created()}</StatusMessage></Show>
        <Button class="justify-self-start sm:col-span-2" type="submit" disabled={busy()}>{busy() ? 'Creating…' : 'Create subgroup'}</Button>
      </form>
    </Show>
    <Show when={moving()}><MoveGroupDialog detail={props.detail} onClose={() => setMoving(false)} onMoved={() => { setMoving(false); props.refresh(); }} /></Show>
  </Panel>;
}
