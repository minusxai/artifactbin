/**
 * <af-select>: dropdown select (single or multiple), searchable, with optional create.
 * Usage: import '@afbin/select';  (registers the tags; this .ts is the readable contract)
 * Props: options (property or JSON attribute; scalars or {value,label} objects), value,
 *   defaultValue / default-value, multiple, allowCreate / allow-create (multiple only), disabled;
 *   attributes label, aria-label, placeholder (single only; shown when nothing is selected).
 * Events: af-change (bubbles, cancelable) with event.detail.value; reflect your Apollo value
 *   back for controlled use.
 * Examples:
 *   const select=document.querySelector('af-select');
 *   select.options=[{value:"a",label:"Alpha"},{value:"b",label:"Beta"}];
 * Gotchas: values stay typed from your options through af-change (2 and '2' differ). Setting
 *   .value makes it controlled: af-change only reports intent until you set it back. Multiple
 *   edits a draft that commits once on Done / outside click, and only if the value did not
 *   change meanwhile. Light DOM; the popup is a manual popover positioned fixed.
 */
import { registerComponent } from './register-component';
import { buildSelectDom, draftCommit, moveHighlight, normalizeOptions, normalizeSelection,
  optionInput, placeSelectPopup, renderSelectOptions, selectStyles, upgradeProperties
} from './select-model';
import type { AfSelectChangeDetail, AfSelectContract, AfSelectOption, AfSelectScalar,
  AfSelectValue } from './select-model';
export type { AfSelectChangeDetail, AfSelectContract, AfSelectOption, AfSelectScalar,
  AfSelectValue } from './select-model';

let nextSelectId = 0;

/** Light DOM picker. Controlled values report intent; uncontrolled values commit accepted
 * intent. */
export class AfSelect extends HTMLElement implements AfSelectContract {
static observedAttributes = ['options', 'value', 'default-value', 'multiple', 'disabled',
    'allow-create', 'label', 'aria-label', 'placeholder'];
  private readonly popupId = `af-select-${++nextSelectId}`;
  private suppliedOptions?: AfSelectOption[];
  private suppliedValue?: AfSelectValue;
  private controlled = false;
  private state: AfSelectValue = null;
  private initial = false;
  private expanded = false;
  private draftStart: AfSelectValue = null;
  private readonly optionIds = new Map<string, string>();
  private nextOptionId = 0;
  private draft: AfSelectScalar[] = [];
  private query = '';
  private highlight = -1;
  private trigger?: HTMLButtonElement;
  private triggerValue?: HTMLSpanElement;
  private labelNode?: HTMLSpanElement;
  private popup?: HTMLDivElement;
  private search?: HTMLInputElement;
  private list?: HTMLDivElement;
  private done?: HTMLButtonElement;
get options(): AfSelectOption[] { return optionInput(this.suppliedOptions ?? this.json<unknown>(
    'options', [])); }
  set options(value: AfSelectOption[]) { this.suppliedOptions = optionInput(value); this.update(); }
get value(): AfSelectValue { return normalizeSelection(this.controlled ? this.suppliedValue :
    this.hasAttribute('value') ? this.json<AfSelectValue>('value', this.getAttribute('value')) :
    this.state, this.multiple); }
set value(value: AfSelectValue) { this.controlled = true; this.suppliedValue = value; this.update();
    }
get defaultValue(): AfSelectValue { return this.json<AfSelectValue>('default-value',
    this.multiple ? [] : null); }
set defaultValue(value: AfSelectValue) { this.setAttribute('default-value', JSON.stringify(value));
    }
  get multiple(): boolean { return this.hasAttribute('multiple'); }
  set multiple(value: boolean) { this.toggleAttribute('multiple', value); }
  get disabled(): boolean { return this.hasAttribute('disabled'); }
  set disabled(value: boolean) { this.toggleAttribute('disabled', value); }
  get allowCreate(): boolean { return this.hasAttribute('allow-create'); }
  set allowCreate(value: boolean) { this.toggleAttribute('allow-create', value); }
private json<T>(name: string, fallback: T): T { try { const raw = this.getAttribute(name);
    return raw === null ? fallback : JSON.parse(raw) as T; } catch { return fallback; } }
  connectedCallback(): void {
upgradeProperties(this, ['options', 'value', 'defaultValue', 'multiple', 'disabled',
      'allowCreate']);
    if (!this.initial) { this.state = this.defaultValue; this.initial = true; }
    this.structure(); this.update();
    this.ownerDocument.addEventListener('pointerdown', this.outside);
    this.ownerDocument.addEventListener('focusin', this.outside);
    this.ownerDocument.defaultView?.addEventListener('resize', this.position);
    this.ownerDocument.addEventListener('scroll', this.position, true);
  }
disconnectedCallback(): void { this.close(false); this.ownerDocument.removeEventListener(
    'pointerdown', this.outside); this.ownerDocument.removeEventListener('focusin', this.outside);
    this.ownerDocument.defaultView?.removeEventListener('resize', this.position);
    this.ownerDocument.removeEventListener('scroll', this.position, true); }
  attributeChangedCallback(): void { if (this.disabled) this.close(false); this.update(); }
private outside = (event: Event): void => { if (!event.composedPath().includes(this)) this.close(
    true); };
  private entries(): {value: AfSelectScalar | null; label: string}[] {
    const entries: { value: AfSelectScalar; label: string }[] = normalizeOptions(this.options);
for (const value of this.draft) if (!entries.some(option => option.value === value)) entries.push({
      value, label: String(value) });
return [...(!this.multiple && this.hasAttribute('placeholder') ? [{ value: null, label:
      this.getAttribute('placeholder')! }] : []), ...entries];
  }
private filtered() { return this.entries().filter(option => option.label.toLocaleLowerCase(
    ).includes(this.query.trim().toLocaleLowerCase())); }
private canCreate(): boolean { return this.multiple && this.allowCreate && !!this.query.trim() &&
    !this.entries().some(option => option.value === this.query.trim()); }
  private structure(): void {
    if (this.trigger) return;
    const dom = buildSelectDom(this.ownerDocument, this.popupId);
    Object.assign(this, dom); this.prepend(dom.labelNode, dom.trigger, dom.popup);
    const { trigger, search, done } = dom;
    trigger.addEventListener('click', () => this.expanded ? this.close(true, true) : this.open());
    trigger.addEventListener('keydown', event => {
if (['ArrowDown', 'ArrowUp'].includes(event.key)) { event.preventDefault(); this.open();
        this.highlight = event.key === 'ArrowDown' ? 0 : this.filtered().length - 1;
        this.renderOptions(); }
else if (event.key.length === 1 && event.key !== ' ' && !event.ctrlKey && !event.metaKey &&
        !event.altKey) { event.preventDefault(); this.open(); this.query += event.key;
        this.highlight = 0; this.update(); }
    });
search.addEventListener('input', () => { this.query = this.search!.value; this.highlight = 0;
      this.renderOptions(); });
    this.addEventListener('keydown', event => {
      if (!this.expanded || (event.target as Element).closest('af-select') !== this) return;
      if (event.key === 'Escape') { event.preventDefault(); this.close(false, true); }
      if (event.target !== this.search) return;
      const count = this.filtered().length + Number(this.canCreate());
      if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
event.preventDefault(); this.highlight = moveHighlight(event.key, this.highlight, count);
        this.renderOptions();
} else if (event.key === 'Enter') { event.preventDefault(); const option = this.filtered()[
        this.highlight]; if (option) this.choose(option.value); else if (this.canCreate(
        )) this.choose(this.query.trim()); }
    });
    done.addEventListener('click', () => this.close(true, true));
  }
private open(): void { if (this.disabled || this.expanded) return; this.expanded = true;
    this.draftStart = Array.isArray(this.value) ? [...this.value] : this.value; this.draft =
    Array.isArray(this.value) ? [...this.value] : []; this.query = ''; this.highlight = -1;
    this.update(); this.search?.focus(); }
private close(commit: boolean, focus = false): void { if (!this.expanded) return; this.expanded =
    false; if (this.multiple && !this.disabled) { const next = draftCommit(this.draftStart,
    this.value, this.draft, commit); if (next) this.commit(next); } this.query = ''; this.update();
    if (focus) this.trigger?.focus(); }
  private commit(value: AfSelectValue): void {
if (!this.dispatchEvent(new CustomEvent<AfSelectChangeDetail>('af-change', { detail: { value },
      bubbles: true, composed: true, cancelable: true }))) return;
    if (!this.controlled && !this.hasAttribute('value')) this.state = value;
  }
  private choose(value: AfSelectScalar | null): void {
    if (this.disabled) return;
if (this.multiple && value !== null) { this.draft = this.draft.includes(value) ? this.draft.filter(
      item => item !== value) : [...this.draft, value]; this.query = ''; this.highlight = -1;
      this.update(); this.search?.focus(); }
    else { this.commit(value); this.close(false, true); }
  }
  private renderOptions(): void {
    if (!this.list) return;
    renderSelectOptions(this.list, this.search, { entries: this.filtered(), multiple: this.multiple,
      draft: this.draft, value: this.value, highlight: this.highlight, query: this.query,
      canCreate: this.canCreate(), choose: value => this.choose(value), idFor: key => {
let id = this.optionIds.get(key); if (!id) { id = `${this.popupId}-option-${++this.nextOptionId}`;
          this.optionIds.set(key, id); }
        return id;
      } });
  }
  private position = (): void => {
    if (!this.expanded || !this.popup || !this.trigger) return;
    const view = this.ownerDocument.defaultView; if (!view) return;
    placeSelectPopup(this.popup, this.trigger, view);
  };
  private update(): void {
if (!this.trigger || !this.labelNode || !this.popup || !this.search || !this.list ||
      !this.done) return;
const label = this.getAttribute('label') ?? ''; const name = this.getAttribute('aria-label') ||
      label;
    this.labelNode.textContent = label; this.labelNode.hidden = !label;
this.trigger.setAttribute('aria-label', name); this.trigger.setAttribute('aria-expanded', String(
      this.expanded)); this.trigger.disabled = this.disabled;
    const values = Array.isArray(this.value) ? this.value : this.value === null ? [] : [this.value];
    this.triggerValue!.toggleAttribute('data-placeholder', !this.multiple && this.value === null);
this.triggerValue!.textContent = values.map(value => this.entries().find(entry =>
      entry.value === value)?.label ?? String(value)).join(', ') || this.getAttribute(
      'placeholder') || 'All';
    this.popup.hidden = !this.expanded;
    if (this.isConnected && typeof this.popup.showPopover === 'function') {
      if (this.expanded && !this.popup.matches(':popover-open')) this.popup.showPopover();
      else if (!this.expanded && this.popup.matches(':popover-open')) this.popup.hidePopover();
} this.search.value = this.query; this.search.setAttribute('aria-label', name ? `Search ${name}` :
      'Search options');
this.list.setAttribute('aria-label', name); this.list.setAttribute('aria-multiselectable', String(
      this.multiple)); this.done.hidden = !this.multiple; this.renderOptions(); this.position();
  }
}
registerComponent({
  styleKey: 'af-select-styles',
  styles: selectStyles,
  elements: { 'af-select': AfSelect },
});
