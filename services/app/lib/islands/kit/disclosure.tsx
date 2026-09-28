/* @jsxImportSource solid-js */
import { createContext, createSignal, createUniqueId, splitProps, useContext, type JSX } from 'solid-js';

type State = { open: () => boolean; setOpen: (value: boolean) => void; contentId: string };
const CollapsibleContext = createContext<State>(); const PopoverContext = createContext<State>();
function makeState(props: { open?: boolean; defaultOpen?: boolean; onOpenChange?: (value: boolean) => void }): State {
  const [local, setLocal] = createSignal(!!props.defaultOpen); const contentId = createUniqueId();
  return { open: () => props.open ?? local(), setOpen: value => { setLocal(value); props.onOpenChange?.(value); }, contentId };
}
export function Collapsible(props: JSX.HTMLAttributes<HTMLDivElement> & { open?: boolean; defaultOpen?: boolean; disabled?: boolean; onOpenChange?: (value: boolean) => void }) {
  const ctx = makeState(props); const [localProps, rest] = splitProps(props, ['open', 'defaultOpen', 'disabled', 'onOpenChange', 'children']);
  return <CollapsibleContext.Provider value={ctx}><div data-slot="collapsible" data-state={ctx.open() ? 'open' : 'closed'} {...rest}>{localProps.children}</div></CollapsibleContext.Provider>;
}
export function CollapsibleTrigger(props: JSX.ButtonHTMLAttributes<HTMLButtonElement>) {
  const ctx = useContext(CollapsibleContext)!;
  return <button type="button" aria-controls={undefined} aria-expanded={ctx.open()} data-state={ctx.open() ? 'open' : 'closed'} data-slot="collapsible-trigger" on:click={() => ctx.setOpen(!ctx.open())} {...props} />;
}
export function CollapsibleContent(props: JSX.HTMLAttributes<HTMLDivElement>) {
  const ctx = useContext(CollapsibleContext)!;
  return <div id={props.id ?? ctx.contentId} data-state={ctx.open() ? 'open' : 'closed'} data-slot="collapsible-content" hidden={!ctx.open()} {...props}>{ctx.open() ? props.children : null}</div>;
}
export function Popover(props: JSX.HTMLAttributes<HTMLSpanElement> & { open?: boolean; defaultOpen?: boolean; onOpenChange?: (value: boolean) => void }) {
  const ctx = makeState(props); return <PopoverContext.Provider value={ctx}>{props.children}</PopoverContext.Provider>;
}
export function PopoverTrigger(props: JSX.ButtonHTMLAttributes<HTMLButtonElement>) {
  const ctx = useContext(PopoverContext)!;
  return <button type="button" aria-haspopup="dialog" aria-expanded={ctx.open()} aria-controls={undefined} data-state={ctx.open() ? 'open' : 'closed'} data-slot="popover-trigger" on:click={() => ctx.setOpen(!ctx.open())} {...props} />;
}
export function PopoverContent(props: JSX.HTMLAttributes<HTMLDivElement> & { align?: string; sideOffset?: number }) {
  // TODO: Portal this overlay through IslandContext.trustedPortal() when the runtime contract lands.
  const ctx = useContext(PopoverContext)!; const { align: _align, sideOffset: _sideOffset, ...rest } = props;
  return ctx.open() ? <div id={props.id ?? ctx.contentId} role="dialog" data-state="open" data-slot="popover-content" data-story-floating="" {...rest} on:keydown={event => { if (event.key === 'Escape') { event.preventDefault(); ctx.setOpen(false); } }} /> : null;
}
export function PopoverAnchor(props: JSX.HTMLAttributes<HTMLDivElement>) { return <div data-slot="popover-anchor" {...props} />; }
export function PopoverHeader(props: JSX.HTMLAttributes<HTMLDivElement>) { return <div data-slot="popover-header" {...props} />; }
export function PopoverTitle(props: JSX.HTMLAttributes<HTMLDivElement>) { return <div data-slot="popover-title" {...props} />; }
export function PopoverDescription(props: JSX.HTMLAttributes<HTMLParagraphElement>) { return <p data-slot="popover-description" {...props} />; }
export function Avatar(props: JSX.HTMLAttributes<HTMLSpanElement> & { size?: string }) { const { size = 'default', ...rest } = props; return <span data-slot="avatar" data-size={size} {...rest} />; }
export function AvatarImage(_props: JSX.ImgHTMLAttributes<HTMLImageElement>) { return null; }
export function AvatarFallback(props: JSX.HTMLAttributes<HTMLSpanElement>) { return <span data-slot="avatar-fallback" {...props} />; }
export function AvatarBadge(props: JSX.HTMLAttributes<HTMLSpanElement>) { return <span data-slot="avatar-badge" {...props} />; }
export function AvatarGroup(props: JSX.HTMLAttributes<HTMLDivElement>) { return <div data-slot="avatar-group" {...props} />; }
export function AvatarGroupCount(props: JSX.HTMLAttributes<HTMLDivElement>) { return <div data-slot="avatar-group-count" {...props} />; }
