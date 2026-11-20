/* @jsxImportSource solid-js */
/**
 * A GROUP'S AGENT SIGN-INS on its settings page, for its Admins only: every agent a person signed in as the group
 * (contracts identity-service `GROUP_SIGN_IN_RULE`), the level it acts at, who authorised it and whether it is still
 * live, with a revoke that ends it on its next request, a page at a time ("Show more"); and a service's sign-ins as one
 * row per approval with how many it holds, whose revoke ends the approval and so all of them at once. Nothing is drawn
 * for a Member or Editor.
 */
import { createEffect, createSignal, For, on, Show, type JSX } from 'solid-js';
import type { GroupSummary } from '@artifactbin/contracts/groups';
import { apiRequest } from '../lib/api';
import { usePageData } from '../lib/use-page-data';
import { dateTime } from '../lib/format';
import { Button } from '../ui/Button';
import { ConfirmDialog } from '../ui/ConfirmDialog';
import { ListRow, Panel } from '../ui/Panel';
import { StatusMessage } from '../ui/StatusMessage';
import { Badge } from '../ui/ui';

interface GroupSignInView { id: string; name: string | null; role: 'member' | 'editor'; issued_by: { id: string; username: string | null; name: string | null }; created_at: string; live: boolean }
/** A service's sign-ins under one approval (`grant_id`), counted. */
interface ServiceSignInsView { grant_id: string; service_id: string; role: 'member' | 'editor'; count: number; last_issued_at: string }
interface SignInPage { sign_ins: GroupSignInView[]; next_cursor?: string | null; services?: ServiceSignInsView[] }

export function GroupSignIns(props: { group: Pick<GroupSummary, 'id' | 'name' | 'role'> }): JSX.Element {
  const admin = () => props.group.role === 'admin';
  const path = () => `/api/groups/${encodeURIComponent(props.group.id)}/sign-ins`;
  const list = usePageData<SignInPage>(path, { enabled: admin });
  // People's later pages, fetched on "Show more"; a fresh first page starts them over.
  const [more, setMore] = createSignal<{ rows: GroupSignInView[]; next: string | null } | null>(null);
  createEffect(on(() => list.data(), () => setMore(null)));
  const people = () => [...(list.data()?.sign_ins ?? []), ...(more()?.rows ?? [])];
  const nextCursor = () => { const loaded = more(); return loaded ? loaded.next : list.data()?.next_cursor ?? null; };
  const [selected, setSelected] = createSignal<GroupSignInView | ServiceSignInsView | null>(null);
  const [busy, setBusy] = createSignal(false);
  const [error, setError] = createSignal('');
  const [moreError, setMoreError] = createSignal('');
  const who = (signIn: GroupSignInView) => signIn.issued_by.name ?? signIn.issued_by.username ?? 'a former member';
  const isService = (entry: GroupSignInView | ServiceSignInsView): entry is ServiceSignInsView => 'grant_id' in entry;
  const showMore = async () => {
    const cursor = nextCursor(); if (!cursor || busy()) return;
    setBusy(true); setMoreError('');
    try {
      const page = await apiRequest<SignInPage>(`${path()}?cursor=${encodeURIComponent(cursor)}`);
      setMore({ rows: [...(more()?.rows ?? []), ...page.sign_ins], next: page.next_cursor ?? null });
    } catch { setMoreError('Could not load more sign-ins. Try again.'); }
    finally { setBusy(false); }
  };
  const revoke = async () => {
    const entry = selected(); if (!entry || busy()) return;
    setBusy(true); setError('');
    try {
      await apiRequest(isService(entry) ? `/api/groups/${encodeURIComponent(props.group.id)}/service-sign-ins/${encodeURIComponent(entry.grant_id)}` : `${path()}/${encodeURIComponent(entry.id)}`, 'DELETE');
      setSelected(null); await list.refresh(true);
    } catch { setError(isService(entry) ? 'Could not revoke that approval. Try again.' : 'Could not revoke that sign-in. Try again.'); }
    finally { setBusy(false); }
  };
  return <Show when={admin()}>
    <Panel label="Agents signed in as this group" title="Agents signed in as this group">
      <Show when={selected()}>{entry => {
        const chosen = entry();
        return isService(chosen)
          ? <ConfirmDialog title={`Stop ${chosen.service_id} acting as ${props.group.name}?`} description={`This revokes its approval: all ${chosen.count} of its sign-ins (${chosen.role}) stop on their next request, and it cannot sign in again until an Admin approves it.`} action="Revoke approval" confirmLabel="Confirm revoke" danger busy={busy()} error={error()} onCancel={() => setSelected(null)} onConfirm={() => void revoke()} />
          : <ConfirmDialog title={`Revoke the agent ${who(chosen)} signed in?`} description={`It acts as ${props.group.name} (${chosen.role}) and stops on its next request. This cannot be undone.`} action="Revoke sign-in" confirmLabel="Confirm revoke" danger busy={busy()} error={error()} onCancel={() => setSelected(null)} onConfirm={() => void revoke()} />;
      }}</Show>
      <p class="mb-3 text-sm leading-relaxed text-muted">Each acts as {props.group.name} at its level, with no person behind it, and stops when the person who signed it in no longer holds that level here.</p>
      <Show when={list.data()} fallback={<Show when={list.error()} fallback={<StatusMessage kind="loading">Loading sign-ins…</StatusMessage>}><StatusMessage kind="error" action={<Button variant="link" type="button" onClick={() => void list.refresh(true)}>Retry sign-ins</Button>}>Could not load the sign-ins.</StatusMessage></Show>}>
        {(value) => <Show when={people().length || value().services?.length} fallback={<StatusMessage kind="empty" class="my-5">No agent is signed in as this group.</StatusMessage>}>
          <ul class="mt-2">
            <For each={value().services ?? []}>{(service) => <ListRow>
              <span class="min-w-0 flex-1 break-words font-medium">Signed in by service {service.service_id}</span>
              <Badge tone="dim">{service.role}</Badge>
              <span class="text-xs text-muted">{service.count === 1 ? '1 sign-in' : `${service.count} sign-ins`} · last {dateTime(service.last_issued_at)}</span>
              <Button variant="secondary" type="button" disabled={busy()} aria-label={`Revoke the approval of ${service.service_id} (${service.role})`} onClick={() => setSelected(service)}>Revoke</Button>
            </ListRow>}</For>
            <For each={people()}>{(signIn) => <ListRow>
              <span class="min-w-0 flex-1 break-words font-medium">Signed in by {who(signIn)}</span>
              <Badge tone="dim">{signIn.role}</Badge>
              <span class="text-xs text-muted">{signIn.live ? 'Live' : 'No longer holds'} · {dateTime(signIn.created_at)}</span>
              <Button variant="secondary" type="button" disabled={busy()} aria-label={`Revoke the sign-in by ${who(signIn)} (${signIn.role})`} onClick={() => setSelected(signIn)}>Revoke</Button>
            </ListRow>}</For>
          </ul>
          <Show when={nextCursor()}><div class="mt-3 text-center"><Button size="sm" variant="secondary" type="button" disabled={busy()} onClick={() => void showMore()}>Show more sign-ins</Button></div></Show>
          <Show when={moreError()}><StatusMessage kind="error">{moreError()}</StatusMessage></Show>
        </Show>}
      </Show>
    </Panel>
  </Show>;
}
