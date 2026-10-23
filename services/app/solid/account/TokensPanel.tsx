/* @jsxImportSource solid-js */
import { createMemo, createSignal, For, Show, type JSX } from 'solid-js';
import { Ban } from 'lucide-solid';
import { usePageData } from '../lib/use-page-data';
import { Button } from '../ui/Button';
import { Panel } from '../ui/Panel';
import { StatusMessage } from '../ui/StatusMessage';
import { Table, TableBody, TableCell, TableHead, TableHeaderCell, TableRow } from '../ui/Table';
import { ToggleGroup } from '../ui/ToggleGroup';
import { ConfirmDialog } from '../ui/ConfirmDialog';

interface UserTokenView { id: string; name: string | null; status: 'active' | 'expired' | 'revoked'; created_at: string; deleted_at: string | null; expires_at: string | null; last_used_at: string | null }
function relativeTime(iso: string | null): string { if (iso === null) return 'never'; const delta = new Date(iso).getTime() - Date.now(); const magnitude = Math.abs(delta); const [amount, unit] = magnitude < 3600000 ? [Math.max(1, Math.floor(magnitude / 60000)), 'm'] : magnitude < 86400000 ? [Math.floor(magnitude / 3600000), 'h'] : [Math.floor(magnitude / 86400000), 'd']; return delta > 0 ? `in ${amount}${unit}` : `${amount}${unit} ago`; }

export function TokensPanel(): JSX.Element {
  const page = usePageData<{ tokens: UserTokenView[] }>('/api/my/tokens');
  const [view, setView] = createSignal<'active' | 'history'>('active');
  const [pageIndex, setPageIndex] = createSignal(0);
  const active = createMemo(() => (page.data()?.tokens ?? []).filter(token => token.status === 'active'));
  const history = createMemo(() => (page.data()?.tokens ?? []).filter(token => token.status !== 'active'));
  // Stable option objects with live labels: ToggleGroup keys its buttons by option identity, so counts that change on a refresh must not rebuild them.
  const viewOptions = [{ value: 'active', get label() { return `Active (${active().length})`; } }, { value: 'history', get label() { return `History (${history().length})`; } }];
  const filtered = () => view() === 'active' ? active() : history();
  const lastPage = () => Math.max(0, Math.ceil(filtered().length / 5) - 1);
  const currentPage = () => Math.min(pageIndex(), lastPage());
  const visible = () => filtered().slice(currentPage() * 5, currentPage() * 5 + 5);
  const switchView = (next: 'active' | 'history') => { setView(next); setPageIndex(0); };
  const [selected, setSelected] = createSignal<UserTokenView | null>(null);
  const [busy, setBusy] = createSignal(false);
  const [error, setError] = createSignal('');
  const revoke = async () => {
    const token = selected(); if (!token || busy()) return;
    setBusy(true); setError('');
    const response = await fetch(`/api/my/tokens/${token.id}`, { method: 'DELETE' }).catch(() => null);
    setBusy(false);
    if (!response?.ok) { setError('Could not revoke that token. Try again.'); return; }
    setSelected(null);
    await page.refresh(true);
  };
  return <Panel label="API connections" padding="none" class="overflow-hidden">
    <Show when={selected()}>{token => <ConfirmDialog title={`Revoke “${token().name ?? token().id}”?`} description="Agents using this token will stop working immediately. This cannot be undone." action="Revoke token" confirmLabel="Confirm revoke" danger busy={busy()} error={error()} onCancel={() => setSelected(null)} onConfirm={() => void revoke()} />}</Show>
    <div class="flex flex-wrap items-center justify-between gap-3 border-b border-edge px-4 py-3">
      <ToggleGroup label="Connection status" size="md" value={view()} onChange={next => switchView(next as 'active' | 'history')}
        options={viewOptions} />
      <span class="text-xs text-muted">{view() === 'active' ? 'Can access your account' : 'Expired and revoked connections'}</span>
    </div>
    <Show when={page.error()}><StatusMessage kind="error" class="m-4" action={<Button variant="secondary" onClick={() => void page.refresh(true)}>Retry connections</Button>}>Could not load connections.</StatusMessage></Show>
    <Show when={!page.data() && !page.error()}><StatusMessage kind="loading" class="p-4">Loading connections…</StatusMessage></Show>
    <Show when={page.data()}>
      <Show when={visible().length} fallback={<StatusMessage kind="empty" class="p-5">{view() === 'active' ? 'No active connections. Connect through the HTTP authentication guide.' : 'No connection history yet.'}</StatusMessage>}>
        <Table label="Connections" fixed><TableHead>
          <TableHeaderCell>Name</TableHeaderCell><TableHeaderCell class="hidden w-24 lg:table-cell">Status</TableHeaderCell><TableHeaderCell class="hidden w-28 lg:table-cell">Expires</TableHeaderCell><TableHeaderCell class="hidden w-28 lg:table-cell">Last used</TableHeaderCell><TableHeaderCell align="right" class="w-32">Action</TableHeaderCell>
        </TableHead><TableBody><For each={visible()}>{token => <TableRow aria-label={`Token row ${token.name ?? token.id}`}>
          <TableCell><div class="flex min-w-0 items-center gap-2"><span aria-label={`Token ${token.name ?? token.id} ${token.status} status dot`} class={`inline-block h-1.5 w-1.5 shrink-0 rounded-full ${token.status === 'active' ? 'bg-accent' : token.status === 'expired' ? 'bg-danger' : 'bg-faint'}`} /><span class="truncate font-mono text-xs">{token.name ?? '(unnamed)'}</span></div><div class="mt-1 text-xs text-muted lg:hidden">{token.status} · {token.expires_at ? `Expires ${relativeTime(token.expires_at)}` : 'No expiry'} · Last used {relativeTime(token.last_used_at)}</div></TableCell>
          <TableCell aria-label={`Token ${token.name ?? token.id} status`} class="hidden text-xs text-muted lg:table-cell">{token.status}</TableCell>
          <TableCell aria-label={`Token ${token.name ?? token.id} expires`} class="hidden whitespace-nowrap text-xs text-muted lg:table-cell">{token.expires_at ? relativeTime(token.expires_at) : 'No expiry'}</TableCell>
          <TableCell aria-label={`Token ${token.name ?? token.id} last used`} class="hidden whitespace-nowrap text-xs text-muted lg:table-cell">{relativeTime(token.last_used_at)}</TableCell>
          <TableCell align="right"><Show when={token.status !== 'revoked'} fallback={<span class="text-xs text-muted">Revoked</span>}><Button variant="danger" type="button" aria-label={`Revoke token ${token.name ?? token.id}`} onClick={() => setSelected(token)}><Ban size={14} />Revoke</Button></Show></TableCell>
        </TableRow>}</For></TableBody></Table>
      </Show>
      <Show when={filtered().length > 5}><div class="flex items-center justify-between gap-2 border-t border-edge px-4 py-3"><span role="status" class="text-xs text-muted">{currentPage() * 5 + 1}–{Math.min(currentPage() * 5 + 5, filtered().length)} of {filtered().length}</span><div class="flex gap-2"><Button variant="secondary" aria-label="Previous connections page" disabled={currentPage() === 0} onClick={() => setPageIndex(currentPage() - 1)}>Previous</Button><Button variant="secondary" aria-label="Next connections page" disabled={currentPage() === lastPage()} onClick={() => setPageIndex(currentPage() + 1)}>Next</Button></div></div></Show>
    </Show>
  </Panel>;
}
