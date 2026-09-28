/**
 * THE WRITE STATUS FEED (contract `WriteStatusFeed`, docs/phase2-architecture.md §4.1): every write
 * the document's store accepts, as the reader should see it — `saving` at once, then `saved` (dropped
 * after SAVED_STATUS_TTL_MS) or `failed` with the server's reason and a retry. A failure never
 * leaves on its own: it stays until the reader retries it (the same MutationRequest, re-issued
 * through the store) or dismisses it.
 *
 * Built on the store's own write lifecycle (lib/story-runtime/store `subscribeWrites`), so a write
 * from any caller — an island, the author's `window.mx`, the SPA — is reported the same way.
 * Framework-free; the indicator (kit/status.tsx) and boot's `writes` event read it.
 */
import type { DataflowStore, StoreWriteEvent } from '@/lib/story-runtime/store';
import { SAVED_STATUS_TTL_MS, type WriteStatus, type WriteStatusFeed } from './contract';

export function createWriteStatusFeed(store: DataflowStore | null): WriteStatusFeed {
  let statuses: readonly WriteStatus[] = [];
  const listeners = new Set<(statuses: readonly WriteStatus[]) => void>();

  const publish = (next: readonly WriteStatus[]) => {
    statuses = next;
    for (const listener of [...listeners]) listener(statuses);
  };
  // Only ordinary saved entries expire; failed/notifying entries have no timer to cancel.
  const remove = (id: number) => publish(statuses.filter((s) => s.id !== id));
  const replace = (next: WriteStatus) => publish(statuses.map((s) => (s.id === next.id ? next : s)));

  const retry = (id: number, request: Extract<StoreWriteEvent, { type: 'writeFailed' }>['request']) => {
    if (!store || !statuses.some((s) => s.id === id && s.state === 'failed')) return;
    remove(id);
    // The retry is a new write: its own `saving`, then its own outcome. Its rejection is that outcome, reported above.
    store.mutate(request).catch(() => {});
  };

  const onWrite = (event: StoreWriteEvent) => {
    if(event.type==='write'){
      publish([...statuses,{id:event.id,mutation:event.name,state:'saving',startedAt:Date.now()}]);
      return;
    }
    const current=statuses.find(s=>s.id===event.id);
    if(!current)return;
    if(event.type==='written'){
      replace({...current,state:'saved',mutationRunId:event.mutationRunId});
      if(!event.mutationRunId)setTimeout(remove,SAVED_STATUS_TTL_MS,event.id);
      return;
    }
    const { error } = event;
    const message = error instanceof Error ? error.message : typeof error === 'string' ? error : 'The change was not saved.';
    const code = error && typeof error === 'object' ? (error as { code?: unknown }).code : undefined;
    replace({
      ...current, state: 'failed',
      error: { message, code: typeof code === 'string' ? code : undefined, retry: () => retry(event.id, event.request) },
    });
  };
  store?.subscribeWrites(onWrite);

  return {
    current: () => statuses,
    subscribe: (listener) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
    dismiss: (id) => {
      if (statuses.some((s) => s.id === id && (s.state === 'failed'||s.mutationRunId))) remove(id);
    },
  };
}
