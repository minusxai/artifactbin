/* @jsxImportSource solid-js */
/**
 * A GROUP'S AGENT SIGN-INS on its settings page, for its Admins only: every agent signed in as the group (contracts
 * identity-service `GROUP_SIGN_IN_RULE`), the level it acts at, who authorised it and whether it is still live, with
 * a revoke that ends it on its next request. Nothing is drawn for a Member or Editor.
 */
import { createSignal, For, Show, type JSX } from 'solid-js';
import type { GroupSummary } from '@artifactbin/contracts';
import { apiRequest } from '../lib/api';
import { usePageData } from '../lib/use-page-data';
import { dateTime } from '../lib/format';
import { Button } from '../ui/Button';
import { ConfirmDialog } from '../ui/ConfirmDialog';
import { ListRow, Panel } from '../ui/Panel';
import { StatusMessage } from '../ui/StatusMessage';
import { Badge } from '../ui/ui';

interface GroupSignInView { id: string; name: string | null; role: 'member' | 'editor'; issued_by: { id: string; username: string | null; name: string | null }; created_at: string; live: boolean }

export function GroupSignIns(props: { group: Pick<GroupSummary, 'id' | 'name' | 'role'> }): JSX.Element {
  const admin = () => props.group.role === 'admin';
  const path = () => `/api/groups/${encodeURIComponent(props.group.id)}/sign-ins`;
  const list = usePageData<{ sign_ins: GroupSignInView[] }>(path, { enabled: admin });
  const [selected, setSelected] = createSignal<GroupSignInView | null>(null);
  const [busy, setBusy] = createSignal(false);
  const [error, setError] = createSignal('');
  const who = (signIn: GroupSignInView) => signIn.issued_by.name ?? signIn.issued_by.username ?? 'a former member';
  const revoke = async () => {
    const signIn = selected(); if (!signIn || busy()) return;
    setBusy(true); setError('');
    try { await apiRequest(`${path()}/${encodeURIComponent(signIn.id)}`, 'DELETE'); setSelected(null); await list.refresh(true); }
    catch { setError('Could not revoke that sign-in. Try again.'); }
    finally { setBusy(false); }
  };
  return <Show when={admin()}>
    <Panel label="Agents signed in as this group" title="Agents signed in as this group">
      <Show when={selected()}>{signIn => <ConfirmDialog title={`Revoke the agent ${who(signIn())} signed in?`} description={`It acts as ${props.group.name} (${signIn().role}) and stops on its next request. This cannot be undone.`} action="Revoke sign-in" confirmLabel="Confirm revoke" danger busy={busy()} error={error()} onCancel={() => setSelected(null)} onConfirm={() => void revoke()} />}</Show>
      <p class="mb-3 text-sm leading-relaxed text-muted">Each acts as {props.group.name} at its level, with no person behind it, and stops when the person who signed it in no longer holds that level here.</p>
      <Show when={list.data()} fallback={<Show when={list.error()} fallback={<StatusMessage kind="loading">Loading sign-ins…</StatusMessage>}><StatusMessage kind="error" action={<Button variant="link" type="button" onClick={() => void list.refresh(true)}>Retry sign-ins</Button>}>Could not load the sign-ins.</StatusMessage></Show>}>
        {(value) => <Show when={value().sign_ins.length} fallback={<StatusMessage kind="empty" class="my-5">No agent is signed in as this group.</StatusMessage>}>
          <ul class="mt-2"><For each={value().sign_ins}>{(signIn) => <ListRow>
            <span class="min-w-0 flex-1 break-words font-medium">Signed in by {who(signIn)}</span>
            <Badge tone="dim">{signIn.role}</Badge>
            <span class="text-xs text-muted">{signIn.live ? 'Live' : 'No longer holds'} · {dateTime(signIn.created_at)}</span>
            <Button variant="secondary" type="button" disabled={busy()} aria-label={`Revoke the sign-in by ${who(signIn)} (${signIn.role})`} onClick={() => setSelected(signIn)}>Revoke</Button>
          </ListRow>}</For></ul>
        </Show>}
      </Show>
    </Panel>
  </Show>;
}
