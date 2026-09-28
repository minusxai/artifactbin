/* @jsxImportSource solid-js */
/**
 * THE WRITE STATUS INDICATOR'S VIEW, loaded by kit/status.tsx on the page's first
 * write (`data-mx-write-status`, contract WRITE_STATUS_ATTR): what the page's writes are doing, drawn from the document's feed (lib/islands/writes). `saving` while any write is
 * in flight, `saved` briefly after the last one lands, and every `failed` write with the server's
 * reason, a Retry (the same write again) and a Dismiss — a refused change never disappears on its own.
 *
 * First-party chrome, not the author's: it mounts in its own element at the end of the story root's
 * document body (never inside the story, so it meets no hydration key and no parity comparison) and
 * positions itself through the CSSOM, since the story sheet deliberately compiles no `fixed` utility
 * for authored markup. It is its own chunk: a page that never writes loads none of it.
 */
import { createSignal, For, Show } from 'solid-js';
import { render } from 'solid-js/web';
import type { WriteState, WriteStatus, WriteStatusFeed } from '../contract';

/** The indicator's own element (the status element inside carries WRITE_STATUS_ATTR), for the SPA and tests to find its mount. */
export const WRITE_STATUS_HOST_ATTR = 'data-mx-write-status-host';

/** The one word the indicator shows for the whole feed: a failure outranks a save in flight, which outranks a landed one. */
export function overallWriteState(statuses: readonly WriteStatus[]): WriteState | null {
  if (!statuses.length) return null;
  if (statuses.some((s) => s.state === 'failed')) return 'failed';
  if (statuses.some((s) => s.state === 'saving')) return 'saving';
  return 'saved';
}

function Indicator(props: { statuses: () => readonly WriteStatus[]; dismiss: (id: number) => void }) {
  const state = () => overallWriteState(props.statuses());
  const failed = () => props.statuses().filter((s) => s.state === 'failed');
  return (
    <Show when={state()}>
      {(now) => (
        <div
          data-mx-write-status={now()}
          role="status"
          aria-live="polite"
          class="flex max-w-sm flex-col gap-2 rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground shadow-sm"
          style={{ position: 'fixed', right: '16px', bottom: '16px', 'z-index': '2147483000' }}
        >
          <Show when={now() !== 'failed'}>
            <span class="text-muted-foreground">{now() === 'saving' ? 'Saving…' : 'Saved'}</span>
          </Show>
          <For each={failed()}>
            {(status) => (
              <div role="alert" data-mx-write-failed={String(status.id)} class="flex items-start gap-2">
                <span class="min-w-0 flex-1 text-destructive">
                  Not saved ({status.mutation}): {status.error?.message ?? 'the change was refused.'}
                </span>
                <button
                  type="button"
                  aria-label={`Retry saving ${status.mutation}`}
                  class="shrink-0 rounded-md border border-border px-2 text-sm hover:bg-muted"
                  onClick={() => status.error?.retry()}
                >
                  Retry
                </button>
                <button
                  type="button"
                  aria-label={`Dismiss the failed save of ${status.mutation}`}
                  class="shrink-0 rounded-md px-1 text-sm text-muted-foreground hover:text-foreground"
                  onClick={() => props.dismiss(status.id)}
                >
                  ×
                </button>
              </div>
            )}
          </For>
        </div>
      )}
    </Show>
  );
}

/** Draw the indicator for `feed` (status.tsx calls this on the first write, once the chunk loaded). Returns its disposer. */
export function mountStatus(feed: WriteStatusFeed, root: HTMLElement): () => void {
  const doc = root.ownerDocument;
  const [statuses, setStatuses] = createSignal<readonly WriteStatus[]>(feed.current());
  const host = doc.createElement('div');
  host.setAttribute(WRITE_STATUS_HOST_ATTR, '');
  (doc.body ?? root).appendChild(host);
  const unsubscribe = feed.subscribe((next) => setStatuses(next));
  const dispose = render(() => <Indicator statuses={statuses} dismiss={(id) => feed.dismiss(id)} />, host);
  return () => {
    unsubscribe();
    dispose();
    host.remove();
  };
}
