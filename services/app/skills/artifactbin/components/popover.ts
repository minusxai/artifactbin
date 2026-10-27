/**
 * <af-popover>: anchored popover.
 * Import:  import {registerPopover} from './components/popover.js'; registerPopover();  (load the .js in the browser; this .ts is the readable contract)
 * Props: open (boolean)
 * Parts: af-popover-trigger (use a native button inside), af-popover-content
 * Events: af-change (bubbles) with event.detail.value; reflect your Apollo value back for controlled use
 * Usage:
 *   <af-popover><af-popover-trigger><button>Info</button></af-popover-trigger><af-popover-content>Hello</af-popover-content></af-popover>
 */
import {floatingVisibility,identifyFloating,positionFloating,topFloating} from './floating-position';
export interface PopoverChangeDetail { value: boolean }
export interface PopoverContract { open: boolean | undefined }
/** A nonmodal, author-controlled disclosure. Authored content remains in light DOM. */
export class AfPopover extends HTMLElement implements PopoverContract {
 static observedAttributes = ['open'];
 private local = false;
 private supplied: boolean | undefined;
 private initialized = false;
 private visible = false;
 private panel: HTMLElement | undefined;
 private opener: HTMLElement | null = null;
 private observer = new MutationObserver(() => this.sync());
 private resizeObserver: ResizeObserver | undefined;
 private labels = new WeakMap<HTMLElement,Set<string>>();
 private disabledChildren = new Map<HTMLElement,{disabled:string|null;tab:string|null}>();
 private wrapperAttributes = new WeakMap<HTMLElement,{role:string|null;tab:string|null}>();
 private wasDisabled = false;
 private leavingFocus = false;
 get open(): boolean { return this.supplied ?? (this.hasAttribute('open') || this.local); }
 set open(value: boolean | undefined) { if (value === undefined) this.local = this.open; this.supplied = value; this.sync(); }
 connectedCallback(): void {
  if (Object.prototype.hasOwnProperty.call(this,'open')) { const value = this.open; delete (this as {open?:boolean}).open; this.open = value; }
  if (!this.initialized) { this.local = this.hasAttribute('default-open'); this.initialized = true; }
  this.addEventListener('click',this.onClick); this.addEventListener('keydown',this.onControlKey);
  this.addEventListener('focusout',this.onFocusout);
  this.ownerDocument.addEventListener('pointerdown',this.outside); this.ownerDocument.addEventListener('keydown',this.escape);
  this.ownerDocument.addEventListener('af-floating-activated',this.other);
  this.ownerDocument.defaultView?.addEventListener('resize',this.position); this.ownerDocument.addEventListener('scroll',this.position,true);
  this.observer.observe(this,{childList:true,subtree:true,attributes:true,attributeFilter:['id','disabled','side','align','side-offset']});
  this.sync();
 }
 disconnectedCallback(): void {
  this.observer.disconnect(); this.resizeObserver?.disconnect(); this.resizeObserver = undefined;
  this.removeEventListener('click',this.onClick); this.removeEventListener('keydown',this.onControlKey);
  this.removeEventListener('focusout',this.onFocusout);
  this.ownerDocument.removeEventListener('pointerdown',this.outside); this.ownerDocument.removeEventListener('keydown',this.escape);
  this.ownerDocument.removeEventListener('af-floating-activated',this.other);
  this.ownerDocument.defaultView?.removeEventListener('resize',this.position); this.ownerDocument.removeEventListener('scroll',this.position,true);
  this.hidePanel(); floatingVisibility(this,false); this.visible = false;
 }
 attributeChangedCallback(): void { this.sync(); }
 private own(tag: string): HTMLElement[] { return [...this.querySelectorAll<HTMLElement>(tag)].filter(n => n.closest('af-popover') === this); }
 private trigger(): HTMLElement | undefined { const wrapper = this.own('af-popover-trigger')[0]; return wrapper?.querySelector<HTMLElement>('button,a[href],input,select,textarea') ?? wrapper; }
 private disabled(): boolean { const t = this.trigger(); return !t || t.matches(':disabled,[disabled],[aria-disabled="true"]') || !!t.closest('af-popover-trigger[disabled]'); }
 private request(value: boolean, restore = false): void {
  if (value === this.open) return;
  if (value) this.opener = this.trigger() ?? null;
  if (this.dispatchEvent(new CustomEvent<PopoverChangeDetail>('af-change',{detail:{value},bubbles:true,composed:true,cancelable:true})) && this.supplied === undefined && !this.hasAttribute('open')) this.local = value;
  this.sync();
  if (restore && !this.open && this.opener?.isConnected) this.opener.focus();
 }
 private onClick = (event: MouseEvent): void => {
  if (event.defaultPrevented || !(event.target instanceof Element) || event.target.closest('af-popover') !== this || !event.target.closest('af-popover-trigger') || this.disabled()) return;
  this.request(!this.open,true);
 };
 private onControlKey = (event: KeyboardEvent): void => {
  if (event.defaultPrevented || this.disabled() || event.target !== this.own('af-popover-trigger')[0] || this.trigger() !== event.target) return;
  if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); this.trigger()?.click(); }
 };
 private outside = (event: Event): void => { if (this.open && topFloating(this) && !event.defaultPrevented && !event.composedPath().includes(this)) this.request(false); };
 private onFocusout = (event: FocusEvent): void => {
  if(!this.open || event.defaultPrevented || (event.relatedTarget instanceof Node && this.contains(event.relatedTarget))) return;
  this.leavingFocus = true; try { this.request(false); } finally { this.leavingFocus = false; }
 };
 private escape = (event: KeyboardEvent): void => { if (this.open && topFloating(this) && event.key === 'Escape' && !event.defaultPrevented) { event.preventDefault(); this.request(false,true); } };
 private other = (event: Event): void => { const node = (event as CustomEvent<HTMLElement>).detail; if(this.open && node instanceof HTMLElement && node.localName === this.localName && node !== this && !this.contains(node) && !node.contains(this)) this.request(false); };
 private position = (): void => { const anchor = this.own('af-popover-anchor')[0] ?? this.trigger(); if (this.open && anchor && this.panel) positionFloating(anchor,this.panel,'bottom',4); };
 private hidePanel(): void { if (this.panel && typeof this.panel.hidePopover === 'function' && this.panel.matches(':popover-open')) this.panel.hidePopover(); }
 private sync(): void {
  if (!this.isConnected) return;
  const panel = this.own('af-popover-content')[0];
  if (this.panel !== panel) {
   this.hidePanel(); if(this.visible && this.opener?.isConnected) this.opener.focus(); this.resizeObserver?.disconnect(); this.panel = panel;
   this.visible = false; floatingVisibility(this,false);
   if (typeof ResizeObserver !== 'undefined') { this.resizeObserver = new ResizeObserver(this.position); if(panel) this.resizeObserver.observe(panel); const trigger = this.trigger(); if(trigger) this.resizeObserver.observe(trigger); }
  }
  const trigger = this.trigger(); const wrapper = this.own('af-popover-trigger')[0];
  for(const [child,authored] of this.disabledChildren) {
   if(child === trigger && wrapper?.hasAttribute('disabled')) continue;
   if(authored.disabled === null) child.removeAttribute('disabled'); else child.setAttribute('disabled',authored.disabled);
   if(authored.tab === null) child.removeAttribute('tabindex'); else child.setAttribute('tabindex',authored.tab);
   this.disabledChildren.delete(child);
  }
  if (trigger && wrapper) {
   let authored = this.wrapperAttributes.get(wrapper); if(!authored) { authored = {role:wrapper.getAttribute('role'),tab:wrapper.getAttribute('tabindex')}; this.wrapperAttributes.set(wrapper,authored); }
   if (trigger === wrapper) { wrapper.setAttribute('role',authored.role ?? 'button'); wrapper.tabIndex = wrapper.hasAttribute('disabled') ? -1 : Number(authored.tab ?? 0); }
   else {
    if(authored.role === null) wrapper.removeAttribute('role'); else wrapper.setAttribute('role',authored.role);
    if(authored.tab === null) wrapper.removeAttribute('tabindex'); else wrapper.setAttribute('tabindex',authored.tab);
    wrapper.removeAttribute('aria-haspopup'); wrapper.removeAttribute('aria-expanded'); wrapper.removeAttribute('aria-controls');
   }
   if(trigger !== wrapper && wrapper.hasAttribute('disabled')) {
    if(!this.disabledChildren.has(trigger)) this.disabledChildren.set(trigger,{disabled:trigger.getAttribute('disabled'),tab:trigger.getAttribute('tabindex')});
    if('disabled' in trigger && !trigger.hasAttribute('disabled')) trigger.setAttribute('disabled',''); trigger.tabIndex = -1;
   }
   trigger.setAttribute('aria-haspopup','dialog'); trigger.setAttribute('aria-expanded',String(this.open));
   if (panel) { identifyFloating(panel); trigger.setAttribute('aria-controls',panel.id); } else trigger.removeAttribute('aria-controls');
  }
  const disabled = this.disabled(); const becameDisabled = disabled && !this.wasDisabled; this.wasDisabled = disabled;
  if(becameDisabled && this.open) this.request(false);
  if (panel) {
   identifyFloating(panel); panel.setAttribute('role','dialog'); panel.tabIndex = -1;
   let managed = this.labels.get(panel); if(!managed) { managed = new Set(); this.labels.set(panel,managed); }
   for (const [tag,attr] of [['af-popover-title','aria-labelledby'],['af-popover-description','aria-describedby']] as const) {
    const labels = this.own(tag); labels.forEach(identifyFloating);
    if(labels.length) { panel.setAttribute(attr,labels.map(n => n.id).join(' ')); managed.add(attr); }
    else if(managed.has(attr)) { panel.removeAttribute(attr); managed.delete(attr); }
   }
   if(!panel.hasAttribute('aria-labelledby') && !panel.hasAttribute('aria-label')) panel.setAttribute('aria-label',trigger?.getAttribute('aria-label') ?? trigger?.textContent?.trim() ?? 'Details');
   panel.hidden = !this.open; panel.toggleAttribute('inert',!this.open); panel.dataset.state = this.open ? 'open' : 'closed';
   // Manual popovers provide top-layer paint without browser-owned dismissal state.
   if (typeof panel.showPopover === 'function') { panel.setAttribute('popover','manual'); if (this.open && !panel.matches(':popover-open')) panel.showPopover(); else if (!this.open) this.hidePanel(); }
  }
  this.dataset.state = this.open ? 'open' : 'closed';
  const visible = this.open && !!panel;
  if (visible !== this.visible) {
   this.visible = visible; floatingVisibility(this,this.visible);
   if (this.visible && panel) { this.opener = trigger ?? null; this.position(); }
   else if(!this.leavingFocus && panel?.contains(this.ownerDocument.activeElement) && this.opener?.isConnected && !this.opener.matches(':disabled')) this.opener.focus();
  }
  this.position();
 }
}
export class AfPopoverTrigger extends HTMLElement {}
export class AfPopoverContent extends HTMLElement {}
export class AfPopoverAnchor extends HTMLElement {}
export class AfPopoverHeader extends HTMLElement {}
export class AfPopoverTitle extends HTMLElement {}
export class AfPopoverDescription extends HTMLElement {}
export const popoverStyles = `
af-popover{display:contents}
af-popover-trigger{cursor:pointer;line-height:1.5}
af-popover-trigger>button{box-sizing:border-box;margin:0;padding:0;border:0;border-radius:0;background:transparent;color:inherit;font:inherit;line-height:inherit;cursor:inherit}
af-popover-trigger[disabled]>button,af-popover-trigger>button:disabled,af-popover-trigger>button[aria-disabled="true"]{opacity:.5;cursor:default}
af-popover-trigger:focus-visible{outline:2px solid var(--ring);outline-offset:2px}
af-popover-trigger[disabled]{opacity:.5;cursor:default}
af-popover-content{box-sizing:border-box;position:fixed;inset:auto;margin:0;z-index:50;width:18rem;max-width:calc(100vw - 1rem);max-height:calc(100svh - 1rem);overflow:auto;border:1px solid currentColor;border-radius:var(--radius-md,calc(var(--radius,.625rem) - 2px));padding:1rem;line-height:1.5;background:var(--popover,var(--background));color:var(--popover-foreground,var(--foreground));box-shadow:var(--shadow-md,0 4px 6px -1px rgb(0 0 0 / 10%),0 2px 4px -2px rgb(0 0 0 / 10%))}
:where(af-popover-content) :where(p):not([class]){margin-block:.75em;max-width:68ch;line-height:1.65}
af-popover-content[hidden]{display:none!important}
af-popover-header{display:flex;flex-direction:column;gap:.25rem;font-size:.875rem}
af-popover-title{display:block;font-weight:500}
af-popover-description{display:block;color:var(--muted-foreground)}`;
export function registerPopover(registry: CustomElementRegistry = customElements, document: Document = globalThis.document): void {
 if (!document.querySelector('style[data-af-popover-styles]')) { const style = document.createElement('style'); style.setAttribute('data-af-popover-styles',''); style.textContent = popoverStyles; document.head.append(style); }
 for(const [name,ctor] of Object.entries({'af-popover':AfPopover,'af-popover-trigger':AfPopoverTrigger,'af-popover-content':AfPopoverContent,'af-popover-anchor':AfPopoverAnchor,'af-popover-header':AfPopoverHeader,'af-popover-title':AfPopoverTitle,'af-popover-description':AfPopoverDescription})) if(!registry.get(name)) registry.define(name,ctor);
}
