/* @jsxImportSource solid-js */
import { createSignal, Show, type JSX } from 'solid-js';
import Pencil from 'lucide-solid/icons/pencil';
import { writeBrowserArtifact } from '@/lib/artifact-backend/browser-artifact-write';
import { Button } from '../ui/Button';
import { Dialog } from '../ui/Dialog';
import { Field, Input } from '../ui/Field';

export interface RenameDocumentProps {
  id: string;
  title: string;
  onRenamed: (title: string) => void;
}
/** Renaming changes metadata through the conditional write contract. */
export function RenameDocument(props: RenameDocumentProps): JSX.Element {
  const [open, setOpen] = createSignal(false);
  const [draft, setDraft] = createSignal(props.title);
  const [busy, setBusy] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);
  const save = async (event: SubmitEvent) => {
    event.preventDefault();
    if (busy()) return;
    setBusy(true); setError(null);
    try {
      const response = await writeBrowserArtifact(props.id, { title: draft() });
      if (!response.ok) throw new Error('Could not rename this artifact. Refresh and try again.');
      props.onRenamed(draft()); setOpen(false);
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not rename this artifact.'); }
    finally { setBusy(false); }
  };
  return <>
    <Button variant="ghost" size="sm" class="w-full justify-start" aria-label="Rename artifact" onClick={() => { setDraft(props.title); setError(null); setOpen(true); }}><Pencil size={14} />rename artifact</Button>
    <Show when={open()}><Dialog title="Rename artifact" busy={busy()} onClose={() => setOpen(false)}>
      <form onSubmit={(event) => void save(event)} class="grid gap-4">
        <Field label="Title" error={error()}><Input value={draft()} onInput={(event) => setDraft(event.currentTarget.value)} disabled={busy()} /></Field>
        <div class="flex justify-end gap-2"><Button variant="secondary" onClick={() => setOpen(false)} disabled={busy()}>Cancel</Button><Button type="submit" disabled={busy()}>Save title</Button></div>
      </form>
    </Dialog></Show>
  </>;
}
