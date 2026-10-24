/** Author-owned open state. The element emits intent and never persists viewer state. */
export interface CollapsibleChangeDetail { value: boolean }
export interface CollapsibleContract { open: boolean }

let nextId = 0;

export class AfCollapsible extends HTMLElement implements CollapsibleContract {
  static observedAttributes = ['open', 'disabled'];
  private expanded = false;
  private initialized = false;
  private propertyControlled = false;
  private propertyValue = false;
  private triggerTabStops = new WeakMap<AfCollapsibleTrigger, string | null>();
  private observer = new MutationObserver(() => this.sync());

  get open(): boolean { return this.propertyControlled ? this.propertyValue : this.hasAttribute('open') || (!this.hasAttribute('open') && this.expanded); }
  set open(value: boolean) {
    this.propertyControlled = true;
    this.propertyValue = Boolean(value);
    this.sync();
  }

  connectedCallback(): void {
    if (Object.prototype.hasOwnProperty.call(this, 'open')) {
      const value = this.open;
      delete (this as {open?: boolean}).open;
      this.open = value;
    }
    if (!this.initialized) {
      this.expanded = this.hasAttribute('default-open');
      this.initialized = true;
    }
    this.addEventListener('click', this.onClick);
    this.addEventListener('keydown', this.onKeydown);
    this.observer.observe(this, {childList:true, subtree:true, attributes:true, attributeFilter:['open','disabled','id']});
    this.sync();
  }

  disconnectedCallback(): void {
    this.observer.disconnect();
    this.removeEventListener('click', this.onClick);
    this.removeEventListener('keydown', this.onKeydown);
  }

  attributeChangedCallback(): void { this.sync(); }

  private own<T extends HTMLElement>(selector: string): T[] {
    return [...this.querySelectorAll<T>(selector)].filter(node => node.closest('af-collapsible') === this);
  }

  private triggerTarget(event: Event): AfCollapsibleTrigger | undefined {
    const target = event.target instanceof Element ? event.target.closest<AfCollapsibleTrigger>('af-collapsible-trigger') : null;
    return target?.closest('af-collapsible') === this ? target : undefined;
  }

  private request(value: boolean): void {
    if (this.hasAttribute('disabled') || value === this.open) return;
    const event = new CustomEvent<CollapsibleChangeDetail>('af-change', {detail:{value}, bubbles:true, composed:true, cancelable:true});
    if (this.dispatchEvent(event) && !this.propertyControlled && !this.hasAttribute('open')) this.expanded = value;
    this.sync();
  }

  private onClick = (event: Event): void => {
    const trigger = this.triggerTarget(event);
    if (trigger && !event.defaultPrevented && !this.hasAttribute('disabled') && !trigger.hasAttribute('disabled')) this.request(!this.open);
  };

  private onKeydown = (event: KeyboardEvent): void => {
    const trigger = this.triggerTarget(event);
    // Native descendant controls synthesize their own click from Enter/Space.
    if (!trigger || event.target !== trigger || event.defaultPrevented || this.hasAttribute('disabled') || trigger.hasAttribute('disabled')) return;
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    this.request(!this.open);
  };

  private identify(node: HTMLElement, kind: string): void {
    if (node.id) return;
    let id: string;
    do { id = `af-collapsible-${kind}-${++nextId}`; } while (this.ownerDocument.getElementById(id));
    node.id = id;
  }

  private sync(): void {
    if (!this.isConnected) return;
    const open = this.open;
    const disabled = this.hasAttribute('disabled');
    const triggers = this.own<AfCollapsibleTrigger>('af-collapsible-trigger');
    const contents = this.own<AfCollapsibleContent>('af-collapsible-content');
    const content = contents[0];
    if (content) this.identify(content, 'content');
    for (const trigger of triggers) {
      this.identify(trigger, 'trigger');
      if (!this.triggerTabStops.has(trigger)) this.triggerTabStops.set(trigger, trigger.getAttribute('tabindex'));
      trigger.setAttribute('role','button');
      trigger.setAttribute('aria-expanded',String(open));
      trigger.setAttribute('aria-disabled',String(disabled || trigger.hasAttribute('disabled')));
      if (content) trigger.setAttribute('aria-controls',content.id); else trigger.removeAttribute('aria-controls');
      const authoredTabindex = this.triggerTabStops.get(trigger);
      if (disabled || trigger.hasAttribute('disabled')) trigger.tabIndex = -1;
      else if (authoredTabindex === null) trigger.tabIndex = 0;
      else if (authoredTabindex !== undefined) trigger.setAttribute('tabindex',authoredTabindex);
      trigger.dataset.state = open ? 'open' : 'closed';
    }
    for (const panel of contents) {
      panel.hidden = !open;
      panel.toggleAttribute('inert',!open);
      panel.dataset.state = open ? 'open' : 'closed';
    }
  }
}

export class AfCollapsibleTrigger extends HTMLElement {}
export class AfCollapsibleContent extends HTMLElement {}

export const collapsibleStyles = `
af-collapsible{display:block}
af-collapsible-trigger{box-sizing:border-box;display:inline-flex;align-items:center;justify-content:center;gap:.5rem;cursor:pointer;font-family:inherit;color:inherit}
af-collapsible-trigger:focus-visible{outline:2px solid color-mix(in srgb,var(--ring,#777) 50%,transparent);outline-offset:2px}
af-collapsible-trigger[aria-disabled=true]{opacity:.5;cursor:default}
af-collapsible-content{display:block;overflow:hidden}
af-collapsible-content[hidden]{display:none!important}
`;

export function registerCollapsible(registry: CustomElementRegistry = customElements, document: Document = globalThis.document): void {
  if (!document.querySelector('style[data-af-collapsible-styles]')) {
    const style = document.createElement('style'); style.setAttribute('data-af-collapsible-styles','');
    style.textContent = collapsibleStyles; document.head.append(style);
  }
  for (const [name, ctor] of Object.entries({'af-collapsible':AfCollapsible, 'af-collapsible-trigger':AfCollapsibleTrigger, 'af-collapsible-content':AfCollapsibleContent})) {
    if (!registry.get(name)) registry.define(name,ctor);
  }
}
