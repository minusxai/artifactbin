/* @jsxImportSource solid-js */
import { Show, type JSX } from 'solid-js';
import { Dialog } from './Dialog';
import { Button } from './Button';

/** One modal confirmation; the caller owns mutation and refusal state. Focus starts on Cancel. */
export function ConfirmDialog(props: { title: string; description: JSX.Element; action: string; confirmLabel?: string; cancelLabel?: string; danger?: boolean; busy?: boolean; error?: string | null; onConfirm: () => void; onCancel: () => void }): JSX.Element {
  return <Dialog title={props.title} description={props.description} busy={props.busy} onClose={props.onCancel} initialFocus="[data-confirm-cancel]"
    footer={<>
      <Button variant="secondary" data-confirm-cancel aria-label={props.cancelLabel} disabled={props.busy} onClick={props.onCancel}>Cancel</Button>
      <Button variant={props.danger ? 'danger' : 'primary'} aria-label={props.confirmLabel} disabled={props.busy} onClick={props.onConfirm}>{props.action}{props.busy ? '…' : ''}</Button>
    </>}>
    <Show when={props.error}><p role="alert" class="text-sm text-danger">{props.error}</p></Show>
  </Dialog>;
}
