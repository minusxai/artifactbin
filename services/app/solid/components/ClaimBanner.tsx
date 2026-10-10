/* @jsxImportSource solid-js */
import { createSignal, For, onCleanup, onMount, Show, type JSX } from 'solid-js';
import { REFRESH_EVENT } from '@/solid/lib/page-data-events';
import { Button, PANEL } from '../ui/ui';
import { ConfirmDialog } from '../ui/ConfirmDialog';
import { apiFetch } from '../lib/api';

interface Claimable { tokenId: string; titles: string[]; artifacts: number }
/** Browser tokens remain in httpOnly cookies; this only names server-approved offers. */
export default function ClaimBanner(): JSX.Element {
  const [offers, setOffers] = createSignal<Claimable[]>([]);
  const [picked, setPicked] = createSignal<Record<string, boolean>>({});
  const [busy, setBusy] = createSignal(false);
  const [rejecting, setRejecting] = createSignal<string | null>(null);
  const [rejectBusy, setRejectBusy] = createSignal(false);
  const [rejectError, setRejectError] = createSignal('');
  const [result, setResult] = createSignal<string | null>(null);
  onMount(() => {
    let live = true;
    void fetch('/api/tokens/claimable', { method: 'POST' }).then(response => response.ok ? response.json() as Promise<{ claimable?: Claimable[] }> : null).then(body => {
      if (!live || !body?.claimable?.length) return;
      setOffers(body.claimable); setPicked(Object.fromEntries(body.claimable.map(offer => [offer.tokenId, true])));
    }).catch(() => {});
    onCleanup(() => { live = false; });
  });
  const claim = async () => {
    const selected = offers().filter(offer => picked()[offer.tokenId]);
    if (!selected.length) return;
    setBusy(true);
    const outcomes = await Promise.all(selected.map(async offer => {
      const response = await apiFetch('/api/tokens/claim', 'POST', { tokenId: offer.tokenId }).catch(() => null);
      return { offer, ok: Boolean(response?.ok) };
    }));
    const ok = outcomes.filter(item => item.ok).length; const failed = outcomes.length - ok;
    setBusy(false); setResult(failed ? `Added ${ok}. ${failed} could not be added — they may have been revoked.` : `Added ${ok} to your account.`);
    setOffers(current => current.filter(offer => !outcomes.some(item => item.ok && item.offer.tokenId === offer.tokenId)));
    if (ok) window.dispatchEvent(new Event(REFRESH_EVENT));
  };
  const reject = async () => {
    const tokenId = rejecting(); if (!tokenId) return;
    setRejectBusy(true); setRejectError('');
    const response = await apiFetch('/api/tokens/reject', 'POST', { tokenId }).catch(() => null);
    setRejectBusy(false);
    if (!response?.ok) { setRejectError('Could not reject these drafts. Try again.'); return; }
    setOffers(current => current.filter(offer => offer.tokenId !== tokenId));
    setPicked(current => { const next = { ...current }; delete next[tokenId]; return next; });
    setResult(null); setRejecting(null);
  };
  return <Show when={offers().length || result()}><section aria-label="Unclaimed drafts" class={`${PANEL} mb-6 p-4`}>
    <Show when={offers().length}><p class="font-sans text-sm text-fg">Made from this browser before you signed in — add to your account?</p><ul class="mt-3 flex flex-col gap-1.5"><For each={offers()}>{offer => { const label = offer.titles.length ? offer.titles.join(', ') : 'an unsaved session from this browser'; const more = offer.artifacts - offer.titles.length; return <li class="flex items-start gap-2"><input type="checkbox" aria-label={`Claim ${offer.titles[0] ?? 'this session'}`} checked={Boolean(picked()[offer.tokenId])} onChange={event => setPicked(current => ({ ...current, [offer.tokenId]: event.currentTarget.checked }))} class="mt-0.5 cursor-pointer" /><span class="min-w-0 flex-1 font-mono text-xs text-muted">{label}{more > 0 ? ` +${more} more` : ''}</span><Button type="button" variant="danger" aria-label={`Reject ${offer.tokenId}`} disabled={busy()} onClick={() => setRejecting(offer.tokenId)} class="shrink-0 px-2 py-1">reject</Button></li>; }}</For></ul><div class="mt-3"><Button type="button" aria-label="Add to my account" disabled={busy()} onClick={() => void claim()}>{busy() ? 'adding…' : 'add to my account'}</Button></div></Show>
    <Show when={result()}><p aria-label="Claim result" class="mt-2 font-mono text-[11px] text-muted">{result()}</p></Show>
    <Show when={rejecting()}>{tokenId => <ConfirmDialog title="Reject these drafts?" description={`Reject ${offers().find(offer => offer.tokenId === tokenId())?.titles.join(', ') || 'this session'}? This browser’s token will be permanently revoked and cannot be recovered.`} action="Reject drafts" confirmLabel="Confirm reject" danger busy={rejectBusy()} error={rejectError()} onCancel={() => { setRejecting(null); setRejectError(''); }} onConfirm={() => void reject()} />}</Show>
  </section></Show>;
}
