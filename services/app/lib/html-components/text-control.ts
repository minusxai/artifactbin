/** Author-facing contract shared by the native text and textarea controls. */
export interface TextControlContract {
  value: string | number | null | undefined;
}

interface TextInputChangeDetail { value: string | null }
interface TextNumberChangeDetail { value: number | null }
type TextControlChangeDetail = TextInputChangeDetail | TextNumberChangeDetail;

export type TextControlKind = 'input' | 'textarea';
export const textControlAttributes = [
  'value', 'default-value', 'type', 'label', 'aria-label', 'name', 'placeholder', 'autofocus',
  'required', 'min', 'max', 'step', 'rows', 'disabled', 'readonly', 'minlength', 'maxlength', 'resize',
] as const;

let nextTextControlId = 0;
const initializedTextControls = new WeakSet<HTMLElement>();
const supportedInputTypes = new Set(['text', 'number', 'email', 'url', 'search', 'password']);

/** Install shared light-DOM behavior while leaving authored nodes in place. */
export interface TextControlController { sync(): void; disconnect(): void }
export function connectTextControl(host: HTMLElement, kind: TextControlKind, property: {controlled(): boolean; value(): string | number | null | undefined} = {controlled:()=>false,value:()=>undefined}): TextControlController {
  const doc = host.ownerDocument;
  let native = host.querySelector<HTMLInputElement | HTMLTextAreaElement>(kind === 'input' ? ':scope > input' : ':scope > textarea');
  if (!native) {
    native = doc.createElement(kind) as HTMLInputElement | HTMLTextAreaElement;
    native.className = kind === 'input' ? 'af-text-control af-text-control-input' : 'af-text-control af-text-control-textarea';
    host.append(native);
  }
  let label = host.querySelector<HTMLLabelElement>(':scope > label[data-af-control-label]');
  if (!label) { label = doc.createElement('label'); label.dataset.afControlLabel = ''; host.prepend(label); }
  if (!native.id) {
    do { native.id = `af-${kind}-${++nextTextControlId}`; } while (doc.getElementById(native.id) && doc.getElementById(native.id) !== native);
  }
  label.htmlFor = native.id;
  let composing = false;
  let queuedDuringComposition = false;
  const numeric = () => kind === 'input' && (native as HTMLInputElement).type === 'number';
  const current = (): string | number | null => numeric()
    ? native!.value === '' || !Number.isFinite(Number(native!.value)) ? null : Number(native!.value)
    : native!.value === '' ? null : native!.value;
  let acceptedValue: string | number | null = current();
  const setNativeValue = (value: unknown) => {
    const next = value == null ? '' : String(value);
    if (native!.value !== next) native!.value = next;
  };
  const modelValue = (): string | number | null => {
    if (property.controlled()) return property.value() ?? null;
    if (!host.hasAttribute('value')) return acceptedValue;
    const raw = host.getAttribute('value') ?? '';
    if (numeric()) return raw === '' || !Number.isFinite(Number(raw)) ? null : Number(raw);
    return raw === '' ? null : raw;
  };
  const sync = () => {
    const visibleLabel = host.getAttribute('label');
    const ariaLabel = host.getAttribute('aria-label');
    const labelText = visibleLabel ?? ariaLabel ?? '';
    label.textContent = labelText;
    label.hidden = !labelText;
    label.classList.toggle('af-visually-hidden', !visibleLabel && !!ariaLabel);
    for (const attr of ['name','placeholder','required','min','max','step','autofocus','disabled','readonly','minlength','maxlength'] as const) {
      const mapped = attr === 'autofocus' ? 'autofocus' : attr === 'readonly' ? 'readonly' : attr;
      if (host.hasAttribute(attr)) native!.setAttribute(mapped, host.getAttribute(attr) ?? ''); else native!.removeAttribute(mapped);
    }
    if (kind === 'input') {
      const requested = host.getAttribute('type')?.toLowerCase() ?? 'text';
      (native as HTMLInputElement).type = supportedInputTypes.has(requested) ? requested : 'text';
    } else {
      const rows = Number(host.getAttribute('rows'));
      (native as HTMLTextAreaElement).rows = Number.isInteger(rows) && rows > 0 ? rows : 3;
      const resize = host.getAttribute('resize');
      (native as HTMLTextAreaElement).style.resize = resize === 'none' || resize === 'both' || resize === 'horizontal' || resize === 'vertical' ? resize : 'vertical';
    }
    const controlled = property.controlled() || host.hasAttribute('value');
    if (controlled) {
      if (!composing) setNativeValue(modelValue());
      if (!composing) acceptedValue = modelValue();
    } else if (!initializedTextControls.has(host)) {
      const initial = host.getAttribute('default-value') ?? (kind === 'textarea' ? [...host.childNodes].filter(node => node !== label && node !== native).map(node => node.textContent ?? '').join('') : '');
      setNativeValue(initial);
      initializedTextControls.add(host);
      acceptedValue = current();
    }
  };
  const commit = () => {
    if (composing) { queuedDuringComposition = true; return; }
    if (native!.disabled || (native as HTMLInputElement | HTMLTextAreaElement).readOnly) { setNativeValue(modelValue()); return; }
    const value = current();
    if (value === acceptedValue) return;
    const detail: TextControlChangeDetail = numeric()
      ? {value: value === null ? null : Number(value)}
      : {value: value === null ? null : String(value)};
    const event = new CustomEvent('af-change', {detail, bubbles:true, composed:true, cancelable:true});
    const accepted = host.dispatchEvent(event);
    if (property.controlled() || host.hasAttribute('value')) sync();
    else if (!accepted) setNativeValue(acceptedValue);
    else acceptedValue = value;
  };
  const onInput = () => commit();
  const onCompositionStart = () => { composing = true; queuedDuringComposition = false; };
  const onCompositionEnd = () => {
    composing = false;
    const changed = current() !== acceptedValue;
    if ((queuedDuringComposition || changed) && changed) { queuedDuringComposition = false; commit(); }
    else sync();
  };
  native.addEventListener('input', onInput);
  native.addEventListener('compositionstart', onCompositionStart);
  native.addEventListener('compositionend', onCompositionEnd);
  const controller = {sync, disconnect: () => {
    native!.removeEventListener('input', onInput);
    native!.removeEventListener('compositionstart', onCompositionStart); native!.removeEventListener('compositionend', onCompositionEnd);
  }};
  sync();
  return controller;
}

export function getTextControlValue(host: HTMLElement, controlledProperty: boolean, propertyValue: string | number | null | undefined): string | number | null {
  const native = host.querySelector<HTMLInputElement | HTMLTextAreaElement>('input,textarea');
  const number = native?.tagName === 'INPUT' && (native as HTMLInputElement).type === 'number';
  const raw = controlledProperty ? propertyValue == null ? '' : String(propertyValue) : host.hasAttribute('value') ? host.getAttribute('value') ?? '' : native?.value ?? '';
  if (number) return raw === '' || !Number.isFinite(Number(raw)) ? null : Number(raw);
  if (controlledProperty) return propertyValue ?? null;
  if (host.hasAttribute('value')) return raw === '' ? null : raw;
  return native?.value || null;
}
