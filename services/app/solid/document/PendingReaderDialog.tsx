/* @jsxImportSource solid-js */
import {Dialog} from '../ui/Dialog';
import {Button} from '../ui/Button';
/** A requested reader dialog remains visible and cancellable while its chunk loads. */
export function PendingReaderDialog(props:{title:string;onClose:()=>void}) {
 return <Dialog title={props.title} onClose={props.onClose} footer={<Button variant="secondary" onClick={props.onClose}>Cancel</Button>}>
  <p role="status" aria-busy="true">Loading…</p>
 </Dialog>;
}
