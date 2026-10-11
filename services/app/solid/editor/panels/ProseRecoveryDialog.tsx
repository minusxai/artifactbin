/* @jsxImportSource solid-js */
import type { JSX } from 'solid-js';
import { createDialogShell } from '@/lib/islands/kit/dialog-shell';
import { Button } from '@/solid/ui/Button';
import { Textarea } from '@/solid/ui/Field';

/**
 * Recovery stays modal until the user explicitly restores the authoritative draft.
 *
 * The overlay and the alert-dialog role stay hand-drawn: ui/Dialog is always a plain dialog, named by its visible
 * title, and closes on a backdrop press, none of which this may do (an alert dialog named "Recover uncommitted
 * text" under a different heading). It takes the modal contract from createDialogShell directly.
 */
export default function ProseRecoveryDialog(props: {
  fragment: string;
  onCopy: () => void;
  onRestore: () => void;
}): JSX.Element {
  let panel!: HTMLDivElement;
  createDialogShell({ panel: () => panel, onClose: () => {}, lockScroll: true, initialFocus: () => panel.querySelector('textarea') });
  return <div class="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/30 px-4 pt-28 pb-8">
    <div ref={panel} role="alertdialog" aria-modal="true" aria-label="Recover uncommitted text" class="w-full max-w-xl rounded-dialog border border-edge bg-surface p-4 text-fg shadow-xl">
      <h2 class="font-semibold">Your text needs recovery</h2>
      <p class="mt-2 text-sm">Editing is paused because this change could not be safely applied. Copy your text before restoring the document.</p>
      <label class="mt-3 block text-sm">Uncommitted text, including formatting markup
        <Textarea size="sm" aria-label="Uncommitted text" readOnly value={props.fragment} class="mt-2 h-48" />
      </label>
      <div class="mt-4 flex flex-wrap gap-3">
        <Button variant="secondary" onClick={props.onCopy}>Copy uncommitted text</Button>
        <Button variant="danger" onClick={props.onRestore}>Discard this text and restore document</Button>
      </div>
    </div>
  </div>;
}
