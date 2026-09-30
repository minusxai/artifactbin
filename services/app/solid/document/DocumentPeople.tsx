/* @jsxImportSource solid-js */
import { createEffect, createSignal, createUniqueId, For, onCleanup, Show, type JSX } from 'solid-js';
import Users from 'lucide-solid/icons/users';
import type { MembershipInput, MembershipState } from '@artifactbin/contracts';
import { Button, Input } from '../components/ui';
import { apiFetch } from '../lib/api';
import { primeShared, sharedRequest } from '@/lib/shared-request';
type Person = { user_id: string; username: string; name: string | null };

/** The document controls' people panel (components/ArtifactPeople in Solid); membership and sharing remain separate grants. */
export function DocumentPeople(props: { id: string; revision?: number; onChange?: () => void; hideJoin?: boolean; initialOpen?: boolean }): JSX.Element {
  const [open, setOpen] = createSignal(Boolean(props.initialOpen));
  const [state, setState] = createSignal<MembershipState | null>(null);
  const [error, setError] = createSignal('');
  const [busy, setBusy] = createSignal(false);
  const [selected, setSelected] = createSignal<Person[]>([]);
  const [includeAccess, setIncludeAccess] = createSignal(false);
  const endpoint = () => `/api/my/artifacts/${encodeURIComponent(props.id)}/members`;
  // One members request per document however many People panels are mounted (page, controls, edit mode);
  // a membership change (revision) or this panel's own write refetches, opening or remounting does not.
  const key = () => `members:${props.id}`;
  let seenRevision = props.revision;
  createEffect(() => {
    void open();
    const force = props.revision !== seenRevision; seenRevision = props.revision;
    let alive = true;
    onCleanup(() => { alive = false; });
    void sharedRequest(key(), async () => {
      const response = await fetch(endpoint());
      const body = await response.json() as MembershipState & { detail?: string };
      if (!response.ok || !Array.isArray(body.members) || !Array.isArray(body.pending)) throw new Error(body.detail ?? 'Could not load people');
      return body;
    }, { ttl: 30000, force }).then(body => { if (alive) { setState(body); setError(''); } })
      .catch(cause => { if (alive) setError(cause instanceof Error ? cause.message : 'Could not load people'); });
  });
  const act = async (input: MembershipInput) => {
    if (busy()) return;
    setBusy(true); setError('');
    try {
      const response = await apiFetch(endpoint(), 'POST', input);
      const body = await response.json() as MembershipState & { detail?: string };
      if (!response.ok || !Array.isArray(body.members) || !Array.isArray(body.pending)) throw new Error(body.detail ?? 'Could not update people');
      setState(body); primeShared(key(), body); props.onChange?.();
      if (input.action === 'invite') setSelected([]);
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not update people'); }
    finally { setBusy(false); }
  };
  const self = () => state()?.self;
  return <section aria-label="artifact people" class="space-y-3">
    <button type="button" aria-label="People" aria-expanded={open()} onClick={() => setOpen(value => !value)} class="flex w-full items-center gap-2 rounded-md px-2 py-2 text-sm hover:bg-raised">
      <Users size={16} /><span>People</span>
      <Show when={self()?.status === 'accepted' && self()?.explicit_join}><span class="text-xs text-accent">Joined</span></Show>
      <Show when={state()}><span class="ml-auto text-xs text-muted">{state()!.members.length}</span></Show>
    </button>
    <Show when={open()}><div class="space-y-4 rounded-xl border border-edge bg-surface p-4">
      <div><h3 class="font-medium">People in this artifact</h3><p class="text-xs leading-5 text-muted">Comment access does not depend on joining.</p></div>
      <Show when={error()}><p role="alert" class="text-xs text-danger">{error()}</p></Show>
      <Show when={!state() && !error()}><p role="status">Loading people…</p></Show>
      <Show when={state()}>{current => <>
        <Show when={self()?.status === 'accepted'} fallback={
          <Show when={self()?.status === 'pending'} fallback={<Show when={!props.hideJoin}><Button disabled={busy()} onClick={() => void act({ action: 'join' })}>{current().canManage ? 'Join artifact' : 'Request to join'}</Button></Show>}>
            <div class="space-y-2 rounded-lg bg-raised p-3">
              <p class="text-xs">{self()?.direction === 'request' ? 'Waiting for an owner or editor to approve.' : 'You’ve been invited to join.'}</p>
              <div class="flex gap-2">
                <Show when={self()?.direction === 'invitation' || current().canManage}><Button disabled={busy()} onClick={() => void act({ action: current().canManage && self()?.direction === 'request' ? 'join' : 'accept' })}>{current().canManage && self()?.direction === 'request' ? 'Join artifact' : 'Accept invitation'}</Button></Show>
                <Button variant="ghost" disabled={busy()} onClick={() => void act({ action: 'dismiss' })}>{self()?.direction === 'request' ? 'Withdraw request' : 'Decline'}</Button>
              </div>
            </div>
          </Show>}>
          <div class="flex items-center justify-between gap-2">
            <span class="text-xs text-accent">{self()?.explicit_join ? 'You’re a member' : 'Invitation automatically accepted'}</span>
            <Show when={!self()?.explicit_join}><Button disabled={busy()} onClick={() => void act({ action: 'join' })}>Join artifact</Button></Show>
            <Button variant="ghost" disabled={busy()} onClick={() => void act({ action: 'leave' })}>Leave</Button>
          </div>
        </Show>
        <ul class="divide-y divide-edge"><For each={current().members}>{member => <li class="flex items-center gap-3 py-2.5">
          <span class="flex h-7 w-7 items-center justify-center rounded-full bg-accent-soft text-xs text-accent">{(member.name ?? member.username ?? '?').slice(0, 1).toUpperCase()}</span>
          <span class="min-w-0 truncate text-sm">{member.username ? `@${member.username}` : member.name ?? member.user_id}</span>
          <span class="ml-auto text-xs text-muted">Member</span>
        </li>}</For></ul>
        <Show when={current().canManage}><For each={current().pending.filter(member => member.user_id !== self()?.user_id)}>{member => <div class="space-y-2 rounded-lg border border-edge p-3">
          <p class="text-xs">@{member.username ?? member.user_id} · {member.direction === 'invitation' ? 'Invitation pending' : 'Wants to join'}</p>
          <div class="flex gap-2">
            <Show when={member.direction === 'request'}><Button disabled={busy()} onClick={() => void act({ action: 'approve', userId: member.user_id })}>Approve @{member.username ?? member.user_id}</Button></Show>
            <Button variant="ghost" disabled={busy()} onClick={() => void act({ action: 'dismiss', userId: member.user_id })}>Dismiss</Button>
          </div>
        </div>}</For></Show>
        <Show when={current().canInvite}><div class="space-y-2 border-t border-edge pt-4">
          <PeopleInvitePicker endpoint={endpoint()} selected={selected()} onSelect={person => setSelected(previous => [...previous, person])} />
          <p class="text-xs leading-5 text-muted">Find anyone by username. Invitations wait for acceptance unless they follow you.</p>
          <div class="flex flex-wrap gap-1"><For each={selected()}>{person => <button type="button" class="rounded-full bg-accent-soft px-2 py-1 text-xs text-accent" aria-label={`Remove @${person.username}`} onClick={() => setSelected(previous => previous.filter(item => item.user_id !== person.user_id))}>@{person.username} ×</button>}</For></div>
          <Show when={current().canManage}><label class="flex items-center gap-2 text-xs"><input type="checkbox" checked={includeAccess()} onChange={event => setIncludeAccess(event.currentTarget.checked)} />Include viewing access</label></Show>
          <Button disabled={busy() || selected().length === 0} onClick={() => void act({ action: 'invite', usernames: selected().map(person => `@${person.username}`), includeAccess: includeAccess() })}>Invite{selected().length ? ` ${selected().length} people` : ''}</Button>
          <p class="text-xs leading-5 text-muted">Followers join immediately unless they’ve turned off automatic acceptance. Others see a pending invitation.</p>
        </div></Show>
      </>}</Show>
    </div></Show>
  </section>;
}

/** Owns invitation lookup and its keyboard interaction; selecting never sends an invite. */
function PeopleInvitePicker(props: { endpoint: string; selected: Person[]; onSelect: (person: Person) => void }): JSX.Element {
  const id = createUniqueId();
  const [query, setQuery] = createSignal('');
  const [open, setOpen] = createSignal(false);
  const [candidates, setCandidates] = createSignal<Person[]>([]);
  const [active, setActive] = createSignal(-1);
  const [loading, setLoading] = createSignal(false);
  const [error, setError] = createSignal('');
  const options = () => candidates().filter(person => !props.selected.some(item => item.user_id === person.user_id));
  createEffect(() => {
    if (!open()) return;
    const controller = new AbortController();
    setLoading(true); setError(''); setCandidates([]); setActive(-1);
    void fetch(`${props.endpoint}?purpose=invite&query=${encodeURIComponent(query())}`, { signal: controller.signal })
      .then(async response => {
        if (!response.ok) throw new Error('Could not find people. Try again.');
        const result = await response.json() as { people?: Person[] };
        if (!controller.signal.aborted) setCandidates(result.people ?? []);
      })
      .catch(() => { if (!controller.signal.aborted) setError('Could not find people. Try again.'); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    onCleanup(() => controller.abort());
  });
  const select = (person: Person) => { props.onSelect(person); setQuery(''); setOpen(false); setActive(-1); };
  return <div class="relative" onFocusOut={event => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setOpen(false); }}>
    <label class="grid gap-2 text-xs font-medium">Add people
      <Input role="combobox" aria-label="Find people by username" aria-autocomplete="list" aria-expanded={open()}
        aria-controls={open() ? id : undefined} aria-activedescendant={open() && options()[active()] ? `${id}-${active()}` : undefined}
        value={query()} placeholder="@username" autocomplete="off"
        onFocus={() => setOpen(true)} onClick={() => setOpen(true)}
        onInput={event => { setQuery(event.currentTarget.value); setOpen(true); setActive(-1); }}
        onKeyDown={event => {
          const list = options();
          if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); setOpen(false); }
          else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault(); setOpen(true);
            setActive(current => !list.length ? -1 : current < 0 ? (event.key === 'ArrowDown' ? 0 : list.length - 1) : (current + (event.key === 'ArrowDown' ? 1 : list.length - 1)) % list.length);
          } else if (event.key === 'Enter' && open() && list[active()]) { event.preventDefault(); select(list[active()]!); }
        }} />
    </label>
    <Show when={open()}><div class="absolute left-0 right-0 top-full z-40 mt-1 overflow-hidden rounded-md border border-edge bg-surface shadow-lg">
      <ul id={id} role="listbox" aria-label="People suggestions" class="max-h-48 overflow-y-auto p-1">
        <For each={options()}>{(person, index) => <li role="presentation">
          <button type="button" role="option" id={`${id}-${index()}`} aria-selected={active() === index()} tabIndex={-1}
            class={`w-full rounded px-3 py-2 text-left text-sm hover:bg-raised ${active() === index() ? 'bg-raised' : ''}`}
            onMouseDown={event => event.preventDefault()} onClick={() => select(person)}>
            @{person.username}{' '}<span class="ml-2 text-xs text-muted">{person.name}</span>
          </button>
        </li>}</For>
      </ul>
      <Show when={loading() || error() || options().length === 0}><p role="status" class="px-3 py-2 text-xs text-muted">{loading() ? 'Finding people…' : error() || 'No people found.'}</p></Show>
    </div></Show>
  </div>;
}
