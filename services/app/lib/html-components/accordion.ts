/**
 * <af-accordion>: stacked disclosure items.
 * Usage: import '@afbin/accordion';  (registers the tags; this .ts is the readable contract)
 * Props: type ("single" uses a string value, "multiple" a string-array value), value,
 *   default-value (initial uncontrolled value; JSON array for multiple), collapsible (single
 *   only: the open item can close), disabled, orientation (vertical|horizontal).
 *   Parts: af-accordion-item value="a" containing af-accordion-trigger and af-accordion-content.
 * Events: af-change (bubbles, cancelable) with event.detail.value.
 * Examples:
 *   <af-accordion type="single" value="a"><af-accordion-item value="a">
 *   <af-accordion-trigger>Why</af-accordion-trigger>
 *   <af-accordion-content>Because.</af-accordion-content></af-accordion-item></af-accordion>
 * Gotchas: reflect your Apollo value back for controlled use; an item without a value is
 *   disabled; a native <button> inside the trigger carries the ARIA state instead of the trigger.
 */
import { registerComponent, type ComponentDescriptor } from './register-component';
import {
  accordionOrientation, accordionPartDisabled, accordionStyles, accordionTypeOf,
  ensureAccordionChevron, equalAccordionValue, identifyAccordionPart, normalizeAccordionValue,
  parseAccordionAttribute, rovingIndex, syncAccordionContent, syncAccordionControls,
  toggleAccordionValue, type AccordionChangeDetail, type AccordionContract, type AccordionType,
  type AccordionValue, type NativeButtonMemory, type TriggerSemantics,
} from './accordion-model';

export { accordionStyles } from './accordion-model';

export class AfAccordion extends HTMLElement implements AccordionContract {
  static observedAttributes =
    ['type','value','default-value','collapsible','disabled','orientation'];
  private selection: AccordionValue = '';
  private initialized = false;
  private propertyControlled = false;
  private propertyValue: AccordionValue = '';
  // Authored role/tabindex, restored when a trigger loses its native button.
  private triggerSemantics = new WeakMap<AfAccordionTrigger,TriggerSemantics>();
  private buttonMemory: NativeButtonMemory = {authored:new WeakMap(), forced:new WeakSet()};
  private observer = new MutationObserver(() => this.sync());

  get value(): AccordionValue {
    const type = this.type;
    if (this.propertyControlled) return normalizeAccordionValue(type,this.propertyValue);
    if (this.hasAttribute('value'))
      return parseAccordionAttribute(this.getAttribute('value') ?? '',type);
    return normalizeAccordionValue(type,this.selection);
  }
  set value(value: AccordionValue) {
    this.propertyControlled = true; this.propertyValue = value; this.sync(); }
  get type(): AccordionType { return accordionTypeOf(this.getAttribute('type')); }
  connectedCallback(): void {
    // Replay a value set before upgrade through the setter.
    if (Object.prototype.hasOwnProperty.call(this,'value')) {
      const value = this.value;
      delete (this as {value?: AccordionValue}).value;
      this.value = value;
    }
    if (!this.initialized) {
      this.selection = this.hasAttribute('default-value') ?
        parseAccordionAttribute(this.getAttribute('default-value') ?? '',this.type) :
        (this.type === 'multiple' ? [] : '');
      this.initialized = true;
    }
    this.addEventListener('click',this.onClick); this.addEventListener('keydown',this.onKeydown);
    this.observer.observe(this,{childList:true,subtree:true,attributes:true,
      attributeFilter:['disabled','value','id']});
    this.sync();
  }
  disconnectedCallback(): void {
    this.observer.disconnect();
    this.removeEventListener('click',this.onClick);
    this.removeEventListener('keydown',this.onKeydown);
  }
  attributeChangedCallback(): void { this.sync(); }
  private items(): AfAccordionItem[] {
    return [...this.querySelectorAll<AfAccordionItem>('af-accordion-item')]
      .filter(item => item.closest('af-accordion') === this);
  }
  // Parts of this item only, skipping those that belong to a nested accordion.
  private ownParts<T extends HTMLElement>(item: AfAccordionItem,selector: string): T[] {
    return [...item.querySelectorAll<T>(selector)].filter(node =>
      node.closest('af-accordion-item') === item && node.closest('af-accordion') === this);
  }
  private triggers(item: AfAccordionItem): AfAccordionTrigger[] {
    return this.ownParts(item,'af-accordion-trigger'); }
  private contents(item: AfAccordionItem): AfAccordionContent[] {
    return this.ownParts(item,'af-accordion-content'); }
  private itemForTrigger(trigger: AfAccordionTrigger): AfAccordionItem | undefined {
    const item = trigger.closest<AfAccordionItem>('af-accordion-item');
    return item?.closest('af-accordion') === this ? item : undefined;
  }
  private focusControl(trigger: AfAccordionTrigger): HTMLElement {
    const item = trigger.closest<AfAccordionItem>('af-accordion-item');
    if (!item) return trigger;
    return this.ownParts<HTMLButtonElement>(item,'af-accordion-trigger button')
      .find(button => button.closest('af-accordion-trigger') === trigger) ?? trigger;
  }
  private isDisabled(item: AfAccordionItem, trigger?: AfAccordionTrigger): boolean {
    return accordionPartDisabled(this,item,trigger); }
  private onClick = (event: Event): void => {
    const target = event.target instanceof Element ?
      event.target.closest<AfAccordionTrigger>('af-accordion-trigger') : null;
    if (!target || target.closest('af-accordion') !== this || event.defaultPrevented) return;
    const item = this.itemForTrigger(target); const value = item?.getAttribute('value');
    const nativeButton = event.target instanceof Element ? event.target.closest('button') : null;
    if (!item || value == null || value === '' || this.isDisabled(item,target) ||
      nativeButton?.disabled) return;
    this.request(value);
  };
  private onKeydown = (event: KeyboardEvent): void => {
    const target = event.target instanceof Element ?
      event.target.closest<AfAccordionTrigger>('af-accordion-trigger') : null;
    if (!target || target.closest('af-accordion') !== this || event.defaultPrevented) return;
    const item = this.itemForTrigger(target);
    const nativeButton = event.target instanceof Element ? event.target.closest('button') : null;
    if (!item || this.isDisabled(item,target) || nativeButton?.disabled) return;
    // Native buttons synthesize their own click from Enter/Space.
    if ((event.key === 'Enter' || event.key === ' ') && event.target === target &&
      !target.querySelector('button')) {
      event.preventDefault(); this.request(item.getAttribute('value') ?? ''); return;
    }
    const orientation = accordionOrientation(this.getAttribute('orientation'));
    const rtl =
      (this.closest('[dir]')?.getAttribute('dir') ?? getComputedStyle(this).direction) === 'rtl';
    // Roving focus visits every enabled trigger across all items.
    const enabled = this.items().flatMap(candidate => this.triggers(candidate)
      .filter(trigger => !this.isDisabled(candidate,trigger))
      .map(trigger => ({item:candidate,trigger})));
    const current = enabled.findIndex(entry => entry.trigger === target);
    const index = rovingIndex(event.key,current,enabled.length,orientation,rtl);
    if (index === null) return;
    const next = enabled[index];
    if (!next) return;
    event.preventDefault(); this.focusControl(next.trigger).focus();
  };
  private request(itemValue: string): void {
    if (itemValue === '' || this.hasAttribute('disabled')) return;
    const next = toggleAccordionValue(this.type,this.value,itemValue,
      this.type === 'single' && this.hasAttribute('collapsible'));
    if (equalAccordionValue(this.type,next,this.value)) return;
    const detail = {value:Array.isArray(next) ? [...next] : next};
    const event = new CustomEvent<AccordionChangeDetail>('af-change',
      {detail,bubbles:true,composed:true,cancelable:true});
    // Only uncontrolled state is kept internally; a canceled event changes nothing.
    if (this.dispatchEvent(event) && !this.propertyControlled && !this.hasAttribute('value'))
      this.selection = next;
    this.sync();
  }
  private sync(): void {
    if (!this.isConnected) return;
    const type = this.type; const value = this.value;
    const orientation = accordionOrientation(this.getAttribute('orientation'));
    for (const item of this.items()) {
      const itemValue = item.getAttribute('value') ?? '';
      const open = itemValue !== '' &&
        (type === 'single' ? value === itemValue : (value as string[]).includes(itemValue));
      const disabled = this.isDisabled(item);
      item.dataset.state = open ? 'open' : 'closed'; item.dataset.orientation = orientation;
      const triggers = this.triggers(item); const contents = this.contents(item);
      for (const content of contents) identifyAccordionPart(content,'content');
      const controlledIds = contents.map(content => content.id).join(' ');
      const labelledByIds: string[] = [];
      for (const trigger of triggers) {
        ensureAccordionChevron(this.focusControl(trigger));
        identifyAccordionPart(trigger,'trigger');
        if (!this.triggerSemantics.has(trigger)) this.triggerSemantics.set(trigger,
          {role:trigger.getAttribute('role'),tabindex:trigger.getAttribute('tabindex')});
        const buttons = [...trigger.querySelectorAll<HTMLButtonElement>('button')].filter(button =>
          button.closest('af-accordion-item') === item && button.closest('af-accordion') === this);
        const triggerDisabled = disabled || trigger.hasAttribute('disabled');
        syncAccordionControls(trigger,buttons,open,triggerDisabled,controlledIds,this.buttonMemory,
          this.triggerSemantics.get(trigger));
        trigger.dataset.state = open ? 'open' : 'closed'; trigger.dataset.orientation = orientation;
        const control = buttons[0] ?? trigger;
        if (control === trigger) identifyAccordionPart(trigger,'trigger');
        else identifyAccordionPart(control,'trigger-control');
        labelledByIds.push(control.id);
      }
      for (const content of contents) syncAccordionContent(content,open,labelledByIds,orientation);
    }
  }
}

export class AfAccordionItem extends HTMLElement {}
export class AfAccordionTrigger extends HTMLElement {}
export class AfAccordionContent extends HTMLElement {}

/** Registration descriptor (tags + stylesheet) applied on import; exported for tests. */
export const accordionComponent: ComponentDescriptor = {
  styleKey: 'af-accordion-styles',
  styles: accordionStyles,
  elements: {
    'af-accordion': AfAccordion,
    'af-accordion-item': AfAccordionItem,
    'af-accordion-trigger': AfAccordionTrigger,
    'af-accordion-content': AfAccordionContent,
  },
};
registerComponent(accordionComponent);
