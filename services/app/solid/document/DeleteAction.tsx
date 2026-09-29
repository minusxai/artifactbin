/* @jsxImportSource solid-js */
import { createSignal, Show, type JSX } from 'solid-js';
import Trash2 from 'lucide-solid/icons/trash-2';
import { pageDataChanged } from '@/web/page-data-events';
import { ConfirmDialog } from '../components/ConfirmDialog';

export function DeleteAction(props: { id: string; title: string; onDeleted: () => void }): JSX.Element {
  const [asked, setAsked] = createSignal(false);
  const [busy, setBusy] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);
  const remove = async () => {
    if (busy()) return;
    setBusy(true); setError(null);
    try {
      const response = await fetch(`/api/my/artifacts/${encodeURIComponent(props.id)}`, { method: 'DELETE' });
      if (!response.ok) {
        const body = await response.json().catch(() => ({})) as { error?: string };
        throw new Error(body.error ?? 'Could not move this artifact to trash. Try again.');
      }
      pageDataChanged(); props.onDeleted(); setAsked(false);
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not move this artifact to trash. Try again.'); }
    finally { setBusy(false); }
  };
  return <><button type="button" aria-label={`Delete ${props.title}`} onClick={() => setAsked(true)} class="flex w-full items-center gap-2 rounded px-2 py-2 text-left font-mono text-xs text-danger hover:bg-raised"><Trash2 size={14} />delete</button>
    <Show when={asked()}><ConfirmDialog title={`Delete “${props.title}”?`} description={`Delete "${props.title}"? The link stops working. It goes to the trash, where you can restore it any time.`}
      action="Move to trash" confirmLabel="Confirm delete" cancelLabel="Cancel delete" danger busy={busy()} error={error()} onConfirm={() => void remove()} onCancel={() => setAsked(false)} /></Show>
  </>;
}
