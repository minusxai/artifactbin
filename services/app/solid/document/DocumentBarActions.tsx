/* @jsxImportSource solid-js */
/** Document actions have one presentation; each surface supplies its capabilities and handlers. */
import { Show, type JSX } from 'solid-js';
import MessageCircle from 'lucide-solid/icons/message-circle';
import Pencil from 'lucide-solid/icons/pencil';
import { Button } from '../ui/Button';
import { Tooltip } from '../ui/Tooltip';
/** The bar's rail action: ghost at rest, secondary while its panel or mode is on. */
export function DocumentAction(props: { label: string; active?: boolean; /** Only an icon inside: a square button, so a phone's bar fits its whole rail. */ iconOnly?: boolean; disabled?: boolean; description?: string; onClick: () => void; onMouseDown?: (event: MouseEvent) => void; children: JSX.Element }): JSX.Element {
  return <Tooltip content={props.description ?? props.label}><Button variant={props.active ? 'secondary' : 'ghost'} size="sm" {...(props.iconOnly ? { icon: true as const } : {})} aria-label={props.label} aria-pressed={props.active} aria-description={props.description} disabled={props.disabled} onMouseDown={props.onMouseDown} onClick={props.onClick}>{props.children}</Button></Tooltip>;
}
export function DocumentCommentAction(props: { count: number; active?: boolean; onClick: () => void }): JSX.Element {
  return <DocumentAction label="Comment" active={props.active} iconOnly={props.count === 0} onClick={props.onClick}><MessageCircle size={18} stroke-width={1.5} /><Show when={props.count > 0}><span>{props.count}</span></Show></DocumentAction>;
}
export function DocumentEditAction(props: { editing: boolean; disabled?: boolean; description?: string; onClick: () => void; onMouseDown?: (event: MouseEvent) => void }): JSX.Element {
  return <DocumentAction label={props.editing ? 'Done editing' : 'Edit'} iconOnly active={props.editing} disabled={props.disabled} description={props.description} onClick={props.onClick} onMouseDown={props.onMouseDown}><Pencil size={18} stroke-width={1.5} /></DocumentAction>;
}
