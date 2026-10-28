/**
 * Internal: af-segmented option types, option normalisation, keyboard targets and CSS.
 * Used by: segmented.ts.
 */
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

export const isValue = (value: unknown): value is SegmentedValue => value === null ||
  typeof value === 'string' || typeof value === 'boolean' ||
  (typeof value === 'number' && Number.isFinite(value));
/** Identity key that keeps 1, "1" and true distinct. */
export const keyOf = (value: SegmentedValue): string => `${typeof value}:${String(value)}`;

/** Keeps scalars and {value,label} objects with a valid value; anything else is dropped. */
export function filterSegmentedOptions(value: unknown): (SegmentedValue | SegmentedOption)[] {
  return Array.isArray(value) ? value.filter(item => isValue(item) ||
    (item !== null && typeof item === 'object' && isValue((item as SegmentedOption).value) &&
    typeof (item as SegmentedOption).label === 'string')) : [];
}

/** Turns scalars into {value,label} (null is labelled "All") and drops duplicate values. */
export function normalizeSegmentedOptions(
  values: readonly (SegmentedValue | SegmentedOption)[]): SegmentedOption[] {
  const unique = new Map<string, SegmentedOption>();
  for (const item of values) {
    const option = isValue(item) ? {value:item, label:item === null ? 'All' : String(item)} :
      item as SegmentedOption;
    if (!unique.has(keyOf(option.value))) unique.set(keyOf(option.value), option);
  }
  return [...unique.values()];
}

/** Maps an attribute string back to the typed option value it names, else keeps the string. */
export function segmentedValueFromAttribute(options: SegmentedOption[], raw: string):
  SegmentedValue {
  const match = options.find(option => String(option.value ?? '') === raw);
  return match?.value ?? (raw === '' && options.some(option => option.value === null) ? null : raw);
}

/** Index to move to for a navigation key, or -1 when the key does not navigate. */
export function segmentedKeyIndex(key: string, index: number, length: number,
  orientation: 'horizontal' | 'vertical', rtl: boolean): number {
  // Horizontal arrows follow reading direction.
  const forward = orientation === 'vertical' ? 'ArrowDown' : rtl ? 'ArrowLeft' : 'ArrowRight';
  const backward = orientation === 'vertical' ? 'ArrowUp' : rtl ? 'ArrowRight' : 'ArrowLeft';
  if (key === forward) return (index + 1) % length;
  if (key === backward) return (index - 1 + length) % length;
  if (key === 'Home') return 0;
  if (key === 'End') return length - 1;
  return -1;
}

/** Re-applies properties set before the element upgraded so they run through the setters. */
export function replayPreUpgradeProperties(element: HTMLElement, names: readonly string[]): void {
  const properties = element as unknown as Record<string, unknown>;
  for (const name of names) {
    if (!Object.prototype.hasOwnProperty.call(element, name)) continue;
    const value = properties[name]; delete properties[name]; properties[name] = value;
  }
}

export interface SegmentedParts {
  caption?: HTMLSpanElement; label?: HTMLSpanElement; options?: HTMLDivElement;
}
/** Reuses an authored caption/label/options container when present, else creates them, and
 * puts them in order: caption (holding label) then options. */
export function ensureSegmentedParts(host: HTMLElement, parts: SegmentedParts):
  Required<SegmentedParts> {
  const document = host.ownerDocument;
  parts.caption ??= [...host.children].find((child): child is HTMLSpanElement =>
    child instanceof HTMLSpanElement && child.classList.contains('af-segmented-caption'));
  parts.label ??= parts.caption?.querySelector<HTMLSpanElement>('.af-segmented-label') ??
    [...host.children].find((child): child is HTMLSpanElement =>
      child instanceof HTMLSpanElement && child.classList.contains('af-segmented-label'));
  if (!parts.label) {
    parts.label = document.createElement('span');
    parts.label.className = 'af-segmented-label';
    parts.label.dataset.afControlLabel = '';
  }
  if (!parts.caption) {
    parts.caption = document.createElement('span');
    parts.caption.className = 'af-segmented-caption';
    parts.caption.dataset.afControlCaption = '';
  }
  parts.options ??= [...host.children].find((child): child is HTMLDivElement =>
    child instanceof HTMLDivElement && child.hasAttribute('data-segment-options'));
  if (!parts.options) {
    parts.options = document.createElement('div');
    parts.options.className = 'af-segmented-options';
    parts.options.setAttribute('data-segment-options', '');
  }
  if (parts.label.parentElement !== parts.caption) parts.caption.append(parts.label);
  if (parts.caption.parentElement !== host || parts.caption.nextElementSibling !== parts.options) {
    host.insertBefore(parts.caption, parts.options.parentElement === host ? parts.options : null);
  }
  if (parts.options.parentElement !== host) host.append(parts.options);
  return parts as Required<SegmentedParts>;
}

export function ownedSegmentButtons(container: HTMLDivElement | undefined): HTMLButtonElement[] {
  if (!container) return [];
  return [...container.children].filter((node): node is HTMLButtonElement =>
    node instanceof HTMLButtonElement && node.hasAttribute('data-segment-option'));
}

export function createSegmentButton(document: Document): HTMLButtonElement {
  const button = document.createElement('button'); button.type = 'button';
  button.dataset.segmentOption = '';
  return button;
}

export function paintSegmentButton(button: HTMLButtonElement, option: SegmentedOption,
  selected: boolean, disabled: boolean, tabbable: boolean): void {
  button.textContent = option.label; button.disabled = disabled;
  button.setAttribute('aria-pressed', String(selected));
  button.tabIndex = !disabled && tabbable ? 0 : -1; // Roving tabindex: one tab stop.
  button.dataset.state = selected ? 'active' : 'inactive';
  button.dataset.value = String(option.value ?? '');
}

export const segmentedStyles = `
af-segmented{display:inline-flex;vertical-align:top;flex-direction:column;align-items:flex-start;\
gap:.375rem;width:fit-content;box-sizing:border-box;color:inherit;font:inherit}
af-segmented .af-segmented-caption{display:flex;align-items:baseline;gap:.75rem;\
font-family:inherit;font-size:11px;font-weight:500;line-height:1.5;letter-spacing:.05em;\
text-transform:uppercase;color:var(--muted-foreground,#666)}
af-segmented .af-segmented-caption[hidden]{display:none!important}
af-segmented .af-segmented-label{display:block}
af-segmented .af-segmented-label[hidden]{display:none!important}
af-segmented .af-segmented-options{display:inline-flex;align-items:center;gap:.125rem;\
width:fit-content;box-sizing:border-box;border:1px solid var(--input,#ddd);\
border-radius:var(--radius-md,calc(var(--radius,.625rem) - 2px));padding:.125rem;\
background:color-mix(in oklab,var(--muted,#eee) 40%,transparent);box-shadow:0 1px 2px #0000000d}
af-segmented[data-orientation=vertical] .af-segmented-options{flex-direction:column;\
align-items:stretch}
af-segmented .af-segmented-options>button[data-segment-option]{position:relative;\
box-sizing:border-box;height:2rem;cursor:pointer;border:0;border-radius:5px;padding:0 .75rem;\
background:transparent;color:var(--muted-foreground,#555);font:inherit;font-size:.875rem;\
line-height:1.25rem;transition:background-color .15s,color .15s}
af-segmented .af-segmented-options>button[data-segment-option][data-state=active]{\
background:var(--primary,#222);color:var(--primary-foreground,#fff);box-shadow:0 1px 2px #0000000d}
af-segmented .af-segmented-options>button[data-segment-option]:not([data-state=active]):hover{\
background:color-mix(in oklab,var(--foreground,#222) 10%,transparent);color:var(--foreground,#222)}
af-segmented .af-segmented-options>button[data-segment-option]:focus-visible{z-index:1;\
outline:2px solid transparent;outline-offset:2px;box-shadow:0 0 0 2px color-mix(in oklab,\
var(--ring,#777) 50%,transparent),0 1px 2px #0000000d}
af-segmented .af-segmented-options>button[data-segment-option]:disabled{cursor:not-allowed;\
opacity:.5}
`;
