/* @jsxImportSource solid-js */
/** Document actions have one presentation; each surface supplies its capabilities and handlers. */
import { Show, type JSX } from 'solid-js';
import MessageCircle from 'lucide-solid/icons/message-circle';
import Pencil from 'lucide-solid/icons/pencil';
import { Tooltip } from '../components/Tooltip';
export const DOCUMENT_ACTION_CLASS = 'relative flex h-9 min-w-9 cursor-pointer items-center justify-center gap-1 rounded-[8px] border-0 bg-transparent px-1.5 font-mono text-xs text-muted no-underline transition-colors hover:bg-raised hover:text-fg disabled:cursor-default disabled:opacity-50';
export function DocumentAction(props: { label: string; active?: boolean; disabled?: boolean; description?: string; onClick: () => void; onMouseDown?: (event: MouseEvent) => void; children: JSX.Element }): JSX.Element {
  return <Tooltip content={props.description ?? props.label}><button type="button" class={`${DOCUMENT_ACTION_CLASS} ${props.active ? 'text-accent' : ''}`} aria-label={props.label} aria-pressed={props.active} aria-description={props.description} disabled={props.disabled} onMouseDown={props.onMouseDown} onClick={props.onClick}>{props.children}</button></Tooltip>;
}
export function DocumentCommentAction(props: { count: number; active?: boolean; onClick: () => void }): JSX.Element {
  return <DocumentAction label="Comment" active={props.active} onClick={props.onClick}><MessageCircle size={18} stroke-width={1.5} /><Show when={props.count > 0}><span>{props.count}</span></Show></DocumentAction>;
}
export function DocumentEditAction(props: { editing: boolean; disabled?: boolean; description?: string; onClick: () => void; onMouseDown?: (event: MouseEvent) => void }): JSX.Element {
  return <DocumentAction label={props.editing ? 'Done editing' : 'Edit'} active={props.editing} disabled={props.disabled} description={props.description} onClick={props.onClick} onMouseDown={props.onMouseDown}><Pencil size={18} stroke-width={1.5} /></DocumentAction>;
}
