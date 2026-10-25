import { draftCommit, normalizeOptions, normalizeSelection, optionInput, selectKey } from './select-model';
export type AfSelectScalar = string | number | boolean;
export type AfSelectValue = AfSelectScalar | null | AfSelectScalar[];
export type AfSelectOption = AfSelectScalar | { value: AfSelectScalar; label: string };
export interface AfSelectChangeDetail { value: AfSelectValue }
export interface AfSelectContract {
  options: AfSelectOption[];
  value: AfSelectValue;
  defaultValue: AfSelectValue;
  multiple: boolean;
  disabled: boolean;
  allowCreate: boolean;
}

let nextSelectId = 0;

/** Light DOM picker. Controlled values report intent; uncontrolled values commit accepted intent. */
export class AfSelect extends HTMLElement implements AfSelectContract {
  static observedAttributes = ['options', 'value', 'default-value', 'multiple', 'disabled', 'allow-create', 'label', 'aria-label', 'placeholder'];
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
  private chevron?: SVGSVGElement;
  private labelNode?: HTMLSpanElement;
  private popup?: HTMLDivElement;
  private search?: HTMLInputElement;
  private list?: HTMLDivElement;
  private done?: HTMLButtonElement;
  get options(): AfSelectOption[] { return optionInput(this.suppliedOptions ?? this.json<unknown>('options', [])); }
  set options(value: AfSelectOption[]) { this.suppliedOptions = optionInput(value); this.update(); }
  get value(): AfSelectValue { return normalizeSelection(this.controlled ? this.suppliedValue : this.hasAttribute('value') ? this.json<AfSelectValue>('value', this.getAttribute('value')) : this.state, this.multiple); }
  set value(value: AfSelectValue) { this.controlled = true; this.suppliedValue = value; this.update(); }
  get defaultValue(): AfSelectValue { return this.json<AfSelectValue>('default-value', this.multiple ? [] : null); }
  set defaultValue(value: AfSelectValue) { this.setAttribute('default-value', JSON.stringify(value)); }
  get multiple(): boolean { return this.hasAttribute('multiple'); }
  set multiple(value: boolean) { this.toggleAttribute('multiple', value); }
  get disabled(): boolean { return this.hasAttribute('disabled'); }
  set disabled(value: boolean) { this.toggleAttribute('disabled', value); }
  get allowCreate(): boolean { return this.hasAttribute('allow-create'); }
  set allowCreate(value: boolean) { this.toggleAttribute('allow-create', value); }
  private json<T>(name: string, fallback: T): T { try { const raw = this.getAttribute(name); return raw === null ? fallback : JSON.parse(raw) as T; } catch { return fallback; } }
  connectedCallback(): void {
    for (const name of ['options', 'value', 'defaultValue', 'multiple', 'disabled', 'allowCreate'] as const) {
      if (Object.hasOwn(this, name)) { const value = this[name]; delete (this as unknown as Record<string, unknown>)[name]; (this as unknown as Record<string, unknown>)[name] = value; }
    }
    if (!this.initial) { this.state = this.defaultValue; this.initial = true; }
    this.structure(); this.update();
    this.ownerDocument.addEventListener('pointerdown', this.outside);
    this.ownerDocument.addEventListener('focusin', this.outside);
    this.ownerDocument.defaultView?.addEventListener('resize', this.position);
    this.ownerDocument.addEventListener('scroll', this.position, true);
  }
  disconnectedCallback(): void { this.close(false); this.ownerDocument.removeEventListener('pointerdown', this.outside); this.ownerDocument.removeEventListener('focusin', this.outside); this.ownerDocument.defaultView?.removeEventListener('resize', this.position); this.ownerDocument.removeEventListener('scroll', this.position, true); }
  attributeChangedCallback(): void { if (this.disabled) this.close(false); this.update(); }
  private outside = (event: Event): void => { if (!event.composedPath().includes(this)) this.close(true); };
  private entries(): {value: AfSelectScalar | null; label: string}[] {
    const entries: { value: AfSelectScalar; label: string }[] = normalizeOptions(this.options);
    for (const value of this.draft) if (!entries.some(option => option.value === value)) entries.push({ value, label: String(value) });
    return [...(!this.multiple && this.hasAttribute('placeholder') ? [{ value: null, label: this.getAttribute('placeholder')! }] : []), ...entries];
  }
  private filtered() { return this.entries().filter(option => option.label.toLocaleLowerCase().includes(this.query.trim().toLocaleLowerCase())); }
  private canCreate(): boolean { return this.multiple && this.allowCreate && !!this.query.trim() && !this.entries().some(option => option.value === this.query.trim()); }
  private structure(): void {
    if (this.trigger) return;
    const doc = this.ownerDocument;
    this.labelNode = doc.createElement('span'); this.labelNode.className = 'af-select-label';
    this.trigger = doc.createElement('button'); this.trigger.type = 'button'; this.trigger.className = 'af-select-trigger'; this.trigger.setAttribute('aria-haspopup', 'listbox');
    this.triggerValue = doc.createElement('span'); this.triggerValue.className = 'af-select-value';
    this.chevron = doc.createElementNS('http://www.w3.org/2000/svg', 'svg');
    this.chevron.setAttribute('viewBox', '0 0 24 24'); this.chevron.setAttribute('fill', 'none'); this.chevron.setAttribute('stroke', 'currentColor');
    this.chevron.setAttribute('stroke-width', '2'); this.chevron.setAttribute('stroke-linecap', 'round'); this.chevron.setAttribute('stroke-linejoin', 'round');
    this.chevron.setAttribute('aria-hidden', 'true'); this.chevron.setAttribute('focusable', 'false'); this.chevron.setAttribute('part', 'chevron'); this.chevron.classList.add('af-select-chevron');
    const chevronPath = doc.createElementNS('http://www.w3.org/2000/svg', 'path'); chevronPath.setAttribute('d', 'm6 9 6 6 6-6'); this.chevron.append(chevronPath);
    this.trigger.append(this.triggerValue, this.chevron);
    this.popup = doc.createElement('div'); this.popup.dataset.popup = ''; this.popup.setAttribute('popover', 'manual'); this.popup.className = 'af-select-popup';
    this.search = doc.createElement('input'); this.search.type = 'text'; this.search.setAttribute('role', 'searchbox'); this.search.placeholder = 'Type to filter…';
    this.list = doc.createElement('div'); this.list.setAttribute('role', 'listbox'); this.list.id = `${this.popupId}-list`; this.search.setAttribute('aria-controls', this.list.id); this.trigger.setAttribute('aria-controls', this.list.id);
    this.done = doc.createElement('button'); this.done.type = 'button'; this.done.dataset.done = ''; this.done.textContent = 'Done';
    this.popup.append(this.search, this.list, this.done); this.prepend(this.labelNode, this.trigger, this.popup);
    this.trigger.addEventListener('click', () => this.expanded ? this.close(true, true) : this.open());
    this.trigger.addEventListener('keydown', event => {
      if (['ArrowDown', 'ArrowUp'].includes(event.key)) { event.preventDefault(); this.open(); this.highlight = event.key === 'ArrowDown' ? 0 : this.filtered().length - 1; this.renderOptions(); }
      else if (event.key.length === 1 && event.key !== ' ' && !event.ctrlKey && !event.metaKey && !event.altKey) { event.preventDefault(); this.open(); this.query += event.key; this.highlight = 0; this.update(); }
    });
    this.search.addEventListener('input', () => { this.query = this.search!.value; this.highlight = 0; this.renderOptions(); });
    this.addEventListener('keydown', event => {
      if (!this.expanded || (event.target as Element).closest('af-select') !== this) return;
      if (event.key === 'Escape') { event.preventDefault(); this.close(false, true); }
      if (event.target !== this.search) return;
      const count = this.filtered().length + Number(this.canCreate());
      if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
        event.preventDefault(); this.highlight = event.key === 'Home' ? 0 : event.key === 'End' ? count - 1 : Math.max(0, Math.min(count - 1, this.highlight + (event.key === 'ArrowDown' ? 1 : -1))); this.renderOptions();
      } else if (event.key === 'Enter') { event.preventDefault(); const option = this.filtered()[this.highlight]; if (option) this.choose(option.value); else if (this.canCreate()) this.choose(this.query.trim()); }
    });
    this.done.addEventListener('click', () => this.close(true, true));
  }
  private open(): void { if (this.disabled || this.expanded) return; this.expanded = true; this.draftStart = Array.isArray(this.value) ? [...this.value] : this.value; this.draft = Array.isArray(this.value) ? [...this.value] : []; this.query = ''; this.highlight = -1; this.update(); this.search?.focus(); }
  private close(commit: boolean, focus = false): void { if (!this.expanded) return; this.expanded = false; if (this.multiple && !this.disabled) { const next = draftCommit(this.draftStart, this.value, this.draft, commit); if (next) this.commit(next); } this.query = ''; this.update(); if (focus) this.trigger?.focus(); }
  private commit(value: AfSelectValue): void {
    if (!this.dispatchEvent(new CustomEvent<AfSelectChangeDetail>('af-change', { detail: { value }, bubbles: true, composed: true, cancelable: true }))) return;
    if (!this.controlled && !this.hasAttribute('value')) this.state = value;
  }
  private choose(value: AfSelectScalar | null): void {
    if (this.disabled) return;
    if (this.multiple && value !== null) { this.draft = this.draft.includes(value) ? this.draft.filter(item => item !== value) : [...this.draft, value]; this.query = ''; this.highlight = -1; this.update(); this.search?.focus(); }
    else { this.commit(value); this.close(false, true); }
  }
  private renderOptions(): void {
    if (!this.list) return;
    this.list.replaceChildren();
    this.search?.removeAttribute('aria-activedescendant');
    const entries = this.filtered();
    const add = (label: string, value: AfSelectScalar | null, index: number, create = false) => {
      const selected = !create && (this.multiple ? this.draft.includes(value as AfSelectScalar) : this.value === value);
      const button = this.ownerDocument.createElement('button'); button.type = 'button'; button.setAttribute('role', 'option'); button.tabIndex = -1;
      const optionLabel = this.ownerDocument.createElement('span'); optionLabel.textContent = label; button.append(optionLabel);
      button.setAttribute('aria-selected', String(selected));
      if (selected) {
        const indicator = this.ownerDocument.createElementNS('http://www.w3.org/2000/svg', 'svg');
        indicator.dataset.selectedIndicator = ''; indicator.setAttribute('viewBox', '0 0 24 24'); indicator.setAttribute('fill', 'none'); indicator.setAttribute('stroke', 'currentColor');
        indicator.setAttribute('stroke-width', '2'); indicator.setAttribute('stroke-linecap', 'round'); indicator.setAttribute('stroke-linejoin', 'round'); indicator.setAttribute('aria-hidden', 'true');
        const check = this.ownerDocument.createElementNS('http://www.w3.org/2000/svg', 'path'); check.setAttribute('d', 'm5 12 4 4L19 6'); indicator.append(check); button.append(indicator);
      }
      const key = create ? `create:${selectKey(value)}` : selectKey(value);
      let id = this.optionIds.get(key); if (!id) { id = `${this.popupId}-option-${++this.nextOptionId}`; this.optionIds.set(key, id); }
      button.id = id;
      if (index === this.highlight) this.search?.setAttribute('aria-activedescendant', button.id);
      button.dataset.highlighted = String(index === this.highlight); if (create) button.dataset.create = '';
      button.addEventListener('mousedown', event => event.preventDefault()); button.addEventListener('click', () => this.choose(value));
      this.list!.append(button);
    };
    entries.forEach((entry, index) => add(entry.label, entry.value, index));
    if (this.canCreate()) add(`Create “${this.query.trim()}”`, this.query.trim(), entries.length, true);
    else if (!entries.length) { const status = this.ownerDocument.createElement('div'); status.setAttribute('role', 'status'); status.textContent = 'No matches'; this.list.append(status); }
  }
  private position = (): void => {
    if (!this.expanded || !this.popup || !this.trigger) return;
    const view = this.ownerDocument.defaultView; if (!view) return;
    const rect = this.trigger.getBoundingClientRect(); const margin = 8;
    const width = Math.min(Math.max(rect.width, 200), Math.max(0, view.innerWidth - margin * 2));
    this.popup.style.margin = '0'; this.popup.style.inset = 'auto'; this.popup.style.boxSizing = 'border-box'; this.popup.style.position = 'fixed'; this.popup.style.width = `${width}px`; this.popup.style.minWidth = '0';
    this.popup.style.left = `${Math.max(margin, Math.min(rect.left, view.innerWidth - width - margin))}px`;
    const below = view.innerHeight - rect.bottom - margin; const above = rect.top - margin;
    const height = this.popup.getBoundingClientRect().height;
    const flip = below < height && above > below; const space = Math.max(0, flip ? above : below);
    this.popup.style.maxHeight = `${space}px`; this.popup.style.overflow = 'auto';
    this.popup.style.top = `${flip ? Math.max(margin, rect.top - Math.min(height, space) - 4) : rect.bottom + 4}px`;
  };
  private update(): void {
    if (!this.trigger || !this.labelNode || !this.popup || !this.search || !this.list || !this.done) return;
    const label = this.getAttribute('label') ?? ''; const name = this.getAttribute('aria-label') || label;
    this.labelNode.textContent = label; this.labelNode.hidden = !label;
    this.trigger.setAttribute('aria-label', name); this.trigger.setAttribute('aria-expanded', String(this.expanded)); this.trigger.disabled = this.disabled;
    const values = Array.isArray(this.value) ? this.value : this.value === null ? [] : [this.value];
    this.triggerValue!.toggleAttribute('data-placeholder', !this.multiple && this.value === null);
    this.triggerValue!.textContent = values.map(value => this.entries().find(entry => entry.value === value)?.label ?? String(value)).join(', ') || this.getAttribute('placeholder') || 'All';
    this.popup.hidden = !this.expanded;
    if (this.isConnected && typeof this.popup.showPopover === 'function') {
      if (this.expanded && !this.popup.matches(':popover-open')) this.popup.showPopover();
      else if (!this.expanded && this.popup.matches(':popover-open')) this.popup.hidePopover();
    } this.search.value = this.query; this.search.setAttribute('aria-label', name ? `Search ${name}` : 'Search options');
    this.list.setAttribute('aria-label', name); this.list.setAttribute('aria-multiselectable', String(this.multiple)); this.done.hidden = !this.multiple; this.renderOptions(); this.position();
  }
}
const styles = `af-select{display:inline-flex;position:relative;flex-direction:column;gap:.375rem;color:var(--foreground,light-dark(#222,#eee));font:inherit}af-select [hidden]{display:none!important}af-select .af-select-label{font-size:11px;font-weight:500;letter-spacing:.05em;text-transform:uppercase;color:var(--muted-foreground,light-dark(#555,#aaa))}af-select button,af-select input{box-sizing:border-box;font:inherit;font-size:.875rem;line-height:1.25rem;color:inherit;border:1px solid var(--input,light-dark(#ddd,#555));background:var(--background,light-dark(#fff,#222));border-radius:var(--radius-sm,calc(var(--radius,.625rem) - 4px));padding:.5rem .75rem}af-select input{height:2rem;border-radius:var(--radius-sm,calc(var(--radius,.625rem) - 4px));padding:0 .5rem}af-select button{cursor:pointer}af-select button:disabled{opacity:.5;cursor:not-allowed}af-select button:focus-visible,af-select input:focus-visible{outline:2px solid var(--ring,light-dark(#777,#aaa));outline-offset:2px}af-select .af-select-trigger{display:flex;align-items:center;justify-content:space-between;gap:.5rem;min-width:9rem;height:2.25rem;border-radius:var(--radius-md,calc(var(--radius,.625rem) - 2px));text-align:left;box-shadow:0 1px 2px #0000000d}af-select .af-select-value{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}af-select .af-select-value[data-placeholder]{color:var(--muted-foreground,light-dark(#555,#aaa))}af-select .af-select-chevron{width:1rem;height:1rem;flex-shrink:0;opacity:.5}af-select .af-select-popup{position:absolute;top:100%;left:0;min-width:100%;z-index:50;padding:.375rem;border:1px solid var(--border,light-dark(#ddd,#555));background:var(--popover,var(--background,light-dark(#fff,#222)));color:var(--popover-foreground,var(--foreground,light-dark(#222,#eee)));border-radius:var(--radius-md,calc(var(--radius,.625rem) - 2px));box-shadow:var(--shadow-md,0 4px 6px -1px rgb(0 0 0 / 10%),0 2px 4px -2px rgb(0 0 0 / 10%))}af-select [role=listbox]{max-height:14rem;overflow:auto}af-select [role=option]{display:flex;align-items:center;justify-content:space-between;gap:.75rem;width:100%;text-align:left;border:0;background:transparent;border-radius:var(--radius-sm,calc(var(--radius,.625rem) - 4px));padding:.375rem .5rem}af-select [role=option] [data-selected-indicator]{width:1rem;height:1rem;flex:none}af-select [role=option]:hover,af-select [data-highlighted=true]{background:var(--accent,light-dark(#eee,#444));color:var(--accent-foreground,var(--foreground,light-dark(#222,#eee)))}af-select [role=status]{padding:.75rem;color:var(--muted-foreground,light-dark(#555,#aaa))}`;
export function registerSelect(registry: CustomElementRegistry = customElements, document: Document = globalThis.document): void {
  if (!document.querySelector('style[data-af-select-styles]')) { const style = document.createElement('style'); style.setAttribute('data-af-select-styles', ''); style.textContent = styles; document.head.append(style); }
  if (!registry.get('af-select')) registry.define('af-select', AfSelect);
}
