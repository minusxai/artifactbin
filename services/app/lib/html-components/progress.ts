/** A native, light DOM 0–100 progress indicator with no platform state. */
export interface ProgressContract {
  /** Finite values from 0 through 100; null represents indeterminate progress. */
  value: number | null;
}

const validProgressValue = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 100;

export class AfProgress extends HTMLElement implements ProgressContract {
  static observedAttributes = ['value', 'label', 'aria-label'];
  private indicator?: HTMLDivElement;
  private propertyValue: number | null | undefined;
  private generatedLabel = false;
  private writingMappedLabel = false;

  get value(): number | null {
    if (this.propertyValue !== undefined) return this.propertyValue;
    const attribute = this.getAttribute('value');
    if (attribute === null || attribute.trim() === '') return null;
    const value = Number(attribute);
    return validProgressValue(value) ? value : null;
  }

  set value(value: number | null) {
    const normalized = validProgressValue(value) ? value : null;
    this.propertyValue = normalized;
    if (normalized === null) this.removeAttribute('value');
    else this.setAttribute('value', String(normalized));
    this.render();
  }

  connectedCallback(): void {
    if (Object.prototype.hasOwnProperty.call(this, 'value')) {
      const value = this.value;
      delete (this as {value?: number | null}).value;
      this.value = value;
    }
    this.syncLabel();
    this.render();
  }

  attributeChangedCallback(name: string): void {
    if (name === 'aria-label') {
      if (this.writingMappedLabel) return;
      this.generatedLabel = false;
      this.syncLabel();
      return;
    }
    if (name === 'label') this.syncLabel();
    this.propertyValue = undefined;
    this.render();
  }

  private syncLabel(): void {
    if (!this.isConnected || this.writingMappedLabel) return;
    const label = this.getAttribute('label');
    if (this.hasAttribute('aria-label') && !this.generatedLabel) return;
    if (label !== null) {
      this.writingMappedLabel = true;
      this.setAttribute('aria-label', label);
      this.writingMappedLabel = false;
      this.generatedLabel = true;
    } else if (this.generatedLabel) {
      this.writingMappedLabel = true;
      this.removeAttribute('aria-label');
      this.writingMappedLabel = false;
      this.generatedLabel = false;
    }
  }

  private render(): void {
    if (!this.isConnected) return;
    const value = this.value;
    const determinate = value !== null;
    const state = !determinate ? 'indeterminate' : value === 100 ? 'complete' : 'loading';
    this.setAttribute('role', 'progressbar');
    this.setAttribute('aria-valuemin', '0');
    this.setAttribute('aria-valuemax', '100');
    if (determinate) this.setAttribute('aria-valuenow', String(value));
    else this.removeAttribute('aria-valuenow');
    this.dataset.slot = 'progress';
    this.dataset.state = state;
    if (determinate) this.dataset.value = String(value); else delete this.dataset.value;
    this.dataset.max = '100';

    if (!this.indicator || this.indicator.parentElement !== this) {
      this.indicator = [...this.children].find((child): child is HTMLDivElement =>
        child instanceof HTMLDivElement && child.dataset.slot === 'progress-indicator') ?? undefined;
      if (!this.indicator) {
        this.indicator = this.ownerDocument.createElement('div');
        this.indicator.dataset.slot = 'progress-indicator';
        this.append(this.indicator);
      }
    }
    this.indicator.dataset.state = state;
    if (determinate) this.indicator.dataset.value = String(value); else delete this.indicator.dataset.value;
    this.indicator.dataset.max = '100';
    this.indicator.style.transform = `translateX(-${100 - (value ?? 0)}%)`;
  }
}

/** Semantic-token styles target this component only, keeping page CSS untouched. */
export const progressStyles = `
af-progress{display:block;position:relative;box-sizing:border-box;width:100%;height:.5rem;overflow:hidden;border-radius:var(--radius-full,9999px);background:color-mix(in srgb,var(--primary,#222) 20%,transparent)}
af-progress>[data-slot=progress-indicator]{box-sizing:border-box;display:flex;width:100%;height:100%;flex:1;background:var(--primary,#222);transition:transform .2s ease}
af-progress[data-state=indeterminate]>[data-slot=progress-indicator]{width:40%;animation:af-progress-indeterminate 1.4s ease-in-out infinite}
@keyframes af-progress-indeterminate{from{transform:translateX(-100%)}to{transform:translateX(250%)}}
@media(prefers-reduced-motion:reduce){af-progress>[data-slot=progress-indicator]{transition:none}af-progress[data-state=indeterminate]>[data-slot=progress-indicator]{animation:none;transform:translateX(0)}}
`;

export function registerProgress(registry: CustomElementRegistry = customElements, document: Document = globalThis.document): void {
  if (!document.querySelector('style[data-af-progress-styles]')) {
    const style = document.createElement('style'); style.setAttribute('data-af-progress-styles', '');
    style.textContent = progressStyles; document.head.append(style);
  }
  if (!registry.get('af-progress')) registry.define('af-progress', AfProgress);
}
