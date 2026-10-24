/** Author-facing contract shared by the native text and textarea controls. */
export interface TextControlContract {
  value: string | number | null | undefined;
}

export interface TextInputChangeDetail { value: string | null }
export interface TextNumberChangeDetail { value: number | null }
export type TextControlChangeDetail = TextInputChangeDetail | TextNumberChangeDetail;

export type TextControlKind = 'input' | 'textarea';
export const textControlAttributes = [
  'value', 'default-value', 'type', 'label', 'aria-label', 'name', 'placeholder', 'autofocus',
  'required', 'min', 'max', 'step', 'rows', 'disabled', 'readonly', 'minlength', 'maxlength', 'resize',
] as const;

let nextTextControlId = 0;
const initializedTextControls = new WeakSet<HTMLElement>();
const supportedInputTypes = new Set(['text', 'number', 'email', 'url', 'search', 'password']);

/** Install shared light-DOM behavior while leaving authored nodes in place. */
export function connectTextControl(host: HTMLElement, kind: TextControlKind, property: {controlled: boolean; value: string | number | null | undefined} = {controlled:false,value:undefined}): () => void {
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
  let acceptedValue: string | number | null = '';
  const numeric = () => kind === 'input' && (native as HTMLInputElement).type === 'number';
  const current = (): string | number | null => numeric()
    ? native!.value === '' || !Number.isFinite(Number(native!.value)) ? null : Number(native!.value)
    : native!.value;
  const setNativeValue = (value: unknown) => {
    const next = value == null ? '' : String(value);
    if (native!.value !== next) native!.value = next;
  };
  const sync = () => {
    const labelText = host.getAttribute('aria-label') ?? host.getAttribute('label') ?? '';
    label.textContent = labelText;
    label.hidden = !labelText;
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
    const controlled = property.controlled || host.hasAttribute('value');
    if (controlled) setNativeValue(property.controlled ? property.value : host.getAttribute('value'));
    else if (!initializedTextControls.has(host)) {
      const initial = host.getAttribute('default-value') ?? (kind === 'textarea' ? [...host.childNodes].filter(node => node !== label && node !== native).map(node => node.textContent ?? '').join('') : '');
      setNativeValue(initial);
      initializedTextControls.add(host);
    }
    acceptedValue = current();
  };
  const commit = () => {
    if (composing) { queuedDuringComposition = true; return; }
    const value = current();
    const detail: TextControlChangeDetail = numeric()
      ? {value: value === null ? null : Number(value)}
      : {value: value === null ? null : String(value)};
    const event = new CustomEvent('af-change', {detail, bubbles:true, composed:true, cancelable:true});
    if (!host.dispatchEvent(event)) setNativeValue(acceptedValue);
    else acceptedValue = value;
  };
  const onInput = () => commit();
  const onCompositionStart = () => { composing = true; queuedDuringComposition = false; };
  const onCompositionEnd = () => {
    composing = false;
    const changed = current() !== acceptedValue;
    if (queuedDuringComposition || changed) { queuedDuringComposition = false; commit(); }
  };
  const observer = new MutationObserver(sync);
  observer.observe(host, {attributes:true, attributeFilter:[...textControlAttributes, 'resize']});
  native.addEventListener('input', onInput);
  native.addEventListener('compositionstart', onCompositionStart);
  native.addEventListener('compositionend', onCompositionEnd);
  sync();
  return () => {
    observer.disconnect(); native!.removeEventListener('input', onInput);
    native!.removeEventListener('compositionstart', onCompositionStart); native!.removeEventListener('compositionend', onCompositionEnd);
  };
}

export function getTextControlValue(host: HTMLElement, controlledProperty: boolean, propertyValue: string | number | null | undefined): string | number | null {
  if (controlledProperty) return propertyValue ?? null;
  if (host.hasAttribute('value')) return host.getAttribute('value');
  const native = host.querySelector<HTMLInputElement | HTMLTextAreaElement>('input,textarea');
  if (native instanceof HTMLInputElement && native.type === 'number') return native.value === '' || !Number.isFinite(Number(native.value)) ? null : Number(native.value);
  return native?.value ?? null;
}
