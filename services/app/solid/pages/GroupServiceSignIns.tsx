/* @jsxImportSource solid-js */
/**
 * A GROUP'S APPROVED SERVICES on its settings page, for its Admins only (contracts service-audiences
 * `GROUP_SIGN_IN_PATH`): each configured service an Admin let sign an agent in as the group with nobody present, at
 * which level and who approved it, with a revoke that ends every such sign-in at once; and a form to approve another,
 * whose confirmation says in plain words what the service will be able to do. Nothing is drawn for a Member or Editor,
 * nor when no configured service may be approved and none is.
 */
import { personLabel } from '../lib/person-label';
import { createSignal, For, Show, type JSX } from 'solid-js';
import type { GroupSummary } from '@artifactbin/contracts/groups';
import { apiRequest } from '../lib/api';
import { usePageData } from '../lib/use-page-data';
import { dateTime } from '../lib/format';
import { Button } from '../ui/Button';
import { ConfirmDialog } from '../ui/ConfirmDialog';
import { ListRow, Panel } from '../ui/Panel';
import { Select } from '../ui/Select';
import { StatusMessage } from '../ui/StatusMessage';
import { Badge } from '../ui/ui';

type Level = 'member' | 'editor';
/** `configured`: false once the service is no longer configured as approved (entry, opt-in or origin gone): it acts no more. */
interface Approval { id: string; service_id: string; role: Level; approved_by: { id: string; username: string | null; name: string | null }; created_at: string; configured?: boolean }
interface Approvals { approvals: Approval[]; services: { id: string; origin: string }[] }
const LEVELS = [{ value: 'member', label: 'Member' }, { value: 'editor', label: 'Editor' }];
/** What a service approved at `level` may do, in plain words. */
const powers = (group: string, level: Level) => level === 'editor'
  ? `read what members of ${group} read, and create and edit ${group}'s pages`
  : `read what members of ${group} read, and comment where members may`;

export function GroupServiceSignIns(props: { group: Pick<GroupSummary, 'id' | 'name' | 'role'> }): JSX.Element {
  const admin = () => props.group.role === 'admin';
  const path = () => `/api/groups/${encodeURIComponent(props.group.id)}/service-sign-ins`;
  const list = usePageData<Approvals>(path, { enabled: admin });
  const [service, setService] = createSignal('');
  const [level, setLevel] = createSignal<Level>('member');
  const [asking, setAsking] = createSignal<'approve' | Approval | null>(null);
  const [busy, setBusy] = createSignal(false);
  const [error, setError] = createSignal('');
  const chosen = () => service() || list.data()?.services[0]?.id || '';
  const who = (approval: Approval) => personLabel(approval.approved_by, 'a former Admin');
  const act = async () => {
    const asked = asking(); if (!asked || busy()) return;
    setBusy(true); setError('');
    try {
      if (asked === 'approve') await apiRequest(path(), 'POST', { service_id: chosen(), role: level() });
      else await apiRequest(`${path()}/${encodeURIComponent(asked.id)}`, 'DELETE');
      setAsking(null); await list.refresh(true);
    } catch { setError(asked === 'approve' ? 'Could not approve that service. Try again.' : 'Could not revoke that approval. Try again.'); }
    finally { setBusy(false); }
  };
  return <Show when={admin() && (list.data()?.services.length || list.data()?.approvals.length || list.error())}>
    <Panel label="Services that may act as this group" title="Services that may act as this group">
      <Show when={asking()}>{asked => {
        const approving = asked() === 'approve';
        const subject = approving ? { service: chosen(), role: level() } : { service: (asked() as Approval).service_id, role: (asked() as Approval).role };
        return <ConfirmDialog
          title={approving ? `Let ${subject.service} act as ${props.group.name}?` : `Stop ${subject.service} acting as ${props.group.name}?`}
          description={approving
            ? `${subject.service} will be able to sign an agent in as ${props.group.name} at ${subject.role} level, with nobody present, and ${powers(props.group.name, subject.role)}. It cannot reach anyone's personal pages, share, delete or change members. It lasts until an Admin revokes it here.`
            : `Every agent ${subject.service} signed in as ${props.group.name} stops on its next request.`}
          action={approving ? 'Approve service' : 'Revoke approval'} confirmLabel={approving ? 'Confirm approve' : 'Confirm revoke'} danger={!approving}
          busy={busy()} error={error()} onCancel={() => setAsking(null)} onConfirm={() => void act()} />;
      }}</Show>
      <p class="mb-3 text-sm leading-relaxed text-muted">An approved service runs agents that act as {props.group.name}, not as any person, when nobody is present.</p>
      <Show when={list.data()} fallback={<Show when={list.error()} fallback={<StatusMessage kind="loading">Loading approvals…</StatusMessage>}><StatusMessage kind="error" action={<Button variant="link" type="button" onClick={() => void list.refresh(true)}>Retry approvals</Button>}>Could not load the approvals.</StatusMessage></Show>}>
        {(value) => <>
          <Show when={value().approvals.length} fallback={<StatusMessage kind="empty" class="my-5">No service may act as this group.</StatusMessage>}>
            <ul class="mt-2"><For each={value().approvals}>{(approval) => <ListRow>
              <span class="min-w-0 flex-1 break-words font-medium">{approval.service_id}</span>
              <Badge tone="dim">{approval.role}</Badge>
              <Show when={approval.configured === false}><Badge tone="caution">Not configured</Badge></Show>
              <span class="text-xs text-muted">Approved by {who(approval)} · {dateTime(approval.created_at)}</span>
              <Button variant="secondary" type="button" disabled={busy()} aria-label={`Revoke ${approval.service_id} (${approval.role})`} onClick={() => setAsking(approval)}>Revoke</Button>
            </ListRow>}</For></ul>
          </Show>
          <Show when={value().services.length}>
            <div class="mt-4 grid gap-3 sm:grid-cols-[minmax(0,1fr)_8rem_auto]">
              <Select ariaLabel="Service to approve" value={chosen()} options={value().services.map(s => ({ value: s.id, label: s.id }))} onChange={setService} />
              <Select ariaLabel="Level to approve" value={level()} options={LEVELS} onChange={next => setLevel(next as Level)} />
              <Button type="button" disabled={busy()} onClick={() => setAsking('approve')}>Approve service</Button>
            </div>
          </Show>
        </>}
      </Show>
    </Panel>
  </Show>;
}
