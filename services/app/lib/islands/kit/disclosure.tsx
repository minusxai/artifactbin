/* @jsxImportSource solid-js */
import { createContext, createEffect, createSignal, createUniqueId, onCleanup, onMount, Show, splitProps, useContext, type JSX } from 'solid-js';
import { collapsibleStyle } from './collapsible-style';
import { TrustedOverlay } from './trusted-overlay';

type State = { open: () => boolean; setOpen: (value: boolean) => void; contentId: string; panelId: () => string; setPanelId: (id: string) => void };
const CollapsibleContext = createContext<State>(); const PopoverContext = createContext<State>();
function makeState(props: { open?: boolean; defaultOpen?: boolean; onOpenChange?: (value: boolean) => void }): State {
  const [local, setLocal] = createSignal(!!props.defaultOpen); const contentId = createUniqueId(); const [panelId, setPanelId] = createSignal(contentId);
  return { open: () => props.open ?? local(), setOpen: value => { setLocal(value); props.onOpenChange?.(value); }, contentId, panelId, setPanelId };
}
export function Collapsible(props: JSX.HTMLAttributes<HTMLDivElement> & { open?: boolean; defaultOpen?: boolean; disabled?: boolean; onOpenChange?: (value: boolean) => void }) {
  const ctx = makeState(props); const [localProps, rest] = splitProps(props, ['open', 'defaultOpen', 'disabled', 'onOpenChange', 'children']);
  return <CollapsibleContext.Provider value={ctx}><div data-slot="collapsible" data-state={ctx.open() ? 'open' : 'closed'} {...rest}>{localProps.children}</div></CollapsibleContext.Provider>;
}
export function CollapsibleTrigger(props: JSX.ButtonHTMLAttributes<HTMLButtonElement>) {
  const ctx = useContext(CollapsibleContext)!; let button!: HTMLButtonElement;
  // Radix names the open content (its own id, which an author's id replaces, leaving it dangling); this names
  // the real one — set once the page is live, since the content registers its id after this rendered.
  onMount(() => createEffect(() => { const id = ctx.open() ? ctx.panelId() : null; if (id) button.setAttribute('aria-controls', id); else button.removeAttribute('aria-controls'); }));
  return <button ref={button} type="button" aria-controls={ctx.open() ? ctx.panelId() : undefined} aria-expanded={ctx.open()} data-state={ctx.open() ? 'open' : 'closed'} data-slot="collapsible-trigger" on:click={() => ctx.setOpen(!ctx.open())} {...props} />;
}
export function CollapsibleContent(props: JSX.HTMLAttributes<HTMLDivElement>) {
  const ctx = useContext(CollapsibleContext)!; let node: HTMLDivElement | undefined;
  if (props.id) ctx.setPanelId(props.id);
  collapsibleStyle(() => node, ctx.open);
  return <div ref={node} id={props.id ?? ctx.contentId} data-state={ctx.open() ? 'open' : 'closed'} data-slot="collapsible-content" hidden={!ctx.open()} {...props}>{ctx.open() ? props.children : null}</div>;
}
export function Popover(props: JSX.HTMLAttributes<HTMLSpanElement> & { open?: boolean; defaultOpen?: boolean; onOpenChange?: (value: boolean) => void }) {
  const ctx = makeState(props); return <PopoverContext.Provider value={ctx}>{props.children}</PopoverContext.Provider>;
}
export function PopoverTrigger(props: JSX.ButtonHTMLAttributes<HTMLButtonElement>) {
  const ctx = useContext(PopoverContext)!;
  return <button type="button" aria-haspopup="dialog" aria-expanded={ctx.open()} aria-controls={undefined} data-state={ctx.open() ? 'open' : 'closed'} data-slot="popover-trigger" on:click={() => ctx.setOpen(!ctx.open())} {...props} />;
}
export function PopoverContent(props: JSX.HTMLAttributes<HTMLDivElement> & { align?: string; sideOffset?: number }) {
  const ctx = useContext(PopoverContext)!; const { align: _align, sideOffset: _sideOffset, ...rest } = props;
  return <Show when={ctx.open()}><TrustedOverlay open={ctx.open}><div id={props.id ?? ctx.contentId} role="dialog" data-state="open" data-slot="popover-content" data-story-floating="" {...rest} on:keydown={event => { if (event.key === 'Escape') { event.preventDefault(); ctx.setOpen(false); } }}>{props.children}</div></TrustedOverlay></Show>;
}
const TooltipContext = createContext<State>();
export function Tooltip(props: { open?: boolean; defaultOpen?: boolean; onOpenChange?: (value: boolean) => void; children?: JSX.Element }) {
  const ctx = makeState(props);
  return <TooltipContext.Provider value={ctx}>{props.children}</TooltipContext.Provider>;
}
export function TooltipProvider(props: { children?: JSX.Element }) { return props.children; }
export function TooltipTrigger(props: JSX.ButtonHTMLAttributes<HTMLButtonElement>) {
  const ctx = useContext(TooltipContext)!;
  return <button type="button" data-slot="tooltip-trigger" aria-describedby={ctx.open() ? ctx.contentId : undefined} on:mouseenter={() => ctx.setOpen(true)} on:mouseleave={() => ctx.setOpen(false)} on:focus={() => ctx.setOpen(true)} on:blur={() => ctx.setOpen(false)} {...props}>{props.children}</button>;
}
export function TooltipContent(props: JSX.HTMLAttributes<HTMLDivElement>) {
  const ctx = useContext(TooltipContext)!;
  return <Show when={ctx.open()}><TrustedOverlay open={ctx.open}><div id={props.id ?? ctx.contentId} role="tooltip" data-state="delayed-open" data-slot="tooltip-content" data-story-floating="" {...props}>{props.children}</div></TrustedOverlay></Show>;
}
export function PopoverAnchor(props: JSX.HTMLAttributes<HTMLDivElement>) { return <div data-slot="popover-anchor" {...props} />; }
export function PopoverHeader(props: JSX.HTMLAttributes<HTMLDivElement>) { return <div data-slot="popover-header" {...props} />; }
export function PopoverTitle(props: JSX.HTMLAttributes<HTMLDivElement>) { return <div data-slot="popover-title" {...props} />; }
export function PopoverDescription(props: JSX.HTMLAttributes<HTMLParagraphElement>) { return <p data-slot="popover-description" {...props} />; }
/**
 * Radix Avatar: the image is drawn only once the browser has loaded it (a detached `Image` probes the
 * address); until then — and for an address that fails — the fallback shows. The served markup is the
 * fallback, as today's server render is.
 */
type ImageStatus = 'idle' | 'loading' | 'loaded' | 'error';
const AvatarContext = createContext<{ status: () => ImageStatus; setStatus: (status: ImageStatus) => void }>();
export function Avatar(props: JSX.HTMLAttributes<HTMLSpanElement> & { size?: string }) {
  // splitProps, not destructuring: the children must be created INSIDE the provider.
  const [local, rest] = splitProps(props, ['size']); const [status, setStatus] = createSignal<ImageStatus>('idle');
  return <AvatarContext.Provider value={{ status, setStatus }}><span data-slot="avatar" data-size={local.size ?? 'default'} {...rest} /></AvatarContext.Provider>;
}
const imageStatus = (image: HTMLImageElement): ImageStatus => image.complete ? image.naturalWidth > 0 ? 'loaded' : 'error' : 'loading';
export function AvatarImage(props: JSX.ImgHTMLAttributes<HTMLImageElement>) {
  const ctx = useContext(AvatarContext);
  onMount(() => {
    if (!ctx) return;
    const src = props.src;
    if (!src) { ctx.setStatus('error'); return; }
    const image = new window.Image();
    const load = () => ctx.setStatus(imageStatus(image)); const fail = () => ctx.setStatus('error');
    image.addEventListener('load', load); image.addEventListener('error', fail);
    if (props.referrerPolicy) image.referrerPolicy = props.referrerPolicy;
    image.crossOrigin = (props.crossOrigin as string | undefined) ?? null;
    image.src = src;
    ctx.setStatus(imageStatus(image));
    onCleanup(() => { image.removeEventListener('load', load); image.removeEventListener('error', fail); ctx.setStatus('idle'); });
  });
  return <Show when={ctx?.status() === 'loaded'}><img data-slot="avatar-image" {...props} /></Show>;
}
export function AvatarFallback(props: JSX.HTMLAttributes<HTMLSpanElement>) {
  const ctx = useContext(AvatarContext);
  return <Show when={ctx?.status() !== 'loaded'}><span data-slot="avatar-fallback" {...props} /></Show>;
}
export function AvatarBadge(props: JSX.HTMLAttributes<HTMLSpanElement>) { return <span data-slot="avatar-badge" {...props} />; }
export function AvatarGroup(props: JSX.HTMLAttributes<HTMLDivElement>) { return <div data-slot="avatar-group" {...props} />; }
export function AvatarGroupCount(props: JSX.HTMLAttributes<HTMLDivElement>) { return <div data-slot="avatar-group-count" {...props} />; }
