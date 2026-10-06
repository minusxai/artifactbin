/* @jsxImportSource solid-js */
import { createMemo, createSignal, For, Show, type JSX } from 'solid-js';
import { Ban } from 'lucide-solid';
import { usePageData } from '../lib/use-page-data';
import { Button, PANEL, TABLE_ROW } from './ui';
import { ConfirmDialog } from './ConfirmDialog';

interface UserTokenView { id: string; name: string | null; status: 'active' | 'expired' | 'revoked'; created_at: string; deleted_at: string | null; expires_at: string | null; last_used_at: string | null }
function relativeTime(iso: string | null): string { if (iso === null) return 'never'; const delta = new Date(iso).getTime() - Date.now(); const magnitude = Math.abs(delta); const [amount, unit] = magnitude < 3600000 ? [Math.max(1, Math.floor(magnitude / 60000)), 'm'] : magnitude < 86400000 ? [Math.floor(magnitude / 3600000), 'h'] : [Math.floor(magnitude / 86400000), 'd']; return delta > 0 ? `in ${amount}${unit}` : `${amount}${unit} ago`; }

export function TokensPanel(): JSX.Element {
  const page = usePageData<{ tokens: UserTokenView[] }>('/api/my/tokens');
  const [view, setView] = createSignal<'active' | 'history'>('active');
  const [pageIndex, setPageIndex] = createSignal(0);
  const active = createMemo(() => (page.data()?.tokens ?? []).filter(token => token.status === 'active'));
  const history = createMemo(() => (page.data()?.tokens ?? []).filter(token => token.status !== 'active'));
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
  return <section aria-label="CLI connections" class={`${PANEL} overflow-hidden`}>
    <Show when={selected()}>{token => <ConfirmDialog title={`Revoke “${token().name ?? token().id}”?`} description="Agents using this token will stop working immediately. This cannot be undone." action="Revoke token" confirmLabel="Confirm revoke" danger busy={busy()} error={error()} onCancel={() => setSelected(null)} onConfirm={() => void revoke()} />}</Show>
    <div class="flex flex-wrap items-center justify-between gap-3 border-b border-edge px-4 py-3">
      <div class="flex gap-2" role="group" aria-label="Connection status">
        <Button type="button" variant={view() === 'active' ? 'solid' : 'ghost'} aria-pressed={view() === 'active'} onClick={() => switchView('active')}>Active ({active().length})</Button>
        <Button type="button" variant={view() === 'history' ? 'solid' : 'ghost'} aria-pressed={view() === 'history'} onClick={() => switchView('history')}>History ({history().length})</Button>
      </div>
      <span class="text-xs text-muted">{view() === 'active' ? 'Can access your account' : 'Expired and revoked connections'}</span>
    </div>
    <Show when={page.error()}><p role="alert" class="p-4 text-sm text-danger">Could not load connections. <Button variant="ghost" onClick={() => void page.refresh(true)}>Retry connections</Button></p></Show>
    <Show when={!page.data() && !page.error()}><p role="status" class="p-4 text-sm text-muted">Loading connections…</p></Show>
    <Show when={page.data()}>
      <Show when={visible().length} fallback={<p class="p-5 text-sm text-muted">{view() === 'active' ? 'No active connections. Run afbin auth to connect an agent.' : 'No connection history yet.'}</p>}>
        <div class="overflow-x-auto"><table aria-label="Connections" class="w-full table-fixed border-collapse text-left text-sm"><thead><tr class="text-xs text-muted">
          <th scope="col" class="px-4 py-2.5 font-medium">Name</th><th scope="col" class="hidden w-24 px-3 py-2.5 font-medium lg:table-cell">Status</th><th scope="col" class="hidden w-28 px-3 py-2.5 font-medium lg:table-cell">Expires</th><th scope="col" class="hidden w-28 px-3 py-2.5 font-medium lg:table-cell">Last used</th><th scope="col" class="w-32 px-4 py-2.5 text-right font-medium">Action</th>
        </tr></thead><tbody><For each={visible()}>{token => <tr aria-label={`Token row ${token.name ?? token.id}`} class={TABLE_ROW}>
          <td class="px-4 py-2.5 align-middle"><div class="flex min-w-0 items-center gap-2"><span aria-label={`Token ${token.name ?? token.id} ${token.status} status dot`} class={`inline-block h-1.5 w-1.5 shrink-0 rounded-full ${token.status === 'active' ? 'bg-accent' : token.status === 'expired' ? 'bg-danger' : 'bg-faint'}`} /><span class="truncate font-mono text-xs">{token.name ?? '(unnamed)'}</span></div><div class="mt-1 text-xs text-muted lg:hidden">{token.status} · {token.expires_at ? `Expires ${relativeTime(token.expires_at)}` : 'No expiry'} · Last used {relativeTime(token.last_used_at)}</div></td>
          <td aria-label={`Token ${token.name ?? token.id} status`} class="hidden px-3 py-2.5 text-xs text-muted lg:table-cell">{token.status}</td>
          <td aria-label={`Token ${token.name ?? token.id} expires`} class="hidden whitespace-nowrap px-3 py-2.5 text-xs text-muted lg:table-cell">{token.expires_at ? relativeTime(token.expires_at) : 'No expiry'}</td>
          <td aria-label={`Token ${token.name ?? token.id} last used`} class="hidden whitespace-nowrap px-3 py-2.5 text-xs text-muted lg:table-cell">{relativeTime(token.last_used_at)}</td>
          <td class="px-4 py-2.5 text-right align-middle"><Show when={token.status !== 'revoked'} fallback={<span class="text-xs text-muted">Revoked</span>}><Button variant="danger" type="button" aria-label={`Revoke token ${token.name ?? token.id}`} onClick={() => setSelected(token)} class="inline-flex shrink-0 items-center justify-center gap-1.5 whitespace-nowrap"><Ban size={12} />Revoke</Button></Show></td>
        </tr>}</For></tbody></table></div>
      </Show>
      <Show when={filtered().length > 5}><div class="flex items-center justify-between gap-2 border-t border-edge px-4 py-3"><span role="status" class="text-xs text-muted">{currentPage() * 5 + 1}–{Math.min(currentPage() * 5 + 5, filtered().length)} of {filtered().length}</span><div class="flex gap-2"><Button variant="ghost" aria-label="Previous connections page" disabled={currentPage() === 0} onClick={() => setPageIndex(currentPage() - 1)}>Previous</Button><Button variant="ghost" aria-label="Next connections page" disabled={currentPage() === lastPage()} onClick={() => setPageIndex(currentPage() + 1)}>Next</Button></div></div></Show>
    </Show>
  </section>;
}
