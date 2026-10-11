/* @jsxImportSource solid-js */
import type { JSX } from 'solid-js';
import { Button } from '@/solid/ui/Button';
import { Dialog } from '@/solid/ui/Dialog';
import { Textarea } from '@/solid/ui/Field';

/**
 * Recovery stays modal until the user explicitly restores the authoritative draft: an alert dialog that neither
 * Escape nor a backdrop press dismisses (`dismissible={false}`), named "Recover uncommitted text".
 */
export default function ProseRecoveryDialog(props: {
  fragment: string;
  onCopy: () => void;
  onRestore: () => void;
}): JSX.Element {
  return <Dialog role="alertdialog" title="Your text needs recovery" label="Recover uncommitted text" size="lg" align="top" lockScroll
    dismissible={false} onClose={() => {}} initialFocus="textarea"
    description="Editing is paused because this change could not be safely applied. Copy your text before restoring the document."
    footer={<>
      <Button variant="secondary" onClick={props.onCopy}>Copy uncommitted text</Button>
      <Button variant="danger" onClick={props.onRestore}>Discard this text and restore document</Button>
    </>}>
    <label class="block text-sm">Uncommitted text, including formatting markup
      <Textarea size="sm" aria-label="Uncommitted text" readOnly value={props.fragment} class="mt-2 h-48" />
    </label>
  </Dialog>;
}
