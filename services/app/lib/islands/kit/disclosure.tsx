/* @jsxImportSource solid-js */
import { createContext, createEffect, createRenderEffect, createSignal, createUniqueId, onCleanup, onMount, Show, splitProps, useContext, type JSX } from 'solid-js';
import { collapsibleStyle } from './collapsible-style';
import { Portal, isServer } from 'solid-js/web';
import { useIsland } from '../context';
import { deferEngine } from '../defer-engine';
import type { Align, Placed, Side } from './popper';
import { TrustedOverlay, overlayDestination, storyPortalHost } from './trusted-overlay';
import { popupDismiss } from './popup-dismiss';
import { ARROW_ORIGIN, ARROW_TRANSFORM, OPPOSITE, createTooltipTiming } from './tooltip-core';

type State = { open: () => boolean; setOpen: (value: boolean) => void; contentId: string; panelId: () => string; setPanelId: (id: string) => void };
const CollapsibleContext = createContext<State>(); const PopoverContext = createContext<PopupState>();
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
export function CollapsibleContent(props: JSX.HTMLAttributes<HTMLDivElement> & { forceMount?: boolean }) {
  const ctx = useContext(CollapsibleContext)!; let node: HTMLDivElement | undefined;
  if (props.id) ctx.setPanelId(props.id);
  collapsibleStyle(() => node, ctx.open);
  const [local, rest] = splitProps(props, ['forceMount', 'children']);
  return <div ref={node} id={props.id ?? ctx.contentId} data-state={ctx.open() ? 'open' : 'closed'} data-slot="collapsible-content" hidden={!ctx.open()} {...rest}>{local.forceMount || ctx.open() ? local.children : null}</div>;
}
export function Popover(props: JSX.HTMLAttributes<HTMLSpanElement> & { open?: boolean; defaultOpen?: boolean; onOpenChange?: (value: boolean) => void }) {
  const ctx = makeState(props);
  const [trigger, setTrigger] = createSignal<HTMLElement>();
  const [panel, setPanel] = createSignal<HTMLElement>();
  const announce = popupDismiss(ctx.open, () => ctx.setOpen(false), trigger, panel);
  return <PopoverContext.Provider value={{...ctx, trigger, setTrigger, panel, setPanel, announce}}>{props.children}</PopoverContext.Provider>;
}
export function PopoverTrigger(props: JSX.ButtonHTMLAttributes<HTMLButtonElement>) {
  const ctx = useContext(PopoverContext)! as PopupState;
  return <button ref={ctx.setTrigger} type="button" aria-haspopup="dialog" aria-expanded={ctx.open()} aria-controls={undefined} data-state={ctx.open() ? 'open' : 'closed'} data-slot="popover-trigger" on:click={() => { if (!ctx.open()) ctx.announce(); ctx.setOpen(!ctx.open()); }} {...props} />;
}
export function PopoverContent(props: JSX.HTMLAttributes<HTMLDivElement> & { side?: Side; align?: Align; sideOffset?: number; forceMount?: boolean }) {
  const ctx = useContext(PopoverContext)! as PopupState; const island = useIsland();
  const [local, rest] = splitProps(props, ['side', 'align', 'sideOffset', 'forceMount', 'children']);
  const onKeyDown = (event: KeyboardEvent) => { if (event.key === 'Escape') { event.preventDefault(); ctx.setOpen(false); ctx.trigger()?.focus(); } };
  const popper = () => <PopoverPopper ctx={ctx} side={local.side} align={local.align} sideOffset={local.sideOffset}>
    <div ref={ctx.setPanel} id={props.id ?? ctx.contentId} role="dialog" data-state={ctx.open() ? 'open' : 'closed'} data-slot="popover-content" data-story-floating="" {...rest} on:keydown={onKeyDown}>{local.children}</div>
  </PopoverPopper>;
  if (local.forceMount) {
    let holder!: HTMLDivElement;
    onMount(() => {
      const home = document.createComment('popover-home'); holder.before(home);
      createEffect(() => {
        const destination = ctx.open() ? island.trustedPortal() : null;
        if (destination) destination.append(holder);
        else home.parentNode?.insertBefore(holder, home.nextSibling);
      });
      onCleanup(() => home.remove());
    });
    return <div ref={holder} hidden={!ctx.open()}>{popper()}</div>;
  }
  return <Show when={ctx.open()}><TrustedOverlay open={ctx.open}>{popper()}</TrustedOverlay></Show>;
}
/**
 * The popover's placement, as the tooltip's: a fixed wrapper Radix's popper positions against the trigger (bottom,
 * centred, 4px off, 8px from the edges). Until placed it waits off-screen, so it never flashes at the viewport's corner.
 */
function PopoverPopper(p: { ctx: PopupState; side?: Side; align?: Align; sideOffset?: number; children?: JSX.Element }) {
  const ctx = p.ctx; const [wrapper, setWrapper] = createSignal<HTMLDivElement>(); const [placed, setPlaced] = createSignal<Placed>();
  // Placement waits on all three (the open state, the trigger, its own element) as signals, whichever arrives last:
  // a press can land while the page is still taking over, before the trigger's ref has run.
  createEffect(() => {
    const element = wrapper(); const anchor = ctx.trigger();
    if (!ctx.open() || !element || !anchor) return;
    let live = true; let stop = () => {};
    // Opened by a press, so placed at once (no deferral): the lazy popper chunk is the only wait.
    void import('./popper').then(({ placePopper }) => {
      if (!live) return;
      stop = placePopper(anchor, element, null, { side: p.side ?? 'bottom', align: p.align ?? 'center', sideOffset: p.sideOffset ?? 4, collisionPadding: 8, arrowWidth: 0, arrowHeight: 0, onPlaced: setPlaced });
    });
    onCleanup(() => { live = false; stop(); setPlaced(undefined); });
  });
  createEffect(() => { const side = placed()?.side; const align = placed()?.align; const content = wrapper()?.firstElementChild; if (!content) return; if (side) { content.setAttribute('data-side', side); content.setAttribute('data-align', align ?? 'center'); } else { content.removeAttribute('data-side'); content.removeAttribute('data-align'); } });
  return <div ref={setWrapper} data-radix-popper-content-wrapper="" style={{ position: 'fixed', left: '0px', top: '0px', transform: 'translate(0, -200%)', 'min-width': 'max-content' }}>{p.children}</div>;
}
type PopupState = State & { trigger: () => HTMLElement | undefined; setTrigger: (el: HTMLElement) => void; panel: () => HTMLElement | undefined; setPanel: (el: HTMLElement) => void; announce: () => void };
/**
 * TOOLTIP — the former story tooltip: the trigger is the popper
 * anchor (no `type`, `data-state` closed / delayed-open / instant-open, described by the content while open,
 * the placed side/align once placed); the content is portaled out of the document — to the trusted portal when
 * the page has one, else the body, as Radix's Portal does — inside a theme host, placed by Radix's popper
 * (./popper: top, 6px off, 8px from the edges) with its arrow. Opens on hover after the provider's delay
 * (300ms; at once within 100ms of another closing), on focus at once; closes on leave, blur, press, Escape,
 * a scroll that moves the trigger, and another tooltip opening.
 */
type TooltipState = {
  open: () => boolean; state: () => 'closed' | 'delayed-open' | 'instant-open'; contentId: () => string; setContentId: (id: string | undefined) => void;
  trigger: () => HTMLElement | undefined; setTrigger: (el: HTMLElement) => void; placed: () => Placed | undefined; setPlaced: (placed: Placed | undefined) => void;
  enter: () => void; leave: () => void; openNow: () => void; close: () => void;
};
const TooltipContext = createContext<TooltipState>();
export function Tooltip(props: { open?: boolean; defaultOpen?: boolean; onOpenChange?: (value: boolean) => void; delayDuration?: number; children?: JSX.Element }) {
  const [local, setLocal] = createSignal(!!props.defaultOpen);
  const generated = createUniqueId(); const [authoredId, setContentId] = createSignal<string | undefined>();
  const [trigger, setTrigger] = createSignal<HTMLElement>(); const [placed, setPlaced] = createSignal<Placed>();
  const open = () => props.open ?? local();
  const timing = createTooltipTiming({ open, setOpen: value => { setLocal(value); props.onOpenChange?.(value); }, delay: () => props.delayDuration });
  const ctx: TooltipState = { open, state: timing.state, contentId: () => authoredId() ?? generated, setContentId,
    trigger, setTrigger, placed, setPlaced, enter: timing.enter, leave: timing.close, openNow: timing.openNow, close: timing.close };
  return <TooltipContext.Provider value={ctx}>{props.children}</TooltipContext.Provider>;
}
export function TooltipProvider(props: { children?: JSX.Element }) { return props.children; }
export function TooltipTrigger(props: JSX.ButtonHTMLAttributes<HTMLButtonElement>) {
  const ctx = useContext(TooltipContext)!; let pointerDown = false; let movedOpen = false; let button!: HTMLButtonElement;
  // While hydrating Solid leaves served attributes alone; the content's id and the placement arrive after, so once
  // live these follow the state as Radix's re-renders do.
  onMount(() => createEffect(() => {
    const described = ctx.open() ? ctx.contentId() : null; const placed = ctx.placed();
    for (const [name, value] of [['aria-describedby', described], ['data-state', ctx.state()], ['data-radix-popper-side', placed?.side], ['data-radix-popper-align', placed?.align]] as const) {
      if (value) button.setAttribute(name, value); else button.removeAttribute(name);
    }
  }));
  return <button ref={el => { button = el; ctx.setTrigger(el); }} aria-describedby={ctx.open() ? ctx.contentId() : undefined} data-state={ctx.state()} data-slot="tooltip-trigger"
    data-radix-popper-side={ctx.placed()?.side} data-radix-popper-align={ctx.placed()?.align} {...props}
    on:pointermove={e => { if (e.pointerType === 'touch') return; if (!movedOpen) { ctx.enter(); movedOpen = true; } }}
    on:pointerleave={() => { ctx.leave(); movedOpen = false; }}
    on:pointerdown={() => { if (ctx.open()) ctx.close(); pointerDown = true; document.addEventListener('pointerup', () => { pointerDown = false; }, { once: true }); }}
    on:focus={() => { if (!pointerDown) ctx.openNow(); }} on:blur={() => ctx.close()} on:click={() => ctx.close()}>{props.children}</button>;
}
/** A disabled editing control needs a focusable span as its tooltip anchor. */
export function TooltipSpanTrigger(props: JSX.HTMLAttributes<HTMLSpanElement>) {
  const ctx = useContext(TooltipContext)!; let span!: HTMLSpanElement; let movedOpen = false;
  onMount(() => createEffect(() => {
    for (const [name, value] of [['aria-describedby', ctx.open() ? ctx.contentId() : null], ['data-state', ctx.state()], ['data-radix-popper-side', ctx.placed()?.side], ['data-radix-popper-align', ctx.placed()?.align]] as const) {
      if (value) span.setAttribute(name, value); else span.removeAttribute(name);
    }
  }));
  return <span ref={el => { span = el; ctx.setTrigger(el); }} data-state={ctx.state()} data-slot="tooltip-trigger" {...props}
    on:pointermove={e => { if (e.pointerType !== 'touch' && !movedOpen) { ctx.enter(); movedOpen = true; } }} on:pointerleave={() => { ctx.leave(); movedOpen = false; }}
    on:focus={() => ctx.openNow()} on:blur={() => ctx.close()} on:click={() => ctx.openNow()}>{props.children}</span>;
}
export function TooltipContent(props: JSX.HTMLAttributes<HTMLDivElement> & { side?: Side; align?: Align; sideOffset?: number; forceMount?: boolean }) {
  const ctx = useContext(TooltipContext)!; const island = useIsland();
  const [local, rest] = splitProps(props, ['id', 'children', 'side', 'align', 'sideOffset', 'forceMount']);
  // Radix: an authored id is the content's id, and so what the trigger names.
  createRenderEffect(() => ctx.setContentId(local.id));
  onMount(() => {
    // Escape and another tooltip opening close it through the shared timing (./tooltip-core).
    const onScroll = (e: Event) => { const t = ctx.trigger(); if (t && e.target instanceof Node && e.target.contains(t)) ctx.close(); };
    window.addEventListener('scroll', onScroll, { capture: true });
    onCleanup(() => window.removeEventListener('scroll', onScroll, { capture: true }));
  });
  if (local.forceMount) {
    let holder!: HTMLDivElement;
    onMount(() => {
      const home = document.createComment('tooltip-home'); holder.before(home);
      createEffect(() => {
        const destination = ctx.open() ? island.trustedPortal() ?? document.body : null;
        if (destination) destination.append(holder);
        else home.parentNode?.insertBefore(holder, home.nextSibling);
      });
      onCleanup(() => home.remove());
    });
    return <div ref={holder} hidden={!ctx.open()}><TooltipPopper ctx={ctx} side={local.side} align={local.align} sideOffset={local.sideOffset} rest={rest}>{local.children}</TooltipPopper></div>;
  }
  return <Show when={ctx.open() && !isServer}>
    <Portal mount={overlayDestination(island) ?? document.body}>{storyPortalHost(<TooltipPopper ctx={ctx} side={local.side} align={local.align} sideOffset={local.sideOffset} rest={rest}>{local.children}</TooltipPopper>)}</Portal>
  </Show>;
}
/** The portaled content: placed once ITS OWN elements exist (a portal renders after hydration, so never from the owner's mount). */
function TooltipPopper(p: { ctx: TooltipState; side?: Side; align?: Align; sideOffset?: number; rest: JSX.HTMLAttributes<HTMLDivElement>; children?: JSX.Element }) {
  const ctx = p.ctx; let wrapper!: HTMLDivElement; let content!: HTMLDivElement; let arrow!: HTMLSpanElement;
  onMount(() => createEffect(() => {
    if (!ctx.open()) return;
    const anchor = ctx.trigger(); if (!anchor) return;
    wrapper.style.zIndex = getComputedStyle(content).zIndex;
    let live = true;
    let stop = () => {};
    const cancel = deferEngine(wrapper, () => { void import('./popper').then(({ placePopper }) => {
      if (!live) return;
      stop = placePopper(anchor, wrapper, arrow, { side: p.side ?? 'top', align: p.align ?? 'center', sideOffset: p.sideOffset ?? 6, collisionPadding: 8, arrowWidth: 10, arrowHeight: 5, onPlaced: ctx.setPlaced });
    }); });
    onCleanup(() => { live = false; cancel(); stop(); ctx.setPlaced(undefined); });
  }));
  const side = () => ctx.placed()?.side ?? 'top';
  return <div data-mx-theme-host="">
    <div ref={wrapper} data-radix-popper-content-wrapper="" style={{ position: 'fixed', left: '0px', top: '0px', transform: 'translate(0, -200%)', 'min-width': 'max-content' }}>
      <div ref={content} data-side={ctx.placed()?.side} data-align={ctx.placed()?.align} data-state={ctx.state()} role="tooltip" id={ctx.contentId()} data-slot="tooltip-content" data-story-floating="" {...p.rest}
        style={{ '--radix-tooltip-content-transform-origin': 'var(--radix-popper-transform-origin)', '--radix-tooltip-content-available-width': 'var(--radix-popper-available-width)', '--radix-tooltip-content-available-height': 'var(--radix-popper-available-height)', '--radix-tooltip-trigger-width': 'var(--radix-popper-anchor-width)', '--radix-tooltip-trigger-height': 'var(--radix-popper-anchor-height)', ...(ctx.placed() ? {} : { animation: 'none' }) }}>
        {p.children}
        <span ref={arrow} style={{ position: 'absolute', ...(ctx.placed()?.arrowX !== undefined ? { left: `${ctx.placed()!.arrowX}px` } : {}), ...(ctx.placed()?.arrowY !== undefined ? { top: `${ctx.placed()!.arrowY}px` } : {}), [OPPOSITE[side()]]: '0px', 'transform-origin': ARROW_ORIGIN[side()] || undefined, transform: ARROW_TRANSFORM[side()], ...(ctx.placed()?.hideArrow ? { visibility: 'hidden' } : {}) }}>
          <svg stroke="var(--color-edge-bright)" stroke-width="1" stroke-linejoin="round" class="z-[100] fill-surface" width="10" height="5" viewBox="0 0 30 10" preserveAspectRatio="none" style="display: block;"><polygon points="0,0 30,0 15,10" /></svg>
        </span>
      </div>
    </div>
  </div>;
}
export function PopoverAnchor(props: JSX.HTMLAttributes<HTMLDivElement>) { return <div data-slot="popover-anchor" {...props} />; }
export function PopoverHeader(props: JSX.HTMLAttributes<HTMLDivElement>) { return <div data-slot="popover-header" {...props} />; }
export function PopoverTitle(props: JSX.HTMLAttributes<HTMLDivElement>) { return <div data-slot="popover-title" {...props} />; }
export function PopoverDescription(props: JSX.HTMLAttributes<HTMLParagraphElement>) { return <p data-slot="popover-description" {...props} />; }
/**
 * Radix Avatar: the image is drawn only once the browser has loaded it (a detached `Image` probes the
 * address); until then — and for an address that fails — the fallback shows. The served markup is the
 * fallback, as the former server render is.
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

/** Reuses the reader tooltip; the stable anchor keeps disabled controls reachable by keyboard and touch. */
export function MutationHint(props: { reason: string | null; fullWidth?: boolean; children: JSX.Element }) {
  return <Tooltip open={props.reason ? undefined : false}>
    <TooltipSpanTrigger class={props.fullWidth ? 'inline-flex w-full' : 'inline-flex'} tabindex={props.reason ? '0' : undefined} aria-description={props.reason ?? undefined}>
      <span style={{ display: 'contents', 'pointer-events': props.reason ? 'none' : undefined }}>{props.children}</span>
    </TooltipSpanTrigger>
    <TooltipContent class="pointer-events-none z-[100] w-max max-w-[min(28rem,calc(100vw-1rem))] whitespace-normal rounded-md bg-foreground px-2.5 py-1.5 text-left text-xs leading-normal text-background shadow-md">{props.reason}</TooltipContent>
  </Tooltip>;
}
