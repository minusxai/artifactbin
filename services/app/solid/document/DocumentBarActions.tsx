/* @jsxImportSource solid-js */
/** Document actions have one presentation; each surface supplies its capabilities and handlers. */
import { Show, type JSX } from 'solid-js';
import MessageCircle from 'lucide-solid/icons/message-circle';
import { Button } from '../ui/Button';
import { Tooltip } from '../ui/Tooltip';
/** The bar's rail action: ghost at rest, secondary while its panel or mode is on. */
function DocumentAction(props: { label: string; active?: boolean; /** An icon-only action: a square button (36 wide, the bar's touch target), so a phone's bar fits its whole rail. */ icon?: boolean; /** A count drawn as a badge on the icon's corner, so it never widens the button. */ badge?: number; disabled?: boolean; description?: string; onClick: () => void; onMouseDown?: (event: MouseEvent) => void; /** The pointer reached the action, focus did, or it was pressed: the click that follows can start its work now. */ onIntent?: () => void; children: JSX.Element }): JSX.Element {
  return <Tooltip content={props.description ?? props.label}><Button variant={props.active ? 'secondary' : 'ghost'} size="sm" {...(props.icon ? { icon: true as const } : {})} class={props.icon ? 'relative min-w-9' : ''} aria-label={props.label} aria-pressed={props.active} aria-description={props.description} disabled={props.disabled} onMouseDown={props.onMouseDown} onPointerEnter={props.onIntent} onFocus={props.onIntent} onPointerDown={props.onIntent} onClick={props.onClick}>{props.children}<Show when={props.badge}><span class="absolute -right-0.5 -top-0.5 rounded-full bg-accent px-1 font-mono text-micro leading-4 text-action-ink">{props.badge}</span></Show></Button></Tooltip>;
}
export function DocumentCommentAction(props: { count: number; active?: boolean; onClick: () => void }): JSX.Element {
  return <DocumentAction label="Comment" active={props.active} icon badge={props.count} onClick={props.onClick}><MessageCircle size={18} stroke-width={1.5} /></DocumentAction>;
}
