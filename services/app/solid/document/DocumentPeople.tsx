/* @jsxImportSource solid-js */
import { createEffect, createSignal, For, onCleanup, Show, type JSX } from 'solid-js';
import type { MembershipInput, MembershipState } from '@artifactbin/contracts';
type Person = { user_id: string; username: string; name: string | null };

/** The document controls' people panel; membership and sharing remain separate grants. */
export function DocumentPeople(props: { id: string; revision?: number; onChange?: () => void; hideJoin?: boolean; initialOpen?: boolean }): JSX.Element {
  const [open, setOpen] = createSignal(Boolean(props.initialOpen));
  const [state, setState] = createSignal<MembershipState | null>(null);
  const [error, setError] = createSignal('');
  const [busy, setBusy] = createSignal(false);
  const [query, setQuery] = createSignal('');
  const [candidates, setCandidates] = createSignal<Person[]>([]);
  const [selected, setSelected] = createSignal<Person[]>([]);
  const [includeAccess, setIncludeAccess] = createSignal(false);
  const endpoint = () => `/api/my/artifacts/${encodeURIComponent(props.id)}/members`;
  createEffect(() => {
    void props.revision; void open();
    const controller = new AbortController();
    void fetch(endpoint(), { signal: controller.signal }).then(async response => {
      const body = await response.json() as MembershipState & { detail?: string };
      if (!response.ok || !Array.isArray(body.members) || !Array.isArray(body.pending)) throw new Error(body.detail ?? 'Could not load people');
      if (!controller.signal.aborted) { setState(body); setError(''); }
    }).catch(cause => { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : 'Could not load people'); });
    onCleanup(() => controller.abort());
  });
  createEffect(() => {
    if (!open() || !state()?.canInvite) return;
    const controller = new AbortController();
    const url = `${endpoint()}?purpose=invite&query=${encodeURIComponent(query())}`;
    void fetch(url, { signal: controller.signal }).then(response => response.json()).then(body => {
      if (!controller.signal.aborted) setCandidates(body.people ?? []);
    }).catch(() => {});
    onCleanup(() => controller.abort());
  });
  const act = async (input: MembershipInput) => {
    if (busy()) return;
    setBusy(true); setError('');
    try {
      const response = await fetch(endpoint(), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input) });
      const body = await response.json() as MembershipState & { detail?: string };
      if (!response.ok || !Array.isArray(body.members) || !Array.isArray(body.pending)) throw new Error(body.detail ?? 'Could not update people');
      setState(body); props.onChange?.();
      if (input.action === 'invite') { setSelected([]); setQuery(''); }
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not update people'); }
    finally { setBusy(false); }
  };
  const self = () => state()?.self;
  return <section aria-label="Artefact people" class="space-y-3">
    <button type="button" aria-label="People" aria-expanded={open()} onClick={() => setOpen(value => !value)} class="flex w-full items-center gap-2 rounded px-2 py-2 text-sm hover:bg-raised">People <Show when={self()?.status === 'accepted' && self()?.explicit_join}><span>Joined</span></Show><Show when={state()}><span class="ml-auto">{state()!.members.length}</span></Show></button>
    <Show when={open()}><div class="space-y-4 rounded border border-edge bg-surface p-4">
      <div><h3>People in this artefact</h3><p class="text-xs text-muted">Comment access does not depend on joining.</p></div>
      <Show when={error()}><p role="alert">{error()}</p></Show>
      <Show when={!state() && !error()}><p role="status">Loading people…</p></Show>
      <Show when={state()}>{current => <>
        <Show when={self()?.status === 'accepted'} fallback={<Show when={self()?.status === 'pending'} fallback={<Show when={!props.hideJoin}><button type="button" disabled={busy()} onClick={() => void act({ action: 'join' })}>{current().canManage ? 'Join artefact' : 'Request to join'}</button></Show>}>
          <p>{self()?.direction === 'request' ? 'Waiting for an owner or editor to approve.' : 'You’ve been invited to join.'}</p>
          <Show when={self()?.direction === 'invitation' || current().canManage}><button type="button" disabled={busy()} onClick={() => void act({ action: current().canManage && self()?.direction === 'request' ? 'join' : 'accept' })}>{current().canManage && self()?.direction === 'request' ? 'Join artefact' : 'Accept invitation'}</button></Show>
          <button type="button" disabled={busy()} onClick={() => void act({ action: 'dismiss' })}>{self()?.direction === 'request' ? 'Withdraw request' : 'Decline'}</button>
        </Show>}>
          <span>{self()?.explicit_join ? 'You’re a member' : 'Invitation automatically accepted'}</span>
          <Show when={!self()?.explicit_join}><button type="button" disabled={busy()} onClick={() => void act({ action: 'join' })}>Join artefact</button></Show>
          <button type="button" disabled={busy()} onClick={() => void act({ action: 'leave' })}>Leave</button>
        </Show>
        <ul><For each={current().members}>{member => <li>@{member.username ?? member.name ?? member.user_id} <span>Member</span></li>}</For></ul>
        <Show when={current().canManage}><For each={current().pending.filter(member => member.user_id !== self()?.user_id)}>{member => <div>
          <p>@{member.username ?? member.user_id} · {member.direction === 'invitation' ? 'Invitation pending' : 'Wants to join'}</p>
          <Show when={member.direction === 'request'}><button type="button" disabled={busy()} onClick={() => void act({ action: 'approve', userId: member.user_id })}>Approve @{member.username ?? member.user_id}</button></Show>
          <button type="button" disabled={busy()} onClick={() => void act({ action: 'dismiss', userId: member.user_id })}>Dismiss</button>
        </div>}</For></Show>
        <Show when={current().canInvite}><div class="space-y-2 border-t border-edge pt-4">
          <label> Add people <input aria-label="Find people by username" value={query()} onInput={event => setQuery(event.currentTarget.value)} placeholder="@username" /></label>
          <p>Find anyone by username. Invitations wait for acceptance unless they follow you.</p>
          <For each={selected()}>{person => <button type="button" aria-label={`Remove @${person.username}`} onClick={() => setSelected(previous => previous.filter(item => item.user_id !== person.user_id))}>@{person.username} ×</button>}</For>
          <For each={candidates().filter(person => !selected().some(item => item.user_id === person.user_id))}>{person => <button type="button" aria-label={`Invite @${person.username}`} onClick={() => setSelected(previous => [...previous, person])}>@{person.username} {person.name}</button>}</For>
          <Show when={current().canManage}><label><input type="checkbox" checked={includeAccess()} onChange={event => setIncludeAccess(event.currentTarget.checked)} />Include viewing access</label></Show>
          <button type="button" disabled={busy() || selected().length === 0} onClick={() => void act({ action: 'invite', usernames: selected().map(person => `@${person.username}`), includeAccess: includeAccess() })}>Invite{selected().length ? ` ${selected().length} people` : ''}</button>
          <p>Followers join immediately unless they’ve turned off automatic acceptance. Others see a pending invitation.</p>
        </div></Show>
      </>}</Show>
    </div></Show>
  </section>;
}
