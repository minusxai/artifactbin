/* @jsxImportSource solid-js */
import { createSignal, For, Show, type JSX } from 'solid-js';
import { Ban } from 'lucide-solid';
import { usePageData } from '../lib/use-page-data';
import { MicroLabel, PANEL, TABLE_ROW } from './ui';
import { ConfirmDialog } from './ConfirmDialog';

interface UserTokenView { id: string; name: string | null; status: 'active' | 'expired' | 'revoked'; created_at: string; deleted_at: string | null; expires_at: string | null; last_used_at: string | null }
function relativeTime(iso: string | null): string { if (iso === null) return 'never'; const delta = new Date(iso).getTime() - Date.now(); const magnitude = Math.abs(delta); const [amount, unit] = magnitude < 3600000 ? [Math.max(1, Math.floor(magnitude / 60000)), 'm'] : magnitude < 86400000 ? [Math.floor(magnitude / 3600000), 'h'] : [Math.floor(magnitude / 86400000), 'd']; return delta > 0 ? `in ${amount}${unit}` : `${amount}${unit} ago`; }

export function TokensPanel(): JSX.Element {
  const page = usePageData<{ tokens: UserTokenView[] }>('/api/my/tokens');
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
  return <Show when={page.data()?.tokens.length}><section>
    <Show when={selected()}>{token => <ConfirmDialog title={`Revoke “${token().name ?? token().id}”?`} description="Agents using this token will stop working immediately. This cannot be undone." action="Revoke token" confirmLabel="Confirm revoke" danger busy={busy()} error={error()} onCancel={() => setSelected(null)} onConfirm={() => void revoke()} />}</Show>
    <div class={PANEL}><table class="w-full table-fixed border-collapse text-left text-sm"><thead><tr><For each={['name', 'status', 'expires', 'last used', 'action']}>{heading => <th class="px-2 py-2.5 sm:px-4"><MicroLabel>{heading}</MicroLabel></th>}</For></tr></thead><tbody><For each={page.data()?.tokens}>{token => <tr aria-label={`Token row ${token.name ?? token.id}`} class={`${TABLE_ROW} reveal`}><td class="px-2 py-2 sm:px-4"><span aria-label={`Token ${token.name ?? token.id} ${token.status} status dot`} class={`mr-2 inline-block h-1.5 w-1.5 rounded-full ${token.status === 'active' ? 'bg-accent' : token.status === 'expired' ? 'bg-danger' : 'bg-faint'}`} />{token.name ?? '(unnamed)'}</td><td aria-label={`Token ${token.name ?? token.id} status`} class="px-2 py-2 text-xs text-muted sm:px-4">{token.status}</td><td aria-label={`Token ${token.name ?? token.id} expires`} class="px-2 py-2 text-xs text-muted sm:px-4">{relativeTime(token.expires_at)}</td><td aria-label={`Token ${token.name ?? token.id} last used`} class="px-2 py-2 text-xs text-muted sm:px-4">{relativeTime(token.last_used_at)}</td><td class="px-2 py-2 sm:px-4"><Show when={token.status !== 'revoked'} fallback={<span class="text-xs text-faint">—</span>}><button type="button" aria-label={`Revoke token ${token.name ?? token.id}`} onClick={() => setSelected(token)} class="inline-flex items-center gap-1 text-xs text-danger"><Ban size={11} />revoke</button></Show></td></tr>}</For></tbody></table></div>
  </section></Show>;
}
