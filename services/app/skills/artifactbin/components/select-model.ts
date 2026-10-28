/**
 * Internal: af-select value model (typed options, selection, drafts) plus its DOM builders,
 * option rendering, popup placement and light-DOM styles; not a public entry point.
 * Used by: select.ts.
 */
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
export interface SelectEntry { value: AfSelectScalar; label: string; key: string }
// The type prefix keeps 2 and '2' distinct options.
export function selectKey(value: AfSelectScalar | null): string { return `${typeof value}:${String(
  value)}`; }
export function normalizeOptions(input: unknown): SelectEntry[] {
  if (!Array.isArray(input)) return [];
  const seen = new Set<string>(); const result: SelectEntry[] = [];
  for (const option of input) {
    const value: unknown = option !== null && typeof option === 'object' ? option.value : option;
if (!(typeof value === 'string' || typeof value === 'boolean' || typeof value === 'number' &&
      Number.isFinite(value))) continue;
    const key = selectKey(value); if (seen.has(key)) continue; seen.add(key);
    const label: unknown = option !== null && typeof option === 'object' ? option.label : value;
result.push({ value, label: label === undefined || label === null ? String(value) : String(label),
      key });
  }
  return result;
}
export function normalizeSelection(input: unknown, multiple: boolean): AfSelectValue {
  if (multiple) return normalizeOptions(input).map(entry => entry.value);
  return normalizeOptions([input])[0]?.value ?? null;
}
function sameSelection(a: AfSelectValue, b: AfSelectValue): boolean {
return Array.isArray(a) && Array.isArray(b) ? a.length === b.length && a.every((value, index) =>
    value === b[index]) : a === b;
}
/** Only a changed draft whose starting value remains current may commit. */
export function draftCommit(start: AfSelectValue, current: AfSelectValue, draft: AfSelectScalar[],
  accepted: boolean): AfSelectScalar[] | null {
return accepted && sameSelection(start, current) && !sameSelection(current, draft) ? [...draft] :
    null;
}
export function optionInput(input: unknown): AfSelectOption[] { return normalizeOptions(input).map((
  { value, label }) => ({ value, label })); }
/** Re-applies properties set before the element upgraded so they reach the class setters. */
export function upgradeProperties(element: object, names: readonly string[]): void {
  for (const name of names) {
if (Object.hasOwn(element, name)) { const value = (element as Record<string, unknown>)[name];
      delete (element as Record<string, unknown>)[name];
      (element as Record<string, unknown>)[name] = value; }
  }
}
/** Next highlighted row for list keys in the search box; clamps, never wraps. */
export function moveHighlight(key: string, highlight: number, count: number): number {
  return key === 'Home' ? 0 : key === 'End' ? count - 1 : Math.max(0, Math.min(count - 1,
    highlight + (key === 'ArrowDown' ? 1 : -1)));
}
const svgNs = 'http://www.w3.org/2000/svg';
/** Builds the label, trigger and popup (search, listbox, Done); the caller wires events. */
export function buildSelectDom(doc: Document, popupId: string) {
  const labelNode = doc.createElement('span'); labelNode.className = 'af-select-label';
const trigger = doc.createElement('button'); trigger.type = 'button'; trigger.className =
    'af-select-trigger'; trigger.setAttribute('aria-haspopup', 'listbox');
  const triggerValue = doc.createElement('span'); triggerValue.className = 'af-select-value';
  const chevron = doc.createElementNS(svgNs, 'svg');
  chevron.setAttribute('viewBox', '0 0 24 24'); chevron.setAttribute('fill', 'none');
  chevron.setAttribute('stroke', 'currentColor'); chevron.setAttribute('stroke-width', '2');
  chevron.setAttribute('stroke-linecap', 'round'); chevron.setAttribute('stroke-linejoin', 'round');
  chevron.setAttribute('aria-hidden', 'true'); chevron.setAttribute('focusable', 'false');
  chevron.setAttribute('part', 'chevron'); chevron.classList.add('af-select-chevron');
  const chevronPath = doc.createElementNS(svgNs, 'path');
  chevronPath.setAttribute('d', 'm6 9 6 6 6-6'); chevron.append(chevronPath);
  trigger.append(triggerValue, chevron);
  // Manual popover: the top layer escapes overflow clipping; we own open/close.
  const popup = doc.createElement('div'); popup.dataset.popup = '';
  popup.setAttribute('popover', 'manual'); popup.className = 'af-select-popup';
  const searchWrapper = doc.createElement('div'); searchWrapper.className = 'af-select-search';
const search = doc.createElement('input'); search.type = 'text'; search.setAttribute(
    'role', 'searchbox'); search.placeholder = 'Type to filter…';
const list = doc.createElement('div'); list.setAttribute('role', 'listbox'); list.id =
    `${popupId}-list`; search.setAttribute('aria-controls', list.id);
    trigger.setAttribute('aria-controls', list.id);
  const done = doc.createElement('button'); done.type = 'button'; done.dataset.done = '';
  done.textContent = 'Done';
  searchWrapper.append(search);
  popup.append(searchWrapper, list, done);
  return { labelNode, trigger, triggerValue, chevron, popup, search, list, done };
}
interface SelectRenderState {
  entries: { value: AfSelectScalar | null; label: string }[]; multiple: boolean;
  draft: AfSelectScalar[]; value: AfSelectValue; highlight: number; query: string;
  canCreate: boolean; idFor(key: string): string; choose(value: AfSelectScalar | null): void;
}
/** Rebuilds the option rows; focus stays in the search box via aria-activedescendant. */
export function renderSelectOptions(list: HTMLDivElement, search: HTMLInputElement | undefined,
  state: SelectRenderState): void {
  const doc = list.ownerDocument;
  list.replaceChildren();
  search?.removeAttribute('aria-activedescendant');
  const entries = state.entries;
  const add = (label: string, value: AfSelectScalar | null, index: number, create = false) => {
const selected = !create && (state.multiple ? state.draft.includes(value as AfSelectScalar) :
      state.value === value);
    const button = doc.createElement('button'); button.type = 'button';
    button.setAttribute('role', 'option'); button.tabIndex = -1;
    const optionLabel = doc.createElement('span'); optionLabel.textContent = label;
    button.append(optionLabel);
    button.setAttribute('aria-selected', String(selected));
    if (selected) {
      const indicator = doc.createElementNS(svgNs, 'svg');
      indicator.dataset.selectedIndicator = ''; indicator.setAttribute('viewBox', '0 0 24 24');
      indicator.setAttribute('fill', 'none'); indicator.setAttribute('stroke', 'currentColor');
      indicator.setAttribute('stroke-width', '2');
      indicator.setAttribute('stroke-linecap', 'round');
      indicator.setAttribute('stroke-linejoin', 'round'); indicator.setAttribute('aria-hidden',
        'true');
      const check = doc.createElementNS(svgNs, 'path');
      check.setAttribute('d', 'M20 6 9 17l-5-5'); indicator.append(check); button.append(indicator);
    }
    // Stable ids per option keep aria-activedescendant valid across re-renders.
    button.id = state.idFor(create ? `create:${selectKey(value)}` : selectKey(value));
    if (index === state.highlight) search?.setAttribute('aria-activedescendant', button.id);
button.dataset.highlighted = String(index === state.highlight); if (create) button.dataset.create =
      '';
    // mousedown is cancelled so clicking a row does not steal focus from the search box.
button.addEventListener('mousedown', event => event.preventDefault()); button.addEventListener(
      'click', () => state.choose(value));
    list.append(button);
  };
  entries.forEach((entry, index) => add(entry.label, entry.value, index));
  const query = state.query.trim();
  if (state.canCreate) add(`Create “${query}”`, query, entries.length, true);
else if (!entries.length) { const status = doc.createElement('div');
    status.setAttribute('role', 'status'); status.textContent = 'No matches'; list.append(status); }
}
/** Fixed-position popup under the trigger (min 200px wide), flipped above when it fits better. */
export function placeSelectPopup(popup: HTMLDivElement, trigger: HTMLElement, view: Window): void {
  const rect = trigger.getBoundingClientRect(); const margin = 8;
  const width = Math.min(Math.max(rect.width, 200), Math.max(0, view.innerWidth - margin * 2));
  popup.style.margin = '0'; popup.style.inset = 'auto'; popup.style.boxSizing = 'border-box';
  popup.style.position = 'fixed'; popup.style.width = `${width}px`; popup.style.minWidth = '0';
  popup.style.left = `${Math.max(margin, Math.min(rect.left, view.innerWidth - width - margin))}px`;
  // Height is measured only after the width is applied, since wrapping changes it.
  const below = view.innerHeight - rect.bottom - margin; const above = rect.top - margin;
  const height = popup.getBoundingClientRect().height;
  const flip = below < height && above > below; const space = Math.max(0, flip ? above : below);
  popup.style.maxHeight = `${space}px`; popup.style.overflow = 'auto';
popup.style.top = `${flip ? Math.max(margin, rect.top - Math.min(height, space) - 4) :
    rect.bottom + 4}px`;
}
export const selectStyles =
  `af-select{display:inline-flex;position:relative;vertical-align:top;flex-direction:column;` +
  `gap:.375rem;color:var(--foreground,light-dark(#222,#eee));font:inherit;line-height:1.5}` +
  `af-select [hidden]{display:none!important}af-select .af-select-label{display:flex;` +
  `align-items:baseline;gap:.75rem;font-size:11px;font-weight:500;letter-spacing:.05em;` +
  `text-transform:uppercase;color:var(--muted-foreground,light-dark(#555,#aaa))}` +
  `af-select button,af-select input{box-sizing:border-box;font:inherit;font-size:.875rem;` +
  `line-height:1.25rem;color:inherit;border:1px solid var(--input,light-dark(#ddd,#555));` +
  `background:var(--background,light-dark(#fff,#222));border-radius:var(--radius-sm,` +
  `calc(var(--radius,.625rem) - 4px));padding:.5rem .75rem}af-select input{height:2rem;` +
  `border-radius:var(--radius-sm,calc(var(--radius,.625rem) - 4px));padding:0 .5rem}` +
  `af-select button{cursor:pointer}af-select button:disabled{opacity:.5;cursor:not-allowed}` +
  `af-select .af-select-trigger{display:flex;align-items:center;justify-content:space-between;` +
  `gap:.5rem;min-width:9rem;height:2.25rem;border-radius:var(--radius-md,calc(var(--radius,` +
  `.625rem) - 2px));text-align:left;box-shadow:0 1px 2px #0000000d}` +
  `af-select .af-select-value{min-width:0;overflow:hidden;text-overflow:ellipsis;` +
  `white-space:nowrap}` +
  `af-select .af-select-value[data-placeholder]{color:var(--muted-foreground,light-dark(#555,` +
  `#aaa))}af-select .af-select-chevron{width:1rem;height:1rem;flex-shrink:0;opacity:.5}` +
  `af-select .af-select-popup{position:absolute;top:100%;left:0;min-width:100%;z-index:50;` +
  `padding:0;border:1px solid var(--border,light-dark(#ddd,#555));background:var(--popover,` +
  `var(--background,light-dark(#fff,#222)));color:var(--popover-foreground,var(--foreground,` +
  `light-dark(#222,#eee)));border-radius:var(--radius-md,calc(var(--radius,.625rem) - 2px));` +
  `box-shadow:var(--shadow-md,0 4px 6px -1px rgb(0 0 0 / 10%),0 2px 4px -2px rgb(0 0 0 / 10%))}` +
  `af-select .af-select-search{padding:.375rem;border-bottom:1px solid var(--border,` +
  `light-dark(#ddd,#555))}af-select .af-select-search input{width:100%;min-width:9rem}` +
  `af-select .af-select-search input::placeholder{color:var(--muted-foreground,light-dark(#555,` +
  `#aaa));opacity:1}af-select [role=listbox]{max-height:14rem;overflow:auto;padding:.25rem}` +
  `af-select [role=option]{display:flex;align-items:center;justify-content:space-between;` +
  `gap:.75rem;width:100%;text-align:left;border:0;background:transparent;` +
  `border-radius:var(--radius-sm,calc(var(--radius,.625rem) - 4px));padding:.375rem .5rem}` +
  `af-select [role=option] [data-selected-indicator]{width:14px;height:14px;flex:none}` +
  `af-select [role=option]:hover,af-select [data-highlighted=true]{background:var(--accent,` +
  `light-dark(#eee,#444));color:var(--accent-foreground,var(--foreground,light-dark(#222,` +
  `#eee)))}af-select [role=status]{padding:.75rem;color:var(--muted-foreground,light-dark(#555,` +
  `#aaa))}af-select button:focus-visible,af-select input:focus-visible{outline:none;` +
  `outline-offset:0;box-shadow:0 0 0 2px color-mix(in oklab,var(--ring,light-dark(#777,` +
  `#aaa)) 50%,transparent)}` +
  `af-select .af-select-trigger:focus-visible{box-shadow:0 0 0 2px color-mix(in oklab,` +
  `var(--ring,light-dark(#777,#aaa)) 50%,transparent),0 1px 2px #0000000d}` +
  `@media(hover:hover){af-select .af-select-trigger:hover{background-color:color-mix(in srgb,` +
  `var(--muted,light-dark(#eee,#444)) 40%,transparent);background-color:color-mix(in oklab,` +
  `var(--muted,light-dark(#eee,#444)) 40%,transparent)}}`;
