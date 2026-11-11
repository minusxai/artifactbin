/* @jsxImportSource solid-js */
/**
 * A GROUP'S ALLOWED ADDRESSES on its settings page: the exact origins its editors approved (from a page's consent bar,
 * or the API) for every member of the group and its subgroups, on any page (lib/trust/group-trust). Members
 * read the list; editors remove. Nothing is drawn when the installation turns group approvals off
 * (TRUST__GROUP_APPROVALS=off answers 403).
 */
import { createSignal, For, Show, type JSX } from 'solid-js';
import type { GroupSummary } from '@artifactbin/contracts';
import { apiRequest } from '../lib/api';
import { usePageData } from '../lib/use-page-data';
import { dateTime } from '../lib/format';
import { Button } from '../ui/Button';
import { ListRow, Panel } from '../ui/Panel';
import { StatusMessage } from '../ui/StatusMessage';
import { Badge } from '../ui/ui';

interface AllowedAddress { directive: 'connect' | 'img' | 'media'; host: string; approved_by: { id: string; username: string | null; name: string | null }; approved_at: string }
const KIND: Record<AllowedAddress['directive'], string> = { connect: 'Data', img: 'Images', media: 'Media' };

export function GroupAddresses(props: { group: Pick<GroupSummary, 'id' | 'name' | 'role'> }): JSX.Element {
  const path = () => `/api/groups/${encodeURIComponent(props.group.id)}/allowed-addresses`;
  const list = usePageData<{ addresses: AllowedAddress[] }>(path);
  const [busy, setBusy] = createSignal(false);
  const [error, setError] = createSignal('');
  const editor = () => props.group.role === 'editor';
  const disabled = () => (list.error() as { status?: number } | null)?.status === 403;
  const remove = async (address: AllowedAddress) => {
    if (busy()) return;
    setBusy(true); setError('');
    try { await apiRequest(path(), 'DELETE', { [address.directive]: [address.host] }); await list.refresh(true); }
    catch (e) { setError(e instanceof Error ? e.message : 'Could not remove the address.'); }
    finally { setBusy(false); }
  };
  return <Show when={!disabled()}>
    <Panel label="Allowed addresses" title="Allowed addresses">
      <p class="mb-3 text-sm leading-relaxed text-muted">Members of {props.group.name} and its subgroups are not asked about these addresses on any page that calls them. Scripts, styles and frames are always asked page by page.</p>
      <Show when={error()}><StatusMessage kind="error" class="my-3">{error()}</StatusMessage></Show>
      <Show when={list.data()} fallback={<Show when={list.error()} fallback={<StatusMessage kind="loading">Loading addresses…</StatusMessage>}><StatusMessage kind="error" action={<Button variant="link" type="button" onClick={() => void list.refresh(true)}>Retry addresses</Button>}>Could not load the allowed addresses.</StatusMessage></Show>}>
        {(value) => <Show when={value().addresses.length} fallback={<StatusMessage kind="empty" class="my-5">No addresses approved yet. A group editor can approve one from a page's network access bar.</StatusMessage>}>
          <ul class="mt-2"><For each={value().addresses}>{(address) => <ListRow>
            <span class="min-w-0 flex-1 break-all font-medium">{address.host.replace(/^https:\/\//, '')}</span>
            <Badge tone="dim">{KIND[address.directive]}</Badge>
            <span class="text-xs text-muted">Approved by {address.approved_by.name ?? address.approved_by.username ?? 'a former member'} · {dateTime(address.approved_at)}</span>
            <Show when={editor()}><Button variant="secondary" type="button" disabled={busy()} aria-label={`Remove ${address.host} (${KIND[address.directive]})`} onClick={() => void remove(address)}>Remove</Button></Show>
          </ListRow>}</For></ul>
        </Show>}
      </Show>
    </Panel>
  </Show>;
}
