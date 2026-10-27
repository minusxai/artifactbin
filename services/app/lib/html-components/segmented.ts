/**
 * <af-segmented>: segmented single-choice control.
 * Usage: import '@afbin/segmented';  (registers the tags; this .ts is the readable contract)
 * Props: options (scalars or {value,label} objects; null is labelled "All"), value (typed as
 *   authored), defaultValue / default-value, disabled, orientation (horizontal|vertical), label.
 * Events: af-change (bubbles, cancelable) with event.detail.value.
 * Examples:
 *   document.querySelector('af-segmented').options=["Day","Week","Month"];
 *   <af-segmented label="Range" value="Week"></af-segmented>
 * Gotchas: reflect your Apollo value back for controlled use; options are a property, not an
 *   attribute; the value attribute is a string matched back to the typed option value; label
 *   also becomes the aria-label unless you set aria-label yourself.
 */
import { registerComponent, type ComponentDescriptor } from './register-component';
import {
  createSegmentButton, ensureSegmentedParts, filterSegmentedOptions, isValue, keyOf,
  normalizeSegmentedOptions, ownedSegmentButtons, paintSegmentButton, replayPreUpgradeProperties,
  segmentedKeyIndex, segmentedStyles, segmentedValueFromAttribute, type SegmentedContract,
  type SegmentedOption, type SegmentedValue } from './segmented-model';
export { segmentedStyles } from './segmented-model';
export type { SegmentedContract, SegmentedOption, SegmentedValue } from './segmented-model';

export class AfSegmented extends HTMLElement implements SegmentedContract {
  static observedAttributes =
    ['value', 'default-value', 'disabled', 'orientation', 'label', 'aria-label'];
  private optionValues: readonly (SegmentedValue | SegmentedOption)[] = [];
  private buttons = new Map<string, HTMLButtonElement>();
  private buttonOptions = new WeakMap<HTMLButtonElement, SegmentedOption>();
  private labelNode?: HTMLSpanElement;
  private captionNode?: HTMLSpanElement;
  private optionsNode?: HTMLDivElement;
  private selection: SegmentedValue = null; // Uncontrolled choice.
  private controlled = false;
  private propertyValue: SegmentedValue | undefined;
  private initialized = false;
  // writing* flags mark attribute writes made by the element itself, not by the author.
  private writingValue = false;
  private defaultValueOverride: SegmentedValue = null;
  private hasDefaultValueOverride = false;
  private writingDefaultValue = false;
  private mappedLabel = false;
  private writingMappedLabel = false;
  get options(): readonly (SegmentedValue | SegmentedOption)[] { return this.optionValues; }
  set options(value: readonly (SegmentedValue | SegmentedOption)[]) {
    this.optionValues = filterSegmentedOptions(value);
    this.render();
  }
  get value(): SegmentedValue { return this.currentValue(); }
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
    return this.hasAttribute('default-value') ?
      this.fromAttribute(this.getAttribute('default-value') ?? '') : null;
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
  get orientation(): 'horizontal' | 'vertical' {
    return this.getAttribute('orientation') === 'vertical' ? 'vertical' : 'horizontal'; }
  set orientation(value: 'horizontal' | 'vertical') {
    this.setAttribute('orientation', value === 'vertical' ? 'vertical' : 'horizontal'); }
  connectedCallback(): void {
    replayPreUpgradeProperties(this,
      ['options', 'value', 'defaultValue', 'disabled', 'orientation']);
    if (!this.initialized) { this.selection = this.defaultValue; this.initialized = true; }
    this.addEventListener('click', this.onClick); this.addEventListener('keydown', this.onKeyDown);
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
    return segmentedValueFromAttribute(this.normalized(), raw); }
  private normalized(): SegmentedOption[] { return normalizeSegmentedOptions(this.optionValues); }
  private ensureStructure(): void {
    ({caption:this.captionNode, label:this.labelNode, options:this.optionsNode} =
      ensureSegmentedParts(this,
        {caption:this.captionNode, label:this.labelNode, options:this.optionsNode}));
  }
  private ownedButtons(): HTMLButtonElement[] { return ownedSegmentButtons(this.optionsNode); }
  private syncLabel(): void {
    if (!this.isConnected || this.writingMappedLabel) return;
    const label = this.getAttribute('label');
    if (this.labelNode) {
      this.labelNode.textContent = label ?? ''; this.labelNode.hidden = !label; }
    if (this.captionNode) this.captionNode.hidden = !label;
    if (this.hasAttribute('aria-label') && !this.mappedLabel) return;
    // Mirror label into aria-label, but never overwrite an author-set aria-label.
    if (label !== null) {
      this.writingMappedLabel = true; this.setAttribute('aria-label', label);
      this.writingMappedLabel = false;
      this.mappedLabel = true;
    } else if (this.mappedLabel) {
      this.writingMappedLabel = true; this.removeAttribute('aria-label');
      this.writingMappedLabel = false;
      this.mappedLabel = false;
    }
  }
  private controlledValue(): boolean {
    return this.propertyValue !== undefined || this.hasAttribute('value') || this.controlled; }
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
      if (!button) {
        button = createSegmentButton(this.ownerDocument); this.buttons.set(key, button); }
      paintSegmentButton(button, option, option.value === this.currentValue(), this.disabled,
        option === active);
      this.buttonOptions.set(button, option);
      const desiredAtIndex = this.ownedButtons()[index];
      // Move only out-of-place buttons so focus survives re-renders.
      if (desiredAtIndex !== button) this.optionsNode!.insertBefore(button, desiredAtIndex ?? null);
    });
    for (const [key, button] of this.buttons) {
      if (!validKeys.has(key)) { button.remove(); this.buttons.delete(key); }
    }
  }
  private optionFor(button: Element | null): SegmentedOption | undefined {
    if (!button || button.parentElement !== this.optionsNode ||
      button.closest('af-segmented') !== this) return undefined;
    return this.buttonOptions.get(button as HTMLButtonElement);
  }
  private choose(option: SegmentedOption): void {
    if (this.disabled || option.value === this.currentValue()) return;
    const event = new CustomEvent<{value: SegmentedValue}>('af-change',
      {detail:{value:option.value}, bubbles:true, composed:true, cancelable:true});
    if (this.dispatchEvent(event) && !this.controlledValue()) this.selection = option.value;
    this.render();
  }
  private onClick = (event: Event): void => {
    const target = event.target instanceof Element ?
      event.target.closest('button[data-segment-option]') : null;
    const option = this.optionFor(target); if (option) this.choose(option);
  };
  private onKeyDown = (event: KeyboardEvent): void => {
    const target = event.target instanceof Element ?
      event.target.closest('button[data-segment-option]') : null;
    const current = this.optionFor(target);
    if (!current || this.disabled || event.defaultPrevented) return;
    const options = this.normalized();
    const index = this.ownedButtons().indexOf(target as HTMLButtonElement);
    const rtl =
      (this.closest('[dir]')?.getAttribute('dir') ?? getComputedStyle(this).direction) === 'rtl';
    const next = segmentedKeyIndex(event.key, index, options.length, this.orientation, rtl);
    if (next < 0 || !options[next]) return;
    event.preventDefault(); this.buttons.get(keyOf(options[next]!.value))?.focus();
    this.choose(options[next]!);
  };
}

/** Registration descriptor (tags + stylesheet) applied on import; exported for tests. */
export const segmentedComponent: ComponentDescriptor = {
  styleKey: 'af-segmented-styles', styles: segmentedStyles,
  elements: { 'af-segmented': AfSegmented },
};
registerComponent(segmentedComponent);
