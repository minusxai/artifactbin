import {floatingVisibility,identifyFloating,positionFloating,topFloating} from './floating-position';
export interface TooltipChangeDetail { value: boolean }
export interface TooltipContract { open: boolean | undefined }
export interface TooltipClock { setTimeout(callback: () => void, delay: number): number; clearTimeout(id: number): void }
/** Keyboard-accessible help with a hoverable content region and a short exit grace period. */
export class AfTooltip extends HTMLElement implements TooltipContract {
 static observedAttributes = ['open'];
 clock: TooltipClock = {setTimeout:(fn,delay) => window.setTimeout(fn,delay),clearTimeout:id => window.clearTimeout(id)};
 private local = false;
 private supplied: boolean | undefined;
 private initialized = false;
 private visible = false;
 private timer: number | undefined;
 private panel: HTMLElement | undefined;
 private descriptionTarget: HTMLElement | undefined;
 private descriptionId: string | undefined;
 private descriptionAdded = false;
 private wrapperTabs = new WeakMap<HTMLElement,string|null>();
 private observer = new MutationObserver(() => this.sync());
 private resizeObserver: ResizeObserver | undefined;
 get open(): boolean { return this.supplied ?? (this.hasAttribute('open') || this.local); }
 set open(value: boolean | undefined) { if (value === undefined) this.local = this.open; this.supplied = value; this.sync(); }
 connectedCallback(): void {
  if (Object.prototype.hasOwnProperty.call(this,'open')) { const value = this.open; delete (this as {open?:boolean}).open; this.open = value; }
  if (!this.initialized) { this.local = this.hasAttribute('default-open'); this.initialized = true; }
  this.addEventListener('pointerover',this.enter); this.addEventListener('pointerout',this.leave); this.addEventListener('focusin',this.focusin); this.addEventListener('focusout',this.focusout); this.addEventListener('click',this.press);
  this.ownerDocument.addEventListener('keydown',this.escape); this.ownerDocument.addEventListener('pointerdown',this.outside);
  this.ownerDocument.addEventListener('af-floating-activated',this.other);
  this.ownerDocument.addEventListener('scroll',this.onScroll,true); this.ownerDocument.defaultView?.addEventListener('resize',this.position);
  this.observer.observe(this,{childList:true,subtree:true,attributes:true,attributeFilter:['id','disabled','side','align','side-offset']}); this.sync();
 }
 disconnectedCallback(): void {
  this.clear(); this.observer.disconnect(); this.resizeObserver?.disconnect(); this.resizeObserver = undefined;
  this.removeEventListener('pointerover',this.enter); this.removeEventListener('pointerout',this.leave); this.removeEventListener('focusin',this.focusin); this.removeEventListener('focusout',this.focusout); this.removeEventListener('click',this.press);
  this.ownerDocument.removeEventListener('keydown',this.escape); this.ownerDocument.removeEventListener('pointerdown',this.outside);
  this.ownerDocument.removeEventListener('af-floating-activated',this.other);
  this.ownerDocument.removeEventListener('scroll',this.onScroll,true); this.ownerDocument.defaultView?.removeEventListener('resize',this.position);
  this.hidePanel(); this.describe(undefined,undefined); floatingVisibility(this,false); this.visible = false;
 }
 attributeChangedCallback(): void { this.sync(); }
 private own(tag: string): HTMLElement[] { return [...this.querySelectorAll<HTMLElement>(tag)].filter(n => n.closest('af-tooltip') === this); }
 private trigger(): HTMLElement | undefined { const wrapper = this.own('af-tooltip-trigger')[0]; return wrapper?.querySelector<HTMLElement>('button,a[href],input,select,textarea') ?? wrapper; }
 private disabled(): boolean { const trigger = this.trigger(); return !trigger || trigger.matches(':disabled,[disabled],[aria-disabled="true"]') || !!trigger.closest('af-tooltip-trigger[disabled]'); }
 private clear(): void { if(this.timer !== undefined) this.clock.clearTimeout(this.timer); this.timer = undefined; }
 private request(value: boolean): void {
  this.clear(); if(value === this.open) return;
  if(this.dispatchEvent(new CustomEvent<TooltipChangeDetail>('af-change',{detail:{value},bubbles:true,composed:true,cancelable:true})) && this.supplied === undefined && !this.hasAttribute('open')) this.local = value;
  this.sync();
 }
 private relevant(event: Event): boolean { return event.target instanceof Element && event.target.closest('af-tooltip') === this; }
 private enter = (event: PointerEvent): void => {
  if(!this.relevant(event) || event.pointerType === 'touch' || this.disabled()) return;
  if(event.relatedTarget instanceof Node && this.contains(event.relatedTarget)) { this.clear(); return; }
  this.clear(); if(this.open) return;
  const delay = Number(this.getAttribute('delay-duration') ?? 300);
  this.timer = this.clock.setTimeout(() => { this.timer = undefined; if(this.isConnected && !this.disabled()) this.request(true); },Number.isFinite(delay) ? Math.max(0,delay) : 300);
 };
 private leave = (event: PointerEvent): void => {
  if(!this.relevant(event)) return;
  if(event.relatedTarget instanceof Node && this.contains(event.relatedTarget)) { this.clear(); return; }
  this.clear(); if(this.contains(this.ownerDocument.activeElement)) return;
  this.timer = this.clock.setTimeout(() => this.request(false),100);
 };
 private focusin = (event: FocusEvent): void => { if(this.relevant(event) && !this.disabled()) this.request(true); };
 private focusout = (event: FocusEvent): void => { if(this.relevant(event) && !(event.relatedTarget instanceof Node && this.contains(event.relatedTarget))) this.request(false); };
 private press = (event: Event): void => { if(this.relevant(event) && !event.defaultPrevented) this.request(false); };
 private outside = (event: Event): void => { if(this.open && topFloating(this) && !event.defaultPrevented && !event.composedPath().includes(this)) this.request(false); };
 private escape = (event: KeyboardEvent): void => { if(this.open && topFloating(this) && event.key === 'Escape' && !event.defaultPrevented) { event.preventDefault(); this.request(false); } };
 private other = (event: Event): void => { const node = (event as CustomEvent<HTMLElement>).detail; if(this.open && node instanceof HTMLElement && node.localName === this.localName && node !== this && !this.contains(node) && !node.contains(this)) this.request(false); };
 private onScroll = (event: Event): void => { const trigger = this.trigger(); if(this.open && trigger && event.target instanceof Node && event.target.contains(trigger)) this.request(false); };
 private position = (): void => { const trigger = this.trigger(); if(this.open && trigger && this.panel) positionFloating(trigger,this.panel,'top',6); };
 private hidePanel(): void { if(this.panel && typeof this.panel.hidePopover === 'function' && this.panel.matches(':popover-open')) this.panel.hidePopover(); }
 private describe(target: HTMLElement | undefined, id: string | undefined): void {
  if(this.descriptionTarget && this.descriptionId && this.descriptionAdded) {
   const tokens = (this.descriptionTarget.getAttribute('aria-describedby') ?? '').split(/\s+/).filter(t => t && t !== this.descriptionId);
   if(tokens.length) this.descriptionTarget.setAttribute('aria-describedby',tokens.join(' ')); else this.descriptionTarget.removeAttribute('aria-describedby');
  }
  this.descriptionAdded = false;
  if(target && id) { const tokens = new Set((target.getAttribute('aria-describedby') ?? '').split(/\s+/).filter(Boolean)); this.descriptionAdded = !tokens.has(id); tokens.add(id); target.setAttribute('aria-describedby',[...tokens].join(' ')); }
  this.descriptionTarget = target; this.descriptionId = id;
 }
 private sync(): void {
  if(!this.isConnected) return;
  const panel = this.own('af-tooltip-content')[0];
  if(this.panel !== panel) {
   this.hidePanel(); this.resizeObserver?.disconnect(); this.panel = panel;
   if(typeof ResizeObserver !== 'undefined') { this.resizeObserver = new ResizeObserver(this.position); if(panel) this.resizeObserver.observe(panel); const trigger = this.trigger(); if(trigger) this.resizeObserver.observe(trigger); }
  }
  const trigger = this.trigger(); const wrapper = this.own('af-tooltip-trigger')[0];
  if(wrapper) {
   if(!this.wrapperTabs.has(wrapper)) this.wrapperTabs.set(wrapper,wrapper.getAttribute('tabindex'));
   const authored = this.wrapperTabs.get(wrapper) ?? null;
   if(trigger === wrapper) wrapper.tabIndex = Number(authored ?? 0);
   else if(authored === null) wrapper.removeAttribute('tabindex'); else wrapper.setAttribute('tabindex',authored);
  }
  if(panel) {
   identifyFloating(panel); panel.setAttribute('role','tooltip'); panel.hidden = !this.open; panel.toggleAttribute('inert',!this.open); panel.dataset.state = this.open ? 'open' : 'closed';
   if(typeof panel.showPopover === 'function') { panel.setAttribute('popover','manual'); if(this.open && !panel.matches(':popover-open')) panel.showPopover(); else if(!this.open) this.hidePanel(); }
  }
  this.describe(this.open ? trigger : undefined,this.open ? panel?.id : undefined);
  this.dataset.state = this.open ? 'open' : 'closed';
  const visible = this.open && !!panel;
  if(visible !== this.visible) { this.visible = visible; floatingVisibility(this,this.visible); }
  this.position();
 }
}
export class AfTooltipProvider extends HTMLElement {}
export class AfTooltipTrigger extends HTMLElement {}
export class AfTooltipContent extends HTMLElement {}
export const tooltipStyles = `af-tooltip,af-tooltip-provider{display:contents}af-tooltip-trigger:focus-visible{outline:2px solid var(--ring);outline-offset:2px}af-tooltip-content{box-sizing:border-box;display:block;position:fixed;inset:auto;margin:0;z-index:100;width:max-content;max-width:min(28rem,calc(100vw - 1rem));max-height:calc(100svh - 1rem);overflow:auto;white-space:normal;border:1px solid var(--border);border-radius:var(--radius-md,var(--radius,.375rem));padding:.375rem .625rem;text-align:left;font-size:.75rem;line-height:1.5;background:var(--popover,var(--background));color:var(--popover-foreground,var(--foreground));box-shadow:var(--shadow-md,0 4px 12px color-mix(in srgb,var(--foreground) 15%,transparent))}af-tooltip-content[hidden]{display:none!important}`;
export function registerTooltip(registry: CustomElementRegistry = customElements, document: Document = globalThis.document): void {
 if(!document.querySelector('style[data-af-tooltip-styles]')) { const style = document.createElement('style'); style.setAttribute('data-af-tooltip-styles',''); style.textContent = tooltipStyles; document.head.append(style); }
 for(const [name,ctor] of Object.entries({'af-tooltip':AfTooltip,'af-tooltip-provider':AfTooltipProvider,'af-tooltip-trigger':AfTooltipTrigger,'af-tooltip-content':AfTooltipContent})) if(!registry.get(name)) registry.define(name,ctor);
}
