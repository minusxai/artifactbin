import {
  equalAccordionValue,
  normalizeAccordionValue,
  toggleAccordionValue,
  type AccordionChangeDetail,
  type AccordionContract,
  type AccordionType,
  type AccordionValue,
} from './accordion-model';

let nextId = 0;
function typeOf(value: string | null): AccordionType { return value === 'multiple' ? 'multiple' : 'single'; }
function parseAttribute(raw: string, type: AccordionType): AccordionValue {
  if (type === 'multiple' && raw.trim().startsWith('[')) {
    try {
      const parsed: unknown = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.every(value => typeof value === 'string')) return normalizeAccordionValue(type,parsed as string[]);
    } catch { /* A plain string remains a valid one-item default. */ }
  }
  return normalizeAccordionValue(type,raw);
}

export class AfAccordion extends HTMLElement implements AccordionContract {
  static observedAttributes = ['type','value','default-value','collapsible','disabled','orientation'];
  private selection: AccordionValue = '';
  private initialized = false;
  private propertyControlled = false;
  private propertyValue: AccordionValue = '';
  private triggerSemantics = new WeakMap<AfAccordionTrigger,{role:string | null; tabindex:string | null}>();
  private nativeButtonDisabled = new WeakMap<HTMLButtonElement,boolean>();
  private disabledNativeButtons = new WeakSet<HTMLButtonElement>();
  private observer = new MutationObserver(() => this.sync());

  get value(): AccordionValue {
    const type = this.type;
    if (this.propertyControlled) return normalizeAccordionValue(type,this.propertyValue);
    if (this.hasAttribute('value')) return parseAttribute(this.getAttribute('value') ?? '',type);
    return normalizeAccordionValue(type,this.selection);
  }
  set value(value: AccordionValue) {
    this.propertyControlled = true;
    this.propertyValue = value;
    this.sync();
  }
  get type(): AccordionType { return typeOf(this.getAttribute('type')); }

  connectedCallback(): void {
    if (Object.prototype.hasOwnProperty.call(this,'value')) {
      const value = this.value;
      delete (this as {value?: AccordionValue}).value;
      this.value = value;
    }
    if (!this.initialized) {
      this.selection = this.hasAttribute('default-value') ? parseAttribute(this.getAttribute('default-value') ?? '',this.type) : (this.type === 'multiple' ? [] : '');
      this.initialized = true;
    }
    this.addEventListener('click',this.onClick);
    this.addEventListener('keydown',this.onKeydown);
    this.observer.observe(this,{childList:true,subtree:true,attributes:true,attributeFilter:['disabled','value','id']});
    this.sync();
  }

  disconnectedCallback(): void {
    this.observer.disconnect();
    this.removeEventListener('click',this.onClick);
    this.removeEventListener('keydown',this.onKeydown);
  }

  attributeChangedCallback(): void { this.sync(); }

  private items(): AfAccordionItem[] {
    return [...this.querySelectorAll<AfAccordionItem>('af-accordion-item')].filter(item => item.closest('af-accordion') === this);
  }
  private ownParts<T extends HTMLElement>(item: AfAccordionItem,selector: string): T[] {
    return [...item.querySelectorAll<T>(selector)].filter(node => node.closest('af-accordion-item') === item && node.closest('af-accordion') === this);
  }
  private triggers(item: AfAccordionItem): AfAccordionTrigger[] { return this.ownParts(item,'af-accordion-trigger'); }
  private contents(item: AfAccordionItem): AfAccordionContent[] { return this.ownParts(item,'af-accordion-content'); }
  private itemForTrigger(trigger: AfAccordionTrigger): AfAccordionItem | undefined {
    const item = trigger.closest<AfAccordionItem>('af-accordion-item');
    return item?.closest('af-accordion') === this ? item : undefined;
  }
  private focusControl(trigger: AfAccordionTrigger): HTMLElement {
    const item = trigger.closest<AfAccordionItem>('af-accordion-item');
    if (!item) return trigger;
    return this.ownParts<HTMLButtonElement>(item,'af-accordion-trigger button').find(button => button.closest('af-accordion-trigger') === trigger) ?? trigger;
  }
  private isDisabled(item: AfAccordionItem, trigger?: AfAccordionTrigger): boolean {
    const buttons = trigger ? [...trigger.querySelectorAll<HTMLButtonElement>('button')] : [];
    const nativeDisabled = buttons.length > 0 && buttons.every(button => button.disabled);
    const missingValue = item.getAttribute('value') == null || item.getAttribute('value') === '';
    return this.hasAttribute('disabled') || item.hasAttribute('disabled') || Boolean(trigger?.hasAttribute('disabled')) || nativeDisabled || missingValue;
  }

  private onClick = (event: Event): void => {
    const target = event.target instanceof Element ? event.target.closest<AfAccordionTrigger>('af-accordion-trigger') : null;
    if (!target || target.closest('af-accordion') !== this || event.defaultPrevented) return;
    const item = this.itemForTrigger(target); const value = item?.getAttribute('value');
    const nativeButton = event.target instanceof Element ? event.target.closest('button') : null;
    if (!item || value == null || value === '' || this.isDisabled(item,target) || nativeButton?.disabled) return;
    this.request(value);
  };

  private onKeydown = (event: KeyboardEvent): void => {
    const target = event.target instanceof Element ? event.target.closest<AfAccordionTrigger>('af-accordion-trigger') : null;
    if (!target || target.closest('af-accordion') !== this || event.defaultPrevented) return;
    const item = this.itemForTrigger(target);
    const nativeButton = event.target instanceof Element ? event.target.closest('button') : null;
    if (!item || this.isDisabled(item,target) || nativeButton?.disabled) return;
    if ((event.key === 'Enter' || event.key === ' ') && event.target === target && !target.querySelector('button')) {
      event.preventDefault(); this.request(item.getAttribute('value') ?? ''); return;
    }
    const orientation = this.getAttribute('orientation') === 'horizontal' ? 'horizontal' : 'vertical';
    const rtl = (this.closest('[dir]')?.getAttribute('dir') ?? getComputedStyle(this).direction) === 'rtl';
    const forward = orientation === 'vertical' ? 'ArrowDown' : rtl ? 'ArrowLeft' : 'ArrowRight';
    const backward = orientation === 'vertical' ? 'ArrowUp' : rtl ? 'ArrowRight' : 'ArrowLeft';
    const enabled = this.items().flatMap(candidate => this.triggers(candidate).filter(trigger => !this.isDisabled(candidate,trigger)).map(trigger => ({item:candidate,trigger})));
    let index = enabled.findIndex(entry => entry.trigger === target);
    if (event.key === 'Home') index = 0;
    else if (event.key === 'End') index = enabled.length - 1;
    else if (event.key === forward || event.key === backward) index = (index + (event.key === forward ? 1 : -1) + enabled.length) % enabled.length;
    else return;
    const next = enabled[index];
    if (!next) return;
    event.preventDefault(); this.focusControl(next.trigger).focus();
  };

  private request(itemValue: string): void {
    if (itemValue === '' || this.hasAttribute('disabled')) return;
    const next = toggleAccordionValue(this.type,this.value,itemValue,this.type === 'single' && this.hasAttribute('collapsible'));
    if (equalAccordionValue(this.type,next,this.value)) return;
    const event = new CustomEvent<AccordionChangeDetail>('af-change',{detail:{value:Array.isArray(next) ? [...next] : next},bubbles:true,composed:true,cancelable:true});
    if (this.dispatchEvent(event) && !this.propertyControlled && !this.hasAttribute('value')) this.selection = next;
    this.sync();
  }

  private identify(node: HTMLElement,kind: string): void {
    if (node.id) return;
    let id: string;
    do { id = `af-accordion-${kind}-${++nextId}`; } while (this.ownerDocument.getElementById(id));
    node.id = id;
  }

  private ensureChevron(trigger: AfAccordionTrigger): void {
    const control = this.focusControl(trigger);
    if (control.querySelector(':scope > svg[data-af-accordion-icon]')) return;
    const svg = this.ownerDocument.createElementNS('http://www.w3.org/2000/svg','svg');
    svg.setAttribute('viewBox','0 0 24 24'); svg.setAttribute('fill','none'); svg.setAttribute('stroke','currentColor');
    svg.setAttribute('stroke-width','2'); svg.setAttribute('stroke-linecap','round'); svg.setAttribute('stroke-linejoin','round');
    svg.setAttribute('aria-hidden','true'); svg.setAttribute('data-af-accordion-icon','');
    svg.classList.add('af-accordion-icon');
    const path = this.ownerDocument.createElementNS('http://www.w3.org/2000/svg','path');
    path.setAttribute('d','m6 9 6 6 6-6'); svg.append(path); control.append(svg);
  }

  private sync(): void {
    if (!this.isConnected) return;
    const type = this.type; const value = this.value; const orientation = this.getAttribute('orientation') === 'horizontal' ? 'horizontal' : 'vertical';
    for (const item of this.items()) {
      const itemValue = item.getAttribute('value') ?? '';
      const open = itemValue !== '' && (type === 'single' ? value === itemValue : (value as string[]).includes(itemValue));
      const disabled = this.isDisabled(item);
      item.dataset.state = open ? 'open' : 'closed'; item.dataset.orientation = orientation;
      const triggers = this.triggers(item); const contents = this.contents(item);
      for (const content of contents) this.identify(content,'content');
      const controlledIds = contents.map(content => content.id).join(' ');
      const labelledByIds: string[] = [];
      for (const trigger of triggers) {
        this.ensureChevron(trigger);
        this.identify(trigger,'trigger');
        if (!this.triggerSemantics.has(trigger)) this.triggerSemantics.set(trigger,{role:trigger.getAttribute('role'),tabindex:trigger.getAttribute('tabindex')});
        const buttons = [...trigger.querySelectorAll<HTMLButtonElement>('button')].filter(button => button.closest('af-accordion-item') === item && button.closest('af-accordion') === this);
        const triggerDisabled = disabled || trigger.hasAttribute('disabled');
        if (buttons.length) {
          trigger.removeAttribute('role'); trigger.removeAttribute('tabindex');
          trigger.removeAttribute('aria-expanded'); trigger.removeAttribute('aria-controls'); trigger.removeAttribute('aria-disabled');
          for (const button of buttons) {
            if (triggerDisabled) {
              if (!this.disabledNativeButtons.has(button)) this.nativeButtonDisabled.set(button,button.hasAttribute('disabled'));
              if (!button.hasAttribute('disabled')) button.setAttribute('disabled','');
              this.disabledNativeButtons.add(button);
            } else if (this.disabledNativeButtons.has(button)) {
              if (this.nativeButtonDisabled.get(button)) { if (!button.hasAttribute('disabled')) button.setAttribute('disabled',''); }
              else if (button.hasAttribute('disabled')) button.removeAttribute('disabled');
              this.disabledNativeButtons.delete(button); this.nativeButtonDisabled.delete(button);
            }
            button.setAttribute('aria-expanded',String(open));
            button.setAttribute('aria-disabled',String(triggerDisabled || button.disabled));
            if (controlledIds) button.setAttribute('aria-controls',controlledIds); else button.removeAttribute('aria-controls');
          }
        } else {
          const semantics = this.triggerSemantics.get(trigger);
          trigger.setAttribute('role','button'); trigger.setAttribute('aria-expanded',String(open));
          trigger.setAttribute('aria-disabled',String(triggerDisabled));
          if (controlledIds) trigger.setAttribute('aria-controls',controlledIds); else trigger.removeAttribute('aria-controls');
          if (triggerDisabled) trigger.tabIndex = -1;
          else if (semantics?.tabindex === null) trigger.tabIndex = 0;
          else if (semantics?.tabindex !== undefined) trigger.setAttribute('tabindex',semantics.tabindex);
        }
        trigger.dataset.state = open ? 'open' : 'closed'; trigger.dataset.orientation = orientation;
        const control = buttons[0] ?? trigger;
        if (control === trigger) this.identify(trigger,'trigger'); else this.identify(control,'trigger-control');
        labelledByIds.push(control.id);
      }
      for (const content of contents) {
        if (labelledByIds.length) content.setAttribute('aria-labelledby',labelledByIds.join(' ')); else content.removeAttribute('aria-labelledby');
        content.setAttribute('role','region'); content.hidden = !open; content.toggleAttribute('inert',!open);
        content.dataset.state = open ? 'open' : 'closed'; content.dataset.orientation = orientation;
      }
    }
  }
}

export class AfAccordionItem extends HTMLElement {}
export class AfAccordionTrigger extends HTMLElement {}
export class AfAccordionContent extends HTMLElement {}

export const accordionStyles = `
af-accordion{display:block}
af-accordion-item{display:block;border-bottom:1px solid currentColor}
af-accordion-trigger{box-sizing:border-box;display:flex;align-items:flex-start;justify-content:space-between;gap:1rem;width:100%;padding:1rem 0;text-align:left;font:inherit;font-family:var(--font-display,inherit);font-size:.875rem;font-weight:500;line-height:1.25rem;border-radius:var(--radius-md,calc(var(--radius,.625rem) - 2px));color:inherit;cursor:pointer}
af-accordion-trigger:has(>button){display:contents}
af-accordion-trigger>button{box-sizing:border-box;display:flex;align-items:flex-start;justify-content:space-between;gap:1rem;width:100%;padding:1rem 0;text-align:left!important;font:inherit;font-family:var(--font-display,inherit);font-size:.875rem;font-weight:500;line-height:1.25rem;border:0;border-radius:var(--radius-md,calc(var(--radius,.625rem) - 2px));background:transparent;color:inherit;cursor:pointer}
af-accordion-trigger>.af-accordion-icon,af-accordion-trigger button>.af-accordion-icon{pointer-events:none;flex:none;width:1rem;height:1rem;transform:translateY(.125rem);color:var(--muted-foreground,currentColor);transition:transform .2s}
af-accordion-trigger[aria-expanded="true"]>.af-accordion-icon,af-accordion-trigger button[aria-expanded="true"]>.af-accordion-icon{transform:translateY(.125rem) rotate(180deg)}
af-accordion-trigger:focus-visible,af-accordion-trigger>button:focus-visible{outline:2px solid transparent;outline-offset:2px;box-shadow:0 0 0 3px color-mix(in oklab,var(--ring,#777) 50%,transparent)}
af-accordion-trigger[aria-disabled=true],af-accordion-trigger>button[aria-disabled=true],af-accordion-trigger>button:disabled{opacity:.5;cursor:default}
af-accordion-content{display:block;overflow:hidden;font-size:.875rem;line-height:1.25rem}
af-accordion-content[hidden]{display:none!important}
`;

export function registerAccordion(registry: CustomElementRegistry = customElements,document: Document = globalThis.document): void {
  if (!document.querySelector('style[data-af-accordion-styles]')) {
    const style=document.createElement('style'); style.setAttribute('data-af-accordion-styles',''); style.textContent=accordionStyles; document.head.append(style);
  }
  for (const [name,ctor] of Object.entries({'af-accordion':AfAccordion,'af-accordion-item':AfAccordionItem,'af-accordion-trigger':AfAccordionTrigger,'af-accordion-content':AfAccordionContent})) {
    if (!registry.get(name)) registry.define(name,ctor);
  }
}
