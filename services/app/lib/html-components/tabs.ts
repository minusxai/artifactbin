/**
 * <af-tabs>: tab list and panels.
 * Import:  import {registerTabs} from './components/tabs.js'; registerTabs();  (load the .js in the browser; this .ts is the readable contract)
 * Props: value (string on the root af-tabs)
 * Parts: af-tabs-list, af-tabs-trigger value="a", af-tabs-content value="a"
 * Events: af-change (bubbles) with event.detail.value; reflect your Apollo value back for controlled use
 * Usage:
 *   <af-tabs value="a"><af-tabs-list><af-tabs-trigger value="a">One</af-tabs-trigger></af-tabs-list>
 *   <af-tabs-content value="a">First</af-tabs-content></af-tabs>
 */
import {tabFocusTarget} from './tab-navigation';
/** Author-owned selection; components emit intent and never persist viewer state. */
export interface TabsChangeDetail { value: string }
export type TabsOrientation = 'horizontal' | 'vertical';
export type TabsActivationMode = 'automatic' | 'manual';
export interface TabsContract { value: string | undefined }
let nextId = 0;
export class AfTabs extends HTMLElement implements TabsContract {
  static observedAttributes = ['value', 'orientation', 'activation-mode', 'dir', 'loop', 'variant'];
  private selection: string | undefined;
  private initialized = false;
  private controlled = false;
  private propertyValue: string | undefined;
  private focused: AfTabsTrigger | undefined;
  private dispatchingChange = false;
  private pointerDownTrigger: AfTabsTrigger | undefined;
  private pointerFocusActivation: AfTabsTrigger | undefined;
  private observer = new MutationObserver(() => this.sync());
get value(): string | undefined { return this.controlled ? this.propertyValue : this.getAttribute(
    'value') ?? this.selection; }
  set value(value: string | undefined) {
    if (value === undefined) this.selection = this.value;
    this.controlled = value !== undefined;
    this.propertyValue = value;
    this.sync();
  }
  connectedCallback(): void {
    if (Object.prototype.hasOwnProperty.call(this, 'value')) {
      const value = this.value; delete (this as {value?: string}).value; this.value = value;
    }
    // No default means no selection; the first enabled trigger remains the Tab entry.
if (!this.initialized) { this.selection = this.getAttribute('default-value') ?? undefined;
      this.initialized = true; }
    this.addEventListener('click', this.onClick);
    this.addEventListener('mousedown', this.onMouseDown);
    this.addEventListener('keydown', this.keydown);
    this.addEventListener('focusin', this.focusin);
    this.addEventListener('focusout', this.focusout);
this.observer.observe(this, {childList:true, subtree:true, attributes:true, attributeFilter:[
      'disabled','value']});
    this.sync();
  }
  disconnectedCallback(): void {
    this.observer.disconnect();
    this.removeEventListener('click', this.onClick);
    this.removeEventListener('mousedown', this.onMouseDown);
    this.removeEventListener('keydown', this.keydown);
    this.removeEventListener('focusin', this.focusin);
    this.removeEventListener('focusout', this.focusout);
  }
  attributeChangedCallback(): void { this.sync(); }
  private own<T extends HTMLElement>(tag: string): T[] {
    return [...this.querySelectorAll<T>(tag)].filter(node => node.closest('af-tabs') === this);
  }
  private triggers(): AfTabsTrigger[] { return this.own<AfTabsTrigger>('af-tabs-trigger'); }
private enabled(): AfTabsTrigger[] { return this.triggers().filter(t => !t.hasAttribute(
    'disabled')); }
  private target(event: Event): AfTabsTrigger | undefined {
const node = event.target instanceof Element ? event.target.closest<AfTabsTrigger>(
      'af-tabs-trigger') : null;
    return node?.closest('af-tabs') === this && !node.hasAttribute('disabled') ? node : undefined;
  }
  private activeElement(): Element | null {
    const root = this.getRootNode();
    return root instanceof ShadowRoot ? root.activeElement : this.ownerDocument.activeElement;
  }
  private choose(trigger: AfTabsTrigger): void {
    const value = trigger.getAttribute('value');
    if (this.dispatchingChange || value === null || value === this.value) return;
const event = new CustomEvent<TabsChangeDetail>('af-change', {detail:{value}, bubbles:true,
      composed:true, cancelable:true});
    this.dispatchingChange = true;
    try {
if (this.dispatchEvent(event) && !this.controlled && !this.hasAttribute('value')) this.selection =
        value;
    } finally {
      this.dispatchingChange = false;
      this.sync();
    }
  }
  private onClick = (event: Event): void => {
    const trigger = this.target(event); if (!trigger || event.defaultPrevented) return;
    const alreadyFocused = this.activeElement() === trigger;
const activatedOnPointerFocus = event instanceof MouseEvent && event.detail > 0 &&
      this.pointerFocusActivation === trigger;
    this.pointerDownTrigger = undefined; this.pointerFocusActivation = undefined;
    this.focused = trigger; trigger.focus();
    // Automatic mode activates through focusin; retain click activation for manual mode
    // and clicks on an already-focused trigger without dispatching intent twice.
if (!activatedOnPointerFocus && (alreadyFocused || this.getAttribute(
      'activation-mode') === 'manual')) this.choose(trigger);
  };
private onMouseDown = (event: Event): void => { this.pointerDownTrigger = this.target(event);
    this.pointerFocusActivation = undefined; };
  private focusout = (): void => { queueMicrotask(() => this.sync()); };
  private focusin = (event: Event): void => {
    const trigger = this.target(event); if (!trigger) return;
    this.focused = trigger;
    if (this.getAttribute('activation-mode') !== 'manual') {
      if (this.pointerDownTrigger === trigger) this.pointerFocusActivation = trigger;
      this.choose(trigger);
    }
    this.sync();
  };
  private keydown = (event: KeyboardEvent): void => {
    const trigger = this.target(event); if (!trigger || event.defaultPrevented) return;
if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); this.choose(trigger);
      return; }
    const vertical = this.getAttribute('orientation') === 'vertical';
const rtl = (this.closest('[dir]')?.getAttribute('dir') ?? getComputedStyle(
      this).direction) === 'rtl';
    const enabled = this.enabled();
const index=tabFocusTarget({key:event.key,index:enabled.indexOf(trigger),count:enabled.length,
      orientation:vertical?'vertical':'horizontal',dir:rtl?'rtl':'ltr',loop:this.getAttribute(
      'loop')!=='false'});
    if(index===null)return;
    event.preventDefault(); const next = enabled[index]; if (!next) return;
    const alreadyFocused = this.activeElement() === next;
    this.focused = next; next.focus();
    if (alreadyFocused && this.getAttribute('activation-mode') !== 'manual') this.choose(next);
    this.sync();
  };
  private identify(node: HTMLElement, kind: string): void {
    if (node.id) return;
    let id: string;
    do { id = `af-tabs-${kind}-${++nextId}`; } while (this.ownerDocument.getElementById(id));
    node.id = id;
  }
  private sync(): void {
    if (!this.isConnected) return;
    const triggers = this.triggers(); const panels = this.own<AfTabsContent>('af-tabs-content');
    const enabled = this.enabled();
if (!this.focused || !enabled.includes(this.focused) || !enabled.includes(this.activeElement(
      ) as AfTabsTrigger)) this.focused = enabled.find(t => t.getAttribute(
      'value') === this.value) ?? enabled[0];
    for (const list of this.own('af-tabs-list')) {
list.dataset.orientation = this.getAttribute('orientation') === 'vertical' ? 'vertical' :
        'horizontal';
      list.dataset.variant = list.getAttribute('variant') ?? this.getAttribute('variant') ?? 'default';
list.setAttribute('role','tablist'); list.setAttribute('aria-orientation', this.getAttribute(
        'orientation') === 'vertical' ? 'vertical' : 'horizontal');
    }
    for (const trigger of triggers) {
      this.identify(trigger, 'trigger');
      const active = trigger.getAttribute('value') === this.value;
      trigger.setAttribute('role','tab'); trigger.setAttribute('aria-selected',String(active));
      trigger.setAttribute('aria-disabled',String(trigger.hasAttribute('disabled')));
      trigger.tabIndex = trigger === this.focused ? 0 : -1;
      trigger.dataset.state = active ? 'active' : 'inactive';
      const panel = panels.find(p => p.getAttribute('value') === trigger.getAttribute('value'));
      if (panel) { this.identify(panel, 'panel'); trigger.setAttribute('aria-controls',panel.id); }
      else trigger.removeAttribute('aria-controls');
    }
    // Authored panels always remain mounted, including without force-mount.
    for (const panel of panels) {
      this.identify(panel, 'panel');
      const active = panel.getAttribute('value') === this.value;
panel.setAttribute('role','tabpanel'); panel.hidden = !active; panel.toggleAttribute('inert',
        !active);
      panel.dataset.state = active ? 'active' : 'inactive'; panel.tabIndex = active ? 0 : -1;
      const trigger = triggers.find(t => t.getAttribute('value') === panel.getAttribute('value'));
if (trigger) panel.setAttribute('aria-labelledby',trigger.id); else panel.removeAttribute(
        'aria-labelledby');
    }
  }
}
export class AfTabsList extends HTMLElement {}
export class AfTabsTrigger extends HTMLElement {}
export class AfTabsContent extends HTMLElement {}
/** Light DOM styles may be bundled once by the author runtime. */
export const tabsStyles = `
af-tabs{display:flex;gap:.5rem;flex-direction:column}
af-tabs[orientation=vertical]{flex-direction:row}
af-tabs-list{box-sizing:border-box;display:inline-flex;align-items:center;justify-content:center;width:fit-content;height:36px;padding:3px;border-radius:var(--radius-lg,var(--radius,.625rem));background:var(--muted,#eee);color:var(--muted-foreground,#555)}
af-tabs-list[data-orientation=vertical]{height:fit-content;flex-direction:column}
af-tabs-trigger{box-sizing:border-box;position:relative;display:inline-flex;flex:1;align-items:center;justify-content:center;gap:.375rem;height:calc(100% - 1px);cursor:pointer;border:1px solid transparent;padding:4px 8px;border-radius:var(--radius-md,calc(var(--radius,.625rem) - 2px));font-family:inherit;font-size:14px;font-weight:500;line-height:20px;white-space:nowrap;color:var(--muted-foreground,#555);transition:background-color .15s,color .15s,box-shadow .15s}
af-tabs-list[data-orientation=vertical]>af-tabs-trigger{width:100%;justify-content:flex-start}
af-tabs-trigger[disabled]{opacity:.5;cursor:default;pointer-events:none}
af-tabs-trigger[data-state=inactive]:hover{background:color-mix(in srgb,var(--foreground,#222) 10%,transparent);color:var(--foreground,#222)}
af-tabs-trigger[data-state=active]{background:var(--primary,#222);color:var(--primary-foreground,#fff);box-shadow:0 1px 2px #0000000d}
af-tabs-trigger:focus-visible{z-index:10;outline:2px solid transparent;outline-offset:2px;box-shadow:0 0 0 2px color-mix(in oklab,var(--ring,#777) 50%,transparent),0 1px 2px #0000000d}
af-tabs-trigger>svg{pointer-events:none;flex-shrink:0;width:1rem;height:1rem}
af-tabs-list[data-variant=line]{background:transparent;gap:.25rem;border-radius:0}
af-tabs-list[data-variant=line]>af-tabs-trigger[data-state=active]{background:transparent;color:var(--foreground,#222);box-shadow:none}
af-tabs-list[data-variant=line]>af-tabs-trigger::after{position:absolute;content:"";background:var(--primary,#222);opacity:0;transition:opacity .15s}
af-tabs-list[data-variant=line][data-orientation=horizontal]>af-tabs-trigger::after{left:0;right:0;bottom:-5px;height:2px}
af-tabs-list[data-variant=line][data-orientation=vertical]>af-tabs-trigger::after{top:0;bottom:0;right:-4px;width:2px}
af-tabs-list[data-variant=line]>af-tabs-trigger[data-state=active]::after{opacity:1}
af-tabs-content{flex:1;outline:none}
af-tabs-content[hidden]{display:none!important}
`;
export function registerTabs(registry: CustomElementRegistry = customElements, document: Document =
  globalThis.document): void {
  if (!document.querySelector('style[data-af-tabs-styles]')) {
    const style = document.createElement('style'); style.setAttribute('data-af-tabs-styles', '');
    style.textContent = tabsStyles; document.head.append(style);
  }
for (const [name, ctor] of Object.entries({ 'af-tabs': AfTabs, 'af-tabs-list': AfTabsList,
    'af-tabs-trigger': AfTabsTrigger, 'af-tabs-content': AfTabsContent })) {
    if (!registry.get(name)) registry.define(name, ctor);
  }
}
