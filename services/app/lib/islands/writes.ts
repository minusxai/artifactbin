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

const messageOf = (error: unknown): string => (error instanceof Error ? error.message : typeof error === 'string' ? error : 'The change was not saved.');
const codeOf = (error: unknown): string | undefined => {
  const code = error && typeof error === 'object' ? (error as { code?: unknown }).code : undefined;
  return typeof code === 'string' ? code : undefined;
};

export function createWriteStatusFeed(store: DataflowStore | null): WriteStatusFeed {
  let statuses: readonly WriteStatus[] = [];
  const listeners = new Set<(statuses: readonly WriteStatus[]) => void>();
  const timers = new Map<number, ReturnType<typeof setTimeout>>();

  const publish = (next: readonly WriteStatus[]) => {
    statuses = next;
    for (const listener of [...listeners]) listener(statuses);
  };
  const without = (id: number) => {
    const timer = timers.get(id);
    if (timer !== undefined) { clearTimeout(timer); timers.delete(id); }
    return statuses.filter((s) => s.id !== id);
  };
  const replace = (id: number, next: WriteStatus) => publish(statuses.map((s) => (s.id === id ? next : s)));

  const retry = (id: number, request: Extract<StoreWriteEvent, { type: 'writeFailed' }>['request']) => {
    if (!store || !statuses.some((s) => s.id === id && s.state === 'failed')) return;
    publish(without(id));
    // The retry is a new write: its own `saving`, then its own outcome. Its rejection is that outcome, reported above.
    store.mutate(request).catch(() => {});
  };

  const onWrite = (event: StoreWriteEvent) => {
    switch (event.type) {
      case 'write':
        publish([...statuses, { id: event.id, mutation: event.name, state: 'saving', startedAt: Date.now() }]);
        return;
      case 'written': {
        const current = statuses.find((s) => s.id === event.id);
        if (!current) return;
        replace(event.id, { id: current.id, mutation: current.mutation, state: 'saved', startedAt: current.startedAt, ...(event.mutationRunId?{mutationRunId:event.mutationRunId}:{}) });
        if(!event.mutationRunId)timers.set(event.id, setTimeout(() => { timers.delete(event.id); publish(without(event.id)); }, SAVED_STATUS_TTL_MS));
        return;
      }
      case 'writeFailed': {
        const current = statuses.find((s) => s.id === event.id);
        if (!current) return;
        const code = codeOf(event.error);
        replace(event.id, {
          id: current.id, mutation: current.mutation, state: 'failed', startedAt: current.startedAt,
          error: { message: messageOf(event.error), ...(code ? { code } : {}), retry: () => retry(event.id, event.request) },
        });
      }
    }
  };
  store?.subscribeWrites(onWrite);

  return {
    current: () => statuses,
    subscribe: (listener) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
    dismiss: (id) => {
      if (statuses.some((s) => s.id === id && (s.state === 'failed'||!!s.mutationRunId))) publish(without(id));
    },
  };
}
