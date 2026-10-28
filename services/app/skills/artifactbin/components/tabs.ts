/**
 * <af-tabs>: tab list and panels.
 * Usage: import '@afbin/tabs';  (registers the tags; this .ts is the readable contract)
 * Props: value (string on the root af-tabs; property or attribute), default-value, orientation
 *   (horizontal|vertical), activation-mode (automatic|manual), loop (default on; "false" stops
 *   wrapping), variant (default|line, also per af-tabs-list), dir. Children: af-tabs-list,
 *   af-tabs-trigger value="a" (disabled skips it), af-tabs-content value="a".
 * Events: af-change (bubbles, cancelable) with event.detail.value; reflect your Apollo value
 *   back for controlled use.
 * Examples:
 *   <af-tabs value="a"><af-tabs-list><af-tabs-trigger value="a">One</af-tabs-trigger>
 *   </af-tabs-list><af-tabs-content value="a">First</af-tabs-content></af-tabs>
 * Gotchas: selection is author-owned; with value set, af-change only reports intent. No
 *   default-value means nothing is selected. Automatic mode selects on focus (arrow keys), manual
 *   needs Enter/Space/click. Panels always stay mounted; inactive ones are hidden and inert.
 */
import { registerComponent, type ComponentDescriptor } from './register-component';
import {tabFocusTarget, tabsStyles} from './tab-navigation';
import type {TabsChangeDetail, TabsContract} from './tab-navigation';
export type {TabsActivationMode, TabsChangeDetail, TabsContract, TabsOrientation}
  from './tab-navigation';
export {tabsStyles};
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
      list.dataset.variant = list.getAttribute('variant') ?? this.getAttribute('variant') ??
        'default';
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
/** Registration descriptor (tags + stylesheet) applied on import; exported for tests. */
export const tabsComponent: ComponentDescriptor = {
  styleKey: 'af-tabs-styles', styles: tabsStyles,
  elements: {'af-tabs': AfTabs, 'af-tabs-list': AfTabsList,
    'af-tabs-trigger': AfTabsTrigger, 'af-tabs-content': AfTabsContent},
};
registerComponent(tabsComponent);
