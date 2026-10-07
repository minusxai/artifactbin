/* @jsxImportSource solid-js */
import type { JSX } from 'solid-js';
import { DialogShell } from '@/solid/components/DialogShell';

/** Recovery stays modal until the user explicitly restores the authoritative draft. */
export default function ProseRecoveryDialog(props: {
  fragment: string;
  onCopy: () => void;
  onRestore: () => void;
}): JSX.Element {
  return <DialogShell onClose={() => {}} lockScroll initialFocus="textarea">
    <div class="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/30 px-4 pt-28 pb-8">
      <div role="alertdialog" aria-modal="true" aria-label="Recover uncommitted text" class="w-full max-w-xl rounded border border-edge bg-surface p-4 text-fg shadow-xl">
        <h2 class="font-semibold">Your text needs recovery</h2>
        <p class="mt-2 text-sm">Editing is paused because this change could not be safely applied. Copy your text before restoring the document.</p>
        <label class="mt-3 block text-sm">Uncommitted text, including formatting markup
          <textarea aria-label="Uncommitted text" readOnly value={props.fragment} class="mt-2 h-48 w-full rounded border border-edge bg-surface p-2 font-mono text-sm" />
        </label>
        <div class="mt-4 flex flex-wrap gap-3">
          <button type="button" class="rounded border border-edge bg-raised px-3 py-2 text-sm" onClick={props.onCopy}>Copy uncommitted text</button>
          <button type="button" class="rounded border border-edge px-3 py-2 text-sm" onClick={props.onRestore}>Discard this text and restore document</button>
        </div>
      </div>
    </div>
  </DialogShell>;
}
