/**
 * Internal: af-tooltip types, timing/trigger helpers, the provider, trigger and content
 * elements, and light-DOM styles; not a public entry point (tooltip.ts re-exports them).
 * Used by: tooltip.ts.
 */
export interface TooltipChangeDetail { value: boolean }
export interface TooltipContract { open: boolean | undefined }
/** A trigger without an interactive child supplies a native button. Existing
 * interactive children keep their identity, focus, and native behavior. */
export interface TooltipTriggerContract { readonly control: HTMLElement | undefined }
export interface TooltipClock { setTimeout(callback: () => void, delay: number): number;
  clearTimeout(id: number): void; now?(): number }
export interface TooltipProviderContract { delayDuration: number; skipDelayDuration: number }
export const interactiveTrigger =
  'button,a[href],input,select,textarea,[tabindex],[role="button"],[role="link"],' +
  '[contenteditable]:not([contenteditable="false"])';
// Wrappers whose tabindex the tooltip added itself (so it is not treated as authored).
const automaticWrapperTabs = new WeakSet<HTMLElement>();
export function duration(value: string | null, fallback: number): number { const n =
  value === null ? fallback : Number(value); return Number.isFinite(n) ? Math.max(0,n) : fallback; }
/** Makes a bare wrapper the focusable trigger, or restores its authored tabindex otherwise. */
export function applyWrapperTab(wrapper: HTMLElement, isTrigger: boolean,
  authored: string | null): void {
if(isTrigger) { if(authored === null) automaticWrapperTabs.add(wrapper);
     wrapper.tabIndex = Number(authored ?? 0); }
else { automaticWrapperTabs.delete(wrapper); if(authored === null) wrapper.removeAttribute(
     'tabindex'); else wrapper.setAttribute('tabindex',authored); }
}
export function removeDescribedBy(target: HTMLElement, id: string): void {
const tokens = (target.getAttribute('aria-describedby') ?? '').split(/\s+/).filter(
     t => t && t !== id);
if(tokens.length) target.setAttribute('aria-describedby',tokens.join(' '));
     else target.removeAttribute('aria-describedby');
}
/** Adds id to aria-describedby; true when it was not already there (so removal is ours). */
export function addDescribedBy(target: HTMLElement, id: string): boolean {
  const tokens = new Set((target.getAttribute('aria-describedby') ?? '').split(
    /\s+/).filter(Boolean)); const added = !tokens.has(id); tokens.add(id);
  target.setAttribute('aria-describedby',[...tokens].join(' ')); return added;
}
/** Arrow tip point: on the panel edge facing the trigger, centred on the trigger, kept 8px
 * inside the panel corners. a = trigger rect, p = panel rect. */
export function arrowPoint(a: DOMRect, p: DOMRect,
  side: string | undefined): {x: number; y: number} {
const x = side === 'left' ? p.right : side === 'right' ? p.left : Math.max(p.left+8,Math.min(
    a.left+a.width/2,p.right-8));
const y = side === 'top' ? p.bottom : side === 'bottom' ? p.top : Math.max(p.top+8,Math.min(
    a.top+a.height/2,p.bottom-8));
  return {x, y};
}
export class AfTooltipProvider extends HTMLElement implements TooltipProviderContract {
 get delayDuration(): number { return duration(this.getAttribute('delay-duration'),300); }
 set delayDuration(value: number) { this.setAttribute('delay-duration',String(value)); }
 get skipDelayDuration(): number { return duration(this.getAttribute('skip-delay-duration'),100); }
 set skipDelayDuration(value: number) { this.setAttribute('skip-delay-duration',String(value)); }
}
export class AfTooltipTrigger extends HTMLElement implements TooltipTriggerContract {
 static observedAttributes = ['disabled','tabindex','role','contenteditable'];
 private generated: HTMLButtonElement | undefined;
 private observer = new MutationObserver(() => this.ensureControl());
get control(): HTMLElement | undefined { return this.querySelector<HTMLElement>(
   interactiveTrigger) ?? undefined; }
connectedCallback(): void { this.observer.observe(this,{childList:true,subtree:true});
   this.ensureControl(); }
 disconnectedCallback(): void { this.observer.disconnect(); }
 attributeChangedCallback(): void { if(this.isConnected) this.ensureControl(); }
 private ensureControl(): void {
const explicitWrapper = this.hasAttribute('tabindex') && !automaticWrapperTabs.has(this) ||
    this.matches('[role="button"],[role="link"],[contenteditable]:not([contenteditable="false"])');
const authoredControl = [...this.querySelectorAll(interactiveTrigger)].some(node =>
    node !== this.generated);
  if(this.generated && (explicitWrapper || authoredControl)) {
   this.generated.replaceWith(...this.generated.childNodes);
   this.generated = undefined;
  }
  if(!explicitWrapper && !this.control && this.childNodes.length) {
   this.generated = this.ownerDocument.createElement('button');
   this.generated.type = 'button';
   this.generated.append(...this.childNodes);
   this.append(this.generated);
  }
  if(this.generated) this.generated.disabled = this.hasAttribute('disabled');
 }
}
export class AfTooltipContent extends HTMLElement {}
export const tooltipStyles =
  `af-tooltip,af-tooltip-provider{display:contents}af-tooltip-trigger{cursor:pointer;` +
  `line-height:1.5}af-tooltip-trigger>button{box-sizing:border-box;margin:0;padding:0;border:0;` +
  `border-radius:0;background:transparent;color:inherit;font:inherit;line-height:inherit;` +
  `cursor:inherit}af-tooltip-trigger[disabled]>button,af-tooltip-trigger>button:disabled,` +
  `af-tooltip-trigger>button[aria-disabled="true"]{opacity:.5;cursor:default}` +
  `af-tooltip-trigger:focus-visible{outline:2px solid var(--ring);outline-offset:2px}` +
  `af-tooltip-content{box-sizing:border-box;display:block;position:fixed;inset:auto;margin:0;` +
  `z-index:100;width:max-content;max-width:min(28rem,calc(100vw - 1rem));` +
  `max-height:calc(100svh - 1rem);overflow:auto;white-space:normal;` +
  `border:1px solid var(--border);border-radius:var(--radius-md,calc(var(--radius,` +
  `.625rem) - 2px));padding:.375rem .625rem;text-align:left;font-size:.75rem;line-height:1.5;` +
  `background:var(--popover,var(--background));color:var(--popover-foreground,` +
  `var(--foreground));box-shadow:var(--shadow-md,0 4px 6px -1px rgb(0 0 0 / 10%),` +
  `0 2px 4px -2px rgb(0 0 0 / 10%))}af-tooltip-content::after{content:"";position:fixed;` +
  `pointer-events:none;width:10px;height:5px;left:var(--af-tooltip-arrow-left);` +
  `top:var(--af-tooltip-arrow-top);background:var(--popover,var(--background));` +
  `clip-path:polygon(0 0,100% 0,50% 100%);transform:translateX(-50%)}` +
  `af-tooltip-content[data-side=bottom]::after{transform:translate(-50%,-100%) rotate(180deg)}` +
  `af-tooltip-content[data-side=left]::after{transform:translate(-25%,-50%) rotate(-90deg)}` +
  `af-tooltip-content[data-side=right]::after{transform:translate(-75%,-50%) rotate(90deg)}` +
  `af-tooltip-content[hidden]{display:none!important}`;
