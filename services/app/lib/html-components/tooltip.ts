/**
 * <af-tooltip>: hover/focus tooltip.
 * Usage: import '@afbin/tooltip';  (registers the tags; this .ts is the readable contract)
 * Props: open (boolean property or attribute), default-open, delay-duration (ms, default 300).
 *   Children: af-tooltip-trigger (use a native button inside), af-tooltip-content (side, align,
 *   side-offset). Optional af-tooltip-provider wrapper: delay-duration (300) and
 *   skip-delay-duration (100, reopen without delay right after another tooltip closed).
 * Events: af-change (bubbles, cancelable) with event.detail.value; reflect your Apollo value
 *   back for controlled use.
 * Examples:
 *   <af-tooltip><af-tooltip-trigger><button>?</button></af-tooltip-trigger>
 *   <af-tooltip-content>Help</af-tooltip-content></af-tooltip>
 * Gotchas: a trigger without an interactive child gets a generated button (yours keep their
 *   identity). Touch pointers do not open it; focus does. Escape / outside press close only the
 *   topmost floating layer. Opening one tooltip closes the others. The content is a manual
 *   popover and is described via aria-describedby on the trigger.
 */
import { registerComponent, type ComponentDescriptor } from './register-component';
import {floatingVisibility,identifyFloating,positionFloating,
  topFloating} from './floating-position';
import {AfTooltipContent,AfTooltipProvider,AfTooltipTrigger,addDescribedBy,applyWrapperTab,
  arrowPoint,duration,interactiveTrigger,removeDescribedBy,tooltipStyles} from './tooltip-model';
import type {TooltipChangeDetail,TooltipClock,TooltipContract} from './tooltip-model';
export type {TooltipChangeDetail,TooltipClock,TooltipContract,TooltipProviderContract,
  TooltipTriggerContract} from './tooltip-model';
export {AfTooltipContent,AfTooltipProvider,AfTooltipTrigger,tooltipStyles};
// Last close time per provider (or document), for the skip-delay window.
const closedAt = new WeakMap<Node,number>();
const tooltipSideOffset = 6;
const tooltipArrowHeight = 5;
/** Keyboard-accessible help with a hoverable content region and a short exit grace period. */
export class AfTooltip extends HTMLElement implements TooltipContract {
 static observedAttributes = ['open'];
clock: TooltipClock = {setTimeout:(fn,delay) => window.setTimeout(fn,delay),clearTimeout:id =>
   window.clearTimeout(id)};
 private local = false;
 private supplied: boolean | undefined;
 private initialized = false;
 private visible = false;
 private timer: number | undefined;
 private hovered = false;
 private panel: HTMLElement | undefined;
 private descriptionTarget: HTMLElement | undefined;
 private descriptionId: string | undefined;
 private descriptionAdded = false;
 private wrapperTabs = new WeakMap<HTMLElement,string|null>();
 private observer = new MutationObserver(() => this.sync());
 private resizeObserver: ResizeObserver | undefined;
 get open(): boolean { return this.supplied ?? (this.hasAttribute('open') || this.local); }
set open(value: boolean | undefined) { if (value === undefined) this.local = this.open;
   this.supplied = value; this.sync(); }
 connectedCallback(): void {
if (Object.prototype.hasOwnProperty.call(this,'open')) { const value = this.open; delete (this as {
    open?:boolean}).open; this.open = value; }
  if (!this.initialized) { this.local = this.hasAttribute('default-open');
    this.initialized = true; }
this.addEventListener('pointerover',this.enter); this.addEventListener('pointerout',this.leave);
    this.addEventListener('focusin',this.focusin); this.addEventListener('focusout',this.focusout);
    this.addEventListener('click',this.press);
this.ownerDocument.addEventListener('keydown',this.escape); this.ownerDocument.addEventListener(
    'pointerdown',this.outside);
  this.ownerDocument.addEventListener('af-floating-activated',this.other);
this.ownerDocument.addEventListener('scroll',this.onScroll,true);
    this.ownerDocument.defaultView?.addEventListener('resize',this.position);
this.observer.observe(this,{childList:true,subtree:true,attributes:true,attributeFilter:['id',
    'disabled','side','align','side-offset']}); this.sync();
 }
 disconnectedCallback(): void {
this.clear(); this.hovered = false; this.observer.disconnect(); this.resizeObserver?.disconnect();
    this.resizeObserver = undefined;
this.removeEventListener('pointerover',this.enter); this.removeEventListener('pointerout',
    this.leave); this.removeEventListener('focusin',this.focusin); this.removeEventListener(
    'focusout',this.focusout); this.removeEventListener('click',this.press);
this.ownerDocument.removeEventListener('keydown',this.escape);
    this.ownerDocument.removeEventListener('pointerdown',this.outside);
  this.ownerDocument.removeEventListener('af-floating-activated',this.other);
this.ownerDocument.removeEventListener('scroll',this.onScroll,true);
    this.ownerDocument.defaultView?.removeEventListener('resize',this.position);
this.hidePanel(); this.describe(undefined,undefined); floatingVisibility(this,false); this.visible =
    false;
 }
 attributeChangedCallback(): void { this.sync(); }
private own(tag: string): HTMLElement[] { return [...this.querySelectorAll<HTMLElement>(
   tag)].filter(n => n.closest('af-tooltip') === this); }
private trigger(): HTMLElement | undefined { const wrapper = this.own('af-tooltip-trigger')[0];
   return wrapper?.querySelector<HTMLElement>(interactiveTrigger) ?? wrapper; }
private disabled(): boolean { const trigger = this.trigger(); return !trigger || trigger.matches(
   ':disabled,[disabled],[aria-disabled="true"]') || !!trigger.closest(
   'af-tooltip-trigger[disabled]'); }
private clear(): void { if(this.timer !== undefined) this.clock.clearTimeout(this.timer);
   this.timer = undefined; }
 private request(value: boolean): void {
  this.clear(); if(value === this.open) return;
if(this.dispatchEvent(new CustomEvent<TooltipChangeDetail>('af-change',{detail:{value},bubbles:true,
    composed:true,cancelable:true})) && this.supplied === undefined && !this.hasAttribute(
    'open')) this.local = value;
  this.sync();
 }
private relevant(event: Event): boolean { return event.target instanceof Element &&
   event.target.closest('af-tooltip') === this; }
 private enter = (event: PointerEvent): void => {
  if(!this.relevant(event) || event.pointerType === 'touch' || this.disabled()) return;
  this.hovered = true;
if(event.relatedTarget instanceof Node && this.contains(event.relatedTarget)) { this.clear();
    return; }
  this.clear(); if(this.open) return;
const provider = this.closest<AfTooltipProvider>('af-tooltip-provider'); const scope = provider ??
    this.ownerDocument;
  const sinceClose = (this.clock.now?.() ?? Date.now()) - (closedAt.get(scope) ?? -Infinity);
if(sinceClose >= 0 && sinceClose < (provider?.skipDelayDuration ?? 100)) { this.request(true);
    return; }
  const delay = duration(this.getAttribute('delay-duration'),provider?.delayDuration ?? 300);
this.timer = this.clock.setTimeout(() => { this.timer = undefined; if(this.isConnected &&
    !this.disabled()) this.request(true); },delay);
 };
 private leave = (event: PointerEvent): void => {
  if(!this.relevant(event)) return;
if(event.relatedTarget instanceof Node && this.contains(event.relatedTarget)) { this.clear();
    return; }
  this.hovered = false;
  this.clear(); if(this.contains(this.ownerDocument.activeElement)) return;
  this.timer = this.clock.setTimeout(() => this.request(false),100);
 };
private focusin = (event: FocusEvent): void => { if(this.relevant(event) && !this.disabled(
   )) this.request(true); };
private focusout = (event: FocusEvent): void => { if(this.relevant(event) && !this.hovered && !(
   event.relatedTarget instanceof Node && this.contains(event.relatedTarget))) this.request(false);
   };
private press = (event: Event): void => { if(this.relevant(event) &&
   !event.defaultPrevented) this.request(false); };
private outside = (event: Event): void => { if(this.open && topFloating(this) &&
   !event.defaultPrevented && !event.composedPath().includes(this)) this.request(false); };
private escape = (event: KeyboardEvent): void => { if(this.open && topFloating(this) &&
   event.key === 'Escape' && !event.defaultPrevented) { event.preventDefault(); this.request(false);
   } };
private other = (event: Event): void => { const node = (event as CustomEvent<HTMLElement>).detail;
   if(this.open && node instanceof HTMLElement && node.localName === this.localName &&
   node !== this && !this.contains(node) && !node.contains(this)) this.request(false); };
private onScroll = (event: Event): void => { const trigger = this.trigger(); if(this.open &&
   trigger && event.target instanceof Node && event.target.contains(trigger)) this.request(false);
   };
 private position = (): void => {
  const trigger = this.trigger(); if(!this.open || !trigger || !this.panel) return;
  // Source Popper's sideOffset is measured from the arrow tip, so the arrow
  // height is added to the requested gap before positioning the panel.
  positionFloating(trigger,this.panel,'top',tooltipSideOffset+tooltipArrowHeight);
  const {x, y} = arrowPoint(trigger.getBoundingClientRect(),this.panel.getBoundingClientRect(),
    this.panel.dataset.side);
this.panel.style.setProperty('--af-tooltip-arrow-left',`${x}px`); this.panel.style.setProperty(
    '--af-tooltip-arrow-top',`${y}px`);
 };
private hidePanel(): void { if(this.panel && typeof this.panel.hidePopover === 'function' &&
   this.panel.matches(':popover-open')) this.panel.hidePopover(); }
 private describe(target: HTMLElement | undefined, id: string | undefined): void {
  // Only remove an id this tooltip added, never one the author wrote.
  if(this.descriptionTarget && this.descriptionId && this.descriptionAdded) removeDescribedBy(
    this.descriptionTarget,this.descriptionId);
  this.descriptionAdded = target && id ? addDescribedBy(target,id) : false;
  this.descriptionTarget = target; this.descriptionId = id;
 }
 private sync(): void {
  if(!this.isConnected) return;
  const panel = this.own('af-tooltip-content')[0];
  if(this.panel !== panel) {
   this.hidePanel(); this.resizeObserver?.disconnect(); this.panel = panel;
if(typeof ResizeObserver !== 'undefined') { this.resizeObserver = new ResizeObserver(this.position);
     if(panel) this.resizeObserver.observe(panel); const trigger = this.trigger(); if(
     trigger) this.resizeObserver.observe(trigger); }
  }
  const trigger = this.trigger(); const wrapper = this.own('af-tooltip-trigger')[0];
  if(wrapper) {
   if(!this.wrapperTabs.has(wrapper)) this.wrapperTabs.set(wrapper,
     wrapper.getAttribute('tabindex'));
   applyWrapperTab(wrapper,trigger === wrapper,this.wrapperTabs.get(wrapper) ?? null);
  }
  if(panel) {
identifyFloating(panel); panel.setAttribute('role','tooltip'); panel.hidden = !this.open;
     panel.toggleAttribute('inert',!this.open); panel.dataset.state = this.open ? 'open' : 'closed';
if(typeof panel.showPopover === 'function') { panel.setAttribute('popover','manual'); if(
     this.open && !panel.matches(':popover-open')) panel.showPopover(); else if(
     !this.open) this.hidePanel(); }
  }
  this.describe(this.open ? trigger : undefined,this.open ? panel?.id : undefined);
  this.dataset.state = this.open ? 'open' : 'closed';
  const visible = this.open && !!panel;
if(visible !== this.visible) { this.visible = visible; if(!visible) closedAt.set(this.closest(
    'af-tooltip-provider') ?? this.ownerDocument,this.clock.now?.() ?? Date.now());
    floatingVisibility(this,this.visible); }
  this.position();
 }
}
/** Registration descriptor (tags + stylesheet) applied on import; exported for tests. */
export const tooltipComponent: ComponentDescriptor = {
  styleKey: 'af-tooltip-styles', styles: tooltipStyles,
  elements: {'af-tooltip': AfTooltip, 'af-tooltip-provider': AfTooltipProvider,
    'af-tooltip-trigger': AfTooltipTrigger, 'af-tooltip-content': AfTooltipContent},
};
registerComponent(tooltipComponent);
