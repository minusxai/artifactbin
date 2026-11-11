/**
 * Internal: a host's aria-label, taken off the host so its native control alone carries it (one
 * name, not two). Set renames; '', removeAttribute or ariaLabel = null clears.
 * Used by: text-control.ts, switch.ts, select.ts, slider.ts, date-picker.ts, button.ts.
 */
const names = new WeakMap<Element, string>(), moving = new WeakSet<Element>();
const { removeAttribute: remove, setAttribute: set } = Element.prototype;
const A = 'aria-label';

/** The author's name for this host, taking a just-set attribute off it. */
export function hostName(host: Element): string | null {
  const raw = host.getAttribute(A);
  if (raw !== null) {
    if (raw) names.set(host, raw); else names.delete(host);
    moving.add(host); remove.call(host, A); moving.delete(host);
  }
  return names.get(host) ?? null;
}
/** True while a host takes its own attribute off: attributeChangedCallback ignores it. */
export const movingName = (host: Element): boolean => moving.has(host);

export class NamedHost extends HTMLElement {
  override removeAttribute(name: string): void {
    if (name === A && names.delete(this) && !this.hasAttribute(A)) set.call(this, A, '');
    remove.call(this, name);
  }
  get ariaLabel(): string | null { return this.getAttribute(A) || names.get(this) || null; }
  set ariaLabel(value: string | null) {
    if (value === null) this.removeAttribute(A); else this.setAttribute(A, value);
  }
}
