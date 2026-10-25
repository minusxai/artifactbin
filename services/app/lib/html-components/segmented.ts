/** Option values remain typed from the author's options property through af-change. */
export type SegmentedValue = string | number | boolean | null;
export interface SegmentedOption { value: SegmentedValue; label: string }
export interface SegmentedContract {
  value: SegmentedValue;
  defaultValue: SegmentedValue;
  options: readonly (SegmentedValue | SegmentedOption)[];
  disabled: boolean;
  orientation: 'horizontal' | 'vertical';
}

const isValue = (value: unknown): value is SegmentedValue => value === null || typeof value === 'string' || typeof value === 'boolean' || (typeof value === 'number' && Number.isFinite(value));
const keyOf = (value: SegmentedValue): string => `${typeof value}:${String(value)}`;

export class AfSegmented extends HTMLElement implements SegmentedContract {
  static observedAttributes = ['value', 'default-value', 'disabled', 'orientation', 'label', 'aria-label'];
  private optionValues: readonly (SegmentedValue | SegmentedOption)[] = [];
  private buttons = new Map<string, HTMLButtonElement>();
  private buttonOptions = new WeakMap<HTMLButtonElement, SegmentedOption>();
  private labelNode?: HTMLSpanElement;
  private optionsNode?: HTMLDivElement;
  private selection: SegmentedValue = null;
  private controlled = false;
  private propertyValue: SegmentedValue | undefined;
  private initialized = false;
  private writingValue = false;
  private defaultValueOverride: SegmentedValue = null;
  private hasDefaultValueOverride = false;
  private writingDefaultValue = false;
  private mappedLabel = false;
  private writingMappedLabel = false;

  get options(): readonly (SegmentedValue | SegmentedOption)[] { return this.optionValues; }
  set options(value: readonly (SegmentedValue | SegmentedOption)[]) {
    this.optionValues = Array.isArray(value) ? value.filter(item => isValue(item) || (item !== null && typeof item === 'object' && isValue((item as SegmentedOption).value) && typeof (item as SegmentedOption).label === 'string')) : [];
    this.render();
  }
  get value(): SegmentedValue {
    if (this.propertyValue !== undefined) return this.propertyValue;
    if (this.hasAttribute('value')) return this.fromAttribute(this.getAttribute('value') ?? '');
    return this.selection;
  }
  set value(value: SegmentedValue) {
    this.controlled = true;
    this.propertyValue = isValue(value) ? value : null;
    this.writingValue = true;
    this.toggleAttribute('value', this.propertyValue !== null);
    if (this.propertyValue !== null) this.setAttribute('value', String(this.propertyValue));
    this.writingValue = false;
    this.render();
  }
  get defaultValue(): SegmentedValue {
    if (this.hasDefaultValueOverride) return this.defaultValueOverride;
    return this.hasAttribute('default-value') ? this.fromAttribute(this.getAttribute('default-value') ?? '') : null;
  }
  set defaultValue(value: SegmentedValue) {
    this.defaultValueOverride = isValue(value) ? value : null;
    this.hasDefaultValueOverride = true;
    this.writingDefaultValue = true;
    if (this.defaultValueOverride === null) this.setAttribute('default-value', '');
    else this.setAttribute('default-value', String(this.defaultValueOverride));
    this.writingDefaultValue = false;
  }
  get disabled(): boolean { return this.hasAttribute('disabled'); }
  set disabled(value: boolean) { this.toggleAttribute('disabled', Boolean(value)); }
  get orientation(): 'horizontal' | 'vertical' { return this.getAttribute('orientation') === 'vertical' ? 'vertical' : 'horizontal'; }
  set orientation(value: 'horizontal' | 'vertical') { this.setAttribute('orientation', value === 'vertical' ? 'vertical' : 'horizontal'); }

  connectedCallback(): void {
    for (const name of ['options', 'value', 'defaultValue', 'disabled', 'orientation'] as const) {
      if (!Object.prototype.hasOwnProperty.call(this, name)) continue;
      const value = (this as unknown as Record<string, unknown>)[name];
      delete (this as unknown as Record<string, unknown>)[name];
      (this as unknown as Record<string, unknown>)[name] = value;
    }
    if (!this.initialized) { this.selection = this.defaultValue; this.initialized = true; }
    this.addEventListener('click', this.onClick);
    this.addEventListener('keydown', this.onKeyDown);
    this.render();
  }
  disconnectedCallback(): void {
    this.removeEventListener('click', this.onClick);
    this.removeEventListener('keydown', this.onKeyDown);
  }
  attributeChangedCallback(name: string): void {
    if (name === 'value' && !this.writingValue) this.propertyValue = undefined;
    if (name === 'default-value' && !this.writingDefaultValue) this.hasDefaultValueOverride = false;
    if (name === 'aria-label') {
      if (this.writingMappedLabel) return;
      this.mappedLabel = false;
      this.syncLabel();
    }
    this.render();
  }

  private fromAttribute(raw: string): SegmentedValue {
    const match = this.normalized().find(option => String(option.value ?? '') === raw);
    return match?.value ?? (raw === '' && this.normalized().some(option => option.value === null) ? null : raw);
  }
  private normalized(): SegmentedOption[] {
    const unique = new Map<string, SegmentedOption>();
    for (const item of this.optionValues) {
      const option = isValue(item) ? {value:item, label:item === null ? 'All' : String(item)} : item as SegmentedOption;
      if (!unique.has(keyOf(option.value))) unique.set(keyOf(option.value), option);
    }
    return [...unique.values()];
  }
  private ensureStructure(): void {
    this.labelNode ??= [...this.children].find((child): child is HTMLSpanElement =>
      child instanceof HTMLSpanElement && child.classList.contains('af-segmented-label'));
    if (!this.labelNode) {
      this.labelNode = this.ownerDocument.createElement('span');
      this.labelNode.className = 'af-segmented-label';
      this.labelNode.dataset.afControlLabel = '';
    }
    this.optionsNode ??= [...this.children].find((child): child is HTMLDivElement =>
      child instanceof HTMLDivElement && child.hasAttribute('data-segment-options'));
    if (!this.optionsNode) {
      this.optionsNode = this.ownerDocument.createElement('div');
      this.optionsNode.className = 'af-segmented-options';
      this.optionsNode.setAttribute('data-segment-options', '');
    }
    if (this.labelNode.parentElement !== this || this.labelNode.nextElementSibling !== this.optionsNode) {
      this.insertBefore(this.labelNode, this.optionsNode.parentElement === this ? this.optionsNode : null);
    }
    if (this.optionsNode.parentElement !== this) this.append(this.optionsNode);
  }
  private ownedButtons(): HTMLButtonElement[] {
    return this.optionsNode ? [...this.optionsNode.children].filter((node): node is HTMLButtonElement =>
      node instanceof HTMLButtonElement && node.hasAttribute('data-segment-option')) : [];
  }
  private syncLabel(): void {
    if (!this.isConnected || this.writingMappedLabel) return;
    const label = this.getAttribute('label');
    if (this.labelNode) {
      this.labelNode.textContent = label ?? '';
      this.labelNode.hidden = !label;
    }
    if (this.hasAttribute('aria-label') && !this.mappedLabel) return;
    if (label !== null) {
      this.writingMappedLabel = true; this.setAttribute('aria-label', label); this.writingMappedLabel = false;
      this.mappedLabel = true;
    } else if (this.mappedLabel) {
      this.writingMappedLabel = true; this.removeAttribute('aria-label'); this.writingMappedLabel = false;
      this.mappedLabel = false;
    }
  }
  private controlledValue(): boolean { return this.propertyValue !== undefined || this.hasAttribute('value') || this.controlled; }
  private currentValue(): SegmentedValue {
    if (this.propertyValue !== undefined) return this.propertyValue;
    if (this.hasAttribute('value')) return this.fromAttribute(this.getAttribute('value') ?? '');
    return this.selection;
  }
  private render(): void {
    if (!this.isConnected) return;
    this.ensureStructure();
    this.setAttribute('role', 'group');
    this.syncLabel();
    this.dataset.orientation = this.orientation;
    this.dataset.disabled = String(this.disabled);
    const normalized = this.normalized();
    const active = normalized.find(option => option.value === this.currentValue()) ?? normalized[0];
    const validKeys = new Set<string>();
    normalized.forEach((option, index) => {
      const key = keyOf(option.value); validKeys.add(key);
      let button = this.buttons.get(key);
      if (!button) { button = this.ownerDocument.createElement('button'); button.type = 'button'; button.dataset.segmentOption = ''; this.buttons.set(key, button); }
      button.textContent = option.label; button.disabled = this.disabled;
      button.setAttribute('aria-pressed', String(option.value === this.currentValue()));
      button.tabIndex = !this.disabled && option === active ? 0 : -1;
      button.dataset.state = option.value === this.currentValue() ? 'active' : 'inactive';
      button.dataset.value = String(option.value ?? '');
      this.buttonOptions.set(button, option);
      const owned = this.ownedButtons();
      const desiredAtIndex = owned[index];
      if (desiredAtIndex !== button) this.optionsNode!.insertBefore(button, desiredAtIndex ?? null);
    });
    for (const [key, button] of this.buttons) if (!validKeys.has(key)) { button.remove(); this.buttons.delete(key); }
  }
  private optionFor(button: Element | null): SegmentedOption | undefined {
    if (!button || button.parentElement !== this.optionsNode || button.closest('af-segmented') !== this) return undefined;
    return this.buttonOptions.get(button as HTMLButtonElement);
  }
  private choose(option: SegmentedOption): void {
    if (this.disabled || option.value === this.currentValue()) return;
    const event = new CustomEvent<{value: SegmentedValue}>('af-change', {detail:{value:option.value}, bubbles:true, composed:true, cancelable:true});
    if (this.dispatchEvent(event) && !this.controlledValue()) this.selection = option.value;
    this.render();
  }
  private onClick = (event: Event): void => {
    const target = event.target instanceof Element ? event.target.closest('button[data-segment-option]') : null;
    const option = this.optionFor(target); if (option) this.choose(option);
  };
  private onKeyDown = (event: KeyboardEvent): void => {
    const target = event.target instanceof Element ? event.target.closest('button[data-segment-option]') : null;
    const current = this.optionFor(target); if (!current || this.disabled || event.defaultPrevented) return;
    const options = this.normalized(); const index = this.ownedButtons().indexOf(target as HTMLButtonElement);
    const rtl = (this.closest('[dir]')?.getAttribute('dir') ?? getComputedStyle(this).direction) === 'rtl';
    const forward = this.orientation === 'vertical' ? 'ArrowDown' : rtl ? 'ArrowLeft' : 'ArrowRight';
    const backward = this.orientation === 'vertical' ? 'ArrowUp' : rtl ? 'ArrowRight' : 'ArrowLeft';
    let next = -1;
    if (event.key === forward) next = (index + 1) % options.length;
    else if (event.key === backward) next = (index - 1 + options.length) % options.length;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = options.length - 1;
    if (next < 0 || !options[next]) return;
    event.preventDefault(); this.buttons.get(keyOf(options[next]!.value))?.focus(); this.choose(options[next]!);
  };
}

export const segmentedStyles = `
af-segmented{display:inline-flex;vertical-align:top;flex-direction:column;align-items:flex-start;gap:.375rem;width:fit-content;box-sizing:border-box;color:inherit;font:inherit}
af-segmented .af-segmented-label{font-family:inherit;font-size:11px;font-weight:500;line-height:1.5;letter-spacing:.05em;text-transform:uppercase;color:var(--muted-foreground,#666)}
af-segmented .af-segmented-label[hidden]{display:none!important}
af-segmented .af-segmented-options{display:inline-flex;align-items:center;gap:.125rem;width:fit-content;box-sizing:border-box;border:1px solid var(--input,#ddd);border-radius:var(--radius-md,calc(var(--radius,.625rem) - 2px));padding:.125rem;background:color-mix(in srgb,var(--muted,#eee) 40%,transparent);box-shadow:0 1px 2px #0000000d}
af-segmented[data-orientation=vertical] .af-segmented-options{flex-direction:column;align-items:stretch}
af-segmented .af-segmented-options>button[data-segment-option]{position:relative;box-sizing:border-box;height:2rem;cursor:pointer;border:0;border-radius:5px;padding:0 .75rem;background:transparent;color:var(--muted-foreground,#555);font:inherit;font-size:.875rem;transition:background-color .15s,color .15s}
af-segmented .af-segmented-options>button[data-segment-option][data-state=active]{background:var(--primary,#222);color:var(--primary-foreground,#fff);box-shadow:0 1px 2px #0000000d}
af-segmented .af-segmented-options>button[data-segment-option]:not([data-state=active]):hover{background:color-mix(in srgb,var(--foreground,#222) 10%,transparent);color:var(--foreground,#222)}
af-segmented .af-segmented-options>button[data-segment-option]:focus-visible{z-index:1;outline:2px solid transparent;outline-offset:2px;box-shadow:0 0 0 2px color-mix(in oklab,var(--ring,#777) 50%,transparent),0 1px 2px #0000000d}
af-segmented .af-segmented-options>button[data-segment-option]:disabled{cursor:not-allowed;opacity:.5}
`;
export function registerSegmented(registry: CustomElementRegistry = customElements, document: Document = globalThis.document): void {
  if (!document.querySelector('style[data-af-segmented-styles]')) {
    const style = document.createElement('style'); style.setAttribute('data-af-segmented-styles', ''); style.textContent = segmentedStyles; document.head.append(style);
  }
  if (!registry.get('af-segmented')) registry.define('af-segmented', AfSegmented);
}
