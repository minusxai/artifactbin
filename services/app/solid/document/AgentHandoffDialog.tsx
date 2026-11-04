/* @jsxImportSource solid-js */
import type { JSX } from 'solid-js';
import { Dialog } from '../ui/Dialog';
import { StarterInstructions } from '../components/StarterInstructions';

/** "Hand to an agent" from a document's controls: the agent starter's paste for this page, in a dialog. */
export function AgentHandoffDialog(props: { id: string; template?: string | null; onClose: () => void }): JSX.Element {
  return <Dialog title="Hand to an agent" closeLabel="Close" onClose={props.onClose} initialFocus="button[aria-label='Copy agent instructions']">
    <StarterInstructions id={props.id} template={props.template} variant="dialog" />
  </Dialog>;
}
