/* @jsxImportSource solid-js */
/**
 * A PAGE'S APPROVED QUERIES in its sharing surface, for an Admin of the group that owns it (lib/query-approvals): each
 * query the page declares on the install's default connection, whether it runs as the group for the signed-in accounts
 * that can open the page, and an
 * approve (stating plainly what readers will then see) or a revoke. Nothing is drawn for anyone else, or for a page with
 * no such query: the service answers them with a refusal or an empty list.
 */
import { createSignal, For, onCleanup, onMount, Show, type JSX } from 'solid-js';
import { Button } from '../ui/Button';
import { ConfirmDialog } from '../ui/ConfirmDialog';
import { apiFetch } from '../lib/api';

interface QueryApproval {
  name: string; connection: string; sql: string; hash: string; statement: string;
  approval: { id: string; approved_by: { name: string | null; username: string | null }; approved_at: string } | null;
}
interface Listing { group: { name: string }; queries: QueryApproval[] }

export function QueryApprovals(props: { id: string }): JSX.Element {
  const path = `/api/artifacts/${encodeURIComponent(props.id)}/query-approvals`;
  const [listing, setListing] = createSignal<Listing | null>(null);
  const [chosen, setChosen] = createSignal<{ query: QueryApproval; approve: boolean } | null>(null);
  const [busy, setBusy] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);
  const load = async (signal?: AbortSignal) => {
    const response = await apiFetch(path, 'GET', undefined, signal ? { signal } : undefined);
    const body = response.ok ? await response.json().catch(() => null) as Listing | null : null;
    setListing(body && Array.isArray(body.queries) && body.group ? body : null);
  };
  onMount(() => {
    const controller = new AbortController();
    void load(controller.signal).catch(() => setListing(null));
    onCleanup(() => controller.abort());
  });
  const confirm = async () => {
    const pick = chosen(); if (!pick || busy()) return;
    setBusy(true); setError(null);
    try {
      const response = pick.approve
        ? await apiFetch(path, 'POST', { query: pick.query.name, hash: pick.query.hash })
        : await apiFetch(`${path}/${encodeURIComponent(pick.query.approval!.id)}`, 'DELETE');
      if (!response.ok) {
        const refusal = await response.json().catch(() => null) as { error?: string; message?: string } | null;
        setError(refusal?.error === 'query_changed' ? 'This query changed since it was shown. Close and look at it again.' : refusal?.message ?? 'Could not change the approval. Try again.');
        return;
      }
      setChosen(null); await load();
    } catch { setError('Could not change the approval. Try again.'); }
    finally { setBusy(false); }
  };
  const by = (approval: NonNullable<QueryApproval['approval']>) => approval.approved_by.name ?? approval.approved_by.username ?? 'a former Admin';
  return <Show when={listing()?.queries.length ? listing() : null}>{current => <div class="mt-5 border-t border-edge pt-4" role="group" aria-label="Approved queries">
    <p class="mb-1 uppercase tracking-wider text-faint">queries on live data</p>
    <p class="mb-2 leading-relaxed text-muted">Each runs as the reader, who sees only data they may read. Approve one to show its results, as {current().group.name} sees them, to everyone signed in with their own account who can open this page.</p>
    <ul>
      <For each={current().queries}>{query => <li class="flex items-center justify-between gap-2 py-1">
        <span class="min-w-0 flex-1"><span class="block truncate font-medium">{query.name}</span>
          <span class="block truncate text-faint">{query.approval ? `runs as ${current().group.name} · approved by ${by(query.approval)}` : `runs as each reader · ${query.connection}`}</span></span>
        <Show when={query.approval} fallback={<Button variant="secondary" size="sm" aria-label={`Approve ${query.name}`} disabled={busy()} onClick={() => { setError(null); setChosen({ query, approve: true }); }}>Approve</Button>}>
          <Button variant="ghost" size="sm" aria-label={`Revoke ${query.name}`} disabled={busy()} onClick={() => { setError(null); setChosen({ query, approve: false }); }}>Revoke</Button>
        </Show>
      </li>}</For>
    </ul>
    <Show when={chosen()}>{pick => pick().approve
      ? <ConfirmDialog title={`Show ${pick().query.name} as ${current().group.name} sees it?`} action="Approve" confirmLabel={`Confirm approve ${pick().query.name}`} busy={busy()} error={error()}
          description={<><p>{pick().query.statement}</p><pre class="mt-2 max-h-40 overflow-auto whitespace-pre-wrap rounded-control border border-edge bg-raised p-2 font-mono text-xs">{pick().query.sql}</pre></>}
          onCancel={() => setChosen(null)} onConfirm={() => void confirm()} />
      : <ConfirmDialog title={`Stop showing ${pick().query.name} as ${current().group.name} sees it?`} action="Revoke" confirmLabel={`Confirm revoke ${pick().query.name}`} danger busy={busy()} error={error()}
          description={`From the next read it runs as each reader again: readers without their own access to this data are refused, until an Admin approves it again. Its editors may then change who can open this page again.`}
          onCancel={() => setChosen(null)} onConfirm={() => void confirm()} />}
    </Show>
  </div>}</Show>;
}
