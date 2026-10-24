import { format as d3format } from 'd3-format';

/** Numeric value exposed by the author-facing range control. */
interface SliderContract { value: number | null }
interface SliderChangeDetail { value: number }

function numeric(value: string | null): number | null {
  if (value === null || value.trim() === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

let nextId = 0;
export class AfSlider extends HTMLElement implements SliderContract {
  static observedAttributes = ['value', 'default-value', 'min', 'max', 'step', 'label', 'format', 'prefix', 'suffix', 'disabled', 'readonly'];
  private initialized = false;
  private controlled = false;
  private propertyValue: number | null = null;
  private selection: number | null = null;
  private input: HTMLInputElement | undefined;
  private labelElement: HTMLLabelElement | undefined;
  private readout: HTMLElement | undefined;

  get value(): number | null {
    if (this.controlled) return this.propertyValue;
    if (this.hasAttribute('value')) return numeric(this.getAttribute('value'));
    return this.selection;
  }
  set value(value: number | null) {
    this.controlled = true;
    this.propertyValue = typeof value === 'number' && Number.isFinite(value) ? value : null;
    this.sync();
  }

  connectedCallback(): void {
    if (Object.prototype.hasOwnProperty.call(this, 'value')) {
      const value = this.value;
      delete (this as { value?: number | null }).value;
      this.value = value;
    }
    if (!this.initialized) {
      this.selection = numeric(this.getAttribute('default-value'));
      this.initialized = true;
    }
    this.ensureParts();
    this.input?.addEventListener('input', this.onInput);
    this.sync();
  }
  disconnectedCallback(): void { this.input?.removeEventListener('input', this.onInput); }
  attributeChangedCallback(): void { this.sync(); }

  private ensureParts(): void {
    this.input ??= this.querySelector<HTMLInputElement>('input[type="range"]') ?? undefined;
    if (!this.input) {
      this.input = this.ownerDocument.createElement('input');
      this.input.type = 'range';
      this.append(this.input);
    }
    if (!this.input.id) {
      let id: string;
      do { id = `af-slider-${++nextId}`; } while (this.ownerDocument.getElementById(id));
      this.input.id = id;
    }
    this.labelElement = this.querySelector<HTMLLabelElement>('label') ?? undefined;
    if (!this.labelElement) {
      this.labelElement = this.ownerDocument.createElement('label');
      this.prepend(this.labelElement);
    }
    this.labelElement.htmlFor = this.input.id;
    this.readout = this.querySelector<HTMLElement>('[part="readout"]') ?? undefined;
    if (!this.readout) {
      this.readout = this.ownerDocument.createElement('output');
      this.readout.setAttribute('part', 'readout');
      this.append(this.readout);
    }
  }

  private onInput = (): void => {
    const input = this.input;
    if (!input) return;
    if (this.hasAttribute('disabled') || this.hasAttribute('readonly')) { this.sync(); return; }
    const value = input.valueAsNumber;
    if (!Number.isFinite(value) || value === this.value) { this.sync(); return; }
    const change = new CustomEvent<SliderChangeDetail>('af-change', { detail: { value }, bubbles: true, composed: true, cancelable: true });
    if (this.dispatchEvent(change) && !this.controlled && !this.hasAttribute('value')) this.selection = value;
    this.sync();
  };

  private sync(): void {
    if (!this.isConnected) return;
    this.ensureParts();
    const input = this.input!;
    input.min = this.getAttribute('min') ?? '0';
    input.max = this.getAttribute('max') ?? '100';
    input.step = this.getAttribute('step') ?? '1';
    input.disabled = this.hasAttribute('disabled');
    input.readOnly = this.hasAttribute('readonly');
    const value = this.value;
    const min = Number.isFinite(Number(input.min)) ? Number(input.min) : 0;
    input.value = String(value ?? min);
    this.labelElement!.htmlFor = input.id;
    if (this.hasAttribute('label')) this.labelElement!.textContent = this.getAttribute('label') ?? '';
    this.readout!.textContent = value === null ? '—' : `${this.getAttribute('prefix') ?? ''}${this.formatValue(value)}${this.getAttribute('suffix') ?? ''}`;
  }

  private formatValue(value: number): string {
    const spec = this.getAttribute('format');
    if (!spec) return String(value);
    try { return d3format(spec)(value); } catch { return String(value); }
  }
}

const sliderStyles = `
af-slider{display:inline-flex;flex-direction:column;gap:.375rem;min-width:12rem;font:inherit;color:inherit}
af-slider>label{font-size:.875rem;line-height:1.25rem}
af-slider>input[type=range]{width:100%;accent-color:var(--primary,currentColor)}
af-slider>input[type=range]:disabled{opacity:.55}
af-slider>[part=readout]{align-self:flex-end;font-variant-numeric:tabular-nums;font-size:.875rem}
`;

export function registerSlider(registry: CustomElementRegistry = customElements, document: Document = globalThis.document): void {
  if (!document.querySelector('style[data-af-slider-styles]')) {
    const style = document.createElement('style');
    style.setAttribute('data-af-slider-styles', '');
    style.textContent = sliderStyles;
    document.head.append(style);
  }
  if (!registry.get('af-slider')) registry.define('af-slider', AfSlider);
}
