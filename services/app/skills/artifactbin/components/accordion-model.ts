/**
 * Internal: af-accordion value logic, attribute parsing, ARIA sync for triggers, and CSS.
 * Used by: accordion.ts.
 */
export type AccordionType = 'single' | 'multiple';
/** Item values identify selections; items with the same value share open state. */
export type AccordionValue = string | string[];

export interface AccordionChangeDetail { value: AccordionValue }
export interface AccordionContract { value: AccordionValue }

export function normalizeAccordionValue(type: AccordionType, value: AccordionValue):
  AccordionValue {
  if (type === 'single') return Array.isArray(value) ? value[0] ?? '' : value;
  const values = Array.isArray(value) ? value : value ? [value] : [];
  return [...new Set(values.filter(Boolean))];
}

export function toggleAccordionValue(type: AccordionType, current: AccordionValue, next: string,
  collapsible: boolean): AccordionValue {
  const value = normalizeAccordionValue(type,current);
  if (type === 'single') return value === next ? (collapsible ? '' : value) : next;
  const values = value as string[];
  return values.includes(next) ? values.filter(item => item !== next) : [...values,next];
}

export function equalAccordionValue(type: AccordionType, left: AccordionValue, right:
  AccordionValue): boolean {
  const a = normalizeAccordionValue(type,left); const b = normalizeAccordionValue(type,right);
  return Array.isArray(a) && Array.isArray(b) ?
    a.length === b.length && a.every((value,index) => value === b[index]) : a === b;
}

export function accordionTypeOf(value: string | null): AccordionType {
  return value === 'multiple' ? 'multiple' : 'single';
}

/** Parses value/default-value: "multiple" accepts a JSON string array or one plain value. */
export function parseAccordionAttribute(raw: string, type: AccordionType): AccordionValue {
  if (type === 'multiple' && raw.trim().startsWith('[')) {
    try {
      const parsed: unknown = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.every(value => typeof value === 'string')) {
        return normalizeAccordionValue(type,parsed as string[]);
      }
    } catch { /* A plain string remains a valid one-item default. */ }
  }
  return normalizeAccordionValue(type,raw);
}

/** Appends the chevron icon to a trigger control once. */
export function ensureAccordionChevron(control: HTMLElement): void {
  if (control.querySelector(':scope > svg[data-af-accordion-icon]')) return;
  const document = control.ownerDocument;
  const svg = document.createElementNS('http://www.w3.org/2000/svg','svg');
  svg.setAttribute('viewBox','0 0 24 24'); svg.setAttribute('fill','none');
  svg.setAttribute('stroke','currentColor'); svg.setAttribute('stroke-width','2');
  svg.setAttribute('stroke-linecap','round'); svg.setAttribute('stroke-linejoin','round');
  svg.setAttribute('aria-hidden','true'); svg.setAttribute('data-af-accordion-icon','');
  svg.classList.add('af-accordion-icon');
  const path = document.createElementNS('http://www.w3.org/2000/svg','path');
  path.setAttribute('d','m6 9 6 6 6-6'); svg.append(path); control.append(svg);
}

/** Which native buttons the accordion disabled, and each one's authored disabled flag. */
export interface NativeButtonMemory {
  authored: WeakMap<HTMLButtonElement,boolean>;
  forced: WeakSet<HTMLButtonElement>;
}
/** ARIA and disabled state for a native <button> inside a trigger. */
function syncAccordionButton(button: HTMLButtonElement, open: boolean, disabled: boolean,
  controlledIds: string, memory: NativeButtonMemory): void {
  if (disabled) {
    if (!memory.forced.has(button)) memory.authored.set(button,button.hasAttribute('disabled'));
    if (!button.hasAttribute('disabled')) button.setAttribute('disabled','');
    memory.forced.add(button);
  } else if (memory.forced.has(button)) {
    // Re-enabling restores the author's own disabled flag.
    if (memory.authored.get(button)) {
      if (!button.hasAttribute('disabled')) button.setAttribute('disabled','');
    } else if (button.hasAttribute('disabled')) button.removeAttribute('disabled');
    memory.forced.delete(button); memory.authored.delete(button);
  }
  button.setAttribute('aria-expanded',String(open));
  button.setAttribute('aria-disabled',String(disabled || button.disabled));
  if (controlledIds) button.setAttribute('aria-controls',controlledIds);
  else button.removeAttribute('aria-controls');
}

export interface TriggerSemantics { role: string | null; tabindex: string | null }
/** A trigger without a native button acts as the button itself (role, focus, ARIA). */
function syncAccordionTrigger(trigger: HTMLElement, open: boolean, disabled: boolean,
  controlledIds: string, semantics: TriggerSemantics | undefined): void {
  trigger.setAttribute('role','button'); trigger.setAttribute('aria-expanded',String(open));
  trigger.setAttribute('aria-disabled',String(disabled));
  if (controlledIds) trigger.setAttribute('aria-controls',controlledIds);
  else trigger.removeAttribute('aria-controls');
  if (disabled) trigger.tabIndex = -1;
  // Restore the authored tabindex, or make an un-authored trigger focusable.
  else if (semantics?.tabindex === null) trigger.tabIndex = 0;
  else if (semantics?.tabindex !== undefined) trigger.setAttribute('tabindex',semantics.tabindex);
}

/** Syncs one trigger: its native buttons carry the state if present, else the trigger does. */
export function syncAccordionControls(trigger: HTMLElement, buttons: HTMLButtonElement[],
  open: boolean, disabled: boolean, controlledIds: string, memory: NativeButtonMemory,
  semantics: TriggerSemantics | undefined): void {
  if (!buttons.length) {
    syncAccordionTrigger(trigger,open,disabled,controlledIds,semantics); return;
  }
  // A native button owns the semantics; the wrapper must not duplicate them.
  trigger.removeAttribute('role'); trigger.removeAttribute('tabindex');
  trigger.removeAttribute('aria-expanded'); trigger.removeAttribute('aria-controls');
  trigger.removeAttribute('aria-disabled');
  for (const button of buttons) syncAccordionButton(button,open,disabled,controlledIds,memory);
}

export function syncAccordionContent(content: HTMLElement, open: boolean, labelledByIds: string[],
  orientation: string): void {
  if (labelledByIds.length) content.setAttribute('aria-labelledby',labelledByIds.join(' '));
  else content.removeAttribute('aria-labelledby');
  content.setAttribute('role','region'); content.hidden = !open;
  content.toggleAttribute('inert',!open); // Closed content is out of the tab order and search.
  content.dataset.state = open ? 'open' : 'closed'; content.dataset.orientation = orientation;
}

export function accordionOrientation(value: string | null): 'horizontal' | 'vertical' {
  return value === 'horizontal' ? 'horizontal' : 'vertical';
}

/** Next focus index for a roving-focus key, or null when the key is not a navigation key. */
export function rovingIndex(key: string, index: number, length: number,
  orientation: 'horizontal' | 'vertical', rtl: boolean): number | null {
  // Horizontal arrows follow reading direction.
  const forward = orientation === 'vertical' ? 'ArrowDown' : rtl ? 'ArrowLeft' : 'ArrowRight';
  const backward = orientation === 'vertical' ? 'ArrowUp' : rtl ? 'ArrowRight' : 'ArrowLeft';
  if (key === 'Home') return 0;
  if (key === 'End') return length - 1;
  if (key === forward || key === backward)
    return (index + (key === forward ? 1 : -1) + length) % length;
  return null;
}

/** True if the accordion, item or trigger is disabled, every native button is, or no value. */
export function accordionPartDisabled(host: Element, item: Element, trigger?: Element): boolean {
  const buttons = trigger ? [...trigger.querySelectorAll<HTMLButtonElement>('button')] : [];
  const nativeDisabled = buttons.length > 0 && buttons.every(button => button.disabled);
  const missingValue = item.getAttribute('value') == null || item.getAttribute('value') === '';
  return host.hasAttribute('disabled') || item.hasAttribute('disabled') ||
    Boolean(trigger?.hasAttribute('disabled')) || nativeDisabled || missingValue;
}

let nextId = 0;
/** Gives a part a document-unique id unless the author set one (ARIA references need ids). */
export function identifyAccordionPart(node: HTMLElement, kind: string): void {
  if (node.id) return;
  let id: string;
  do { id = `af-accordion-${kind}-${++nextId}`; } while (node.ownerDocument.getElementById(id));
  node.id = id;
}

export const accordionStyles = `
af-accordion{display:block}
af-accordion-item{display:block}
af-accordion-item:not(:last-child){border-bottom:1px solid currentColor}
af-accordion-trigger{box-sizing:border-box;display:flex;align-items:flex-start;\
justify-content:space-between;gap:1rem;width:100%;padding:1rem 0;text-align:left;font:inherit;\
font-family:var(--font-display,inherit);font-size:.875rem;font-weight:500;line-height:1.25rem;\
border-radius:var(--radius-md,calc(var(--radius,.625rem) - 2px));color:inherit;cursor:pointer}
af-accordion-trigger:has(>button){display:contents}
af-accordion-trigger>button{box-sizing:border-box;display:flex;align-items:flex-start;\
justify-content:space-between;gap:1rem;width:100%;padding:1rem 0;text-align:left!important;\
font:inherit;font-family:var(--font-display,inherit);font-size:.875rem;font-weight:500;\
line-height:1.25rem;border:0;border-radius:var(--radius-md,calc(var(--radius,.625rem) - 2px));\
background:transparent;color:inherit;cursor:pointer}
af-accordion-trigger>.af-accordion-icon,af-accordion-trigger button>.af-accordion-icon{\
pointer-events:none;flex:none;width:1rem;height:1rem;transform:translateY(.125rem);\
color:var(--muted-foreground,currentColor);transition:transform .2s}
af-accordion-trigger:focus-visible,af-accordion-trigger>button:focus-visible{\
outline:2px solid transparent;outline-offset:2px;box-shadow:0 0 0 3px color-mix(in oklab,\
var(--ring,#777) 50%,transparent)}
af-accordion-trigger[aria-disabled=true],af-accordion-trigger>button[aria-disabled=true],\
af-accordion-trigger>button:disabled{opacity:.5;cursor:default}
af-accordion-content{display:block;overflow:hidden;padding:0 0 1rem;font-size:.875rem;\
line-height:1.25rem}
af-accordion-content[hidden]{display:none!important}
`;
