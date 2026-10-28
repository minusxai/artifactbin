/**
 * <af-input>: single-line text control.
 * Import:  import '@afbin/input';  (registers the tags; this .ts is the readable contract)
 * Props: value, label, placeholder, native constraints (required, maxlength, pattern, ...)
 * Events: af-change (bubbles) with event.detail.value; reflect your Apollo value back for controlled use
 * Usage:
 *   <af-input id="search" label="Search"></af-input>
 */
import { registerComponent } from './register-component';
import { connectTextControl, getTextControlValue, textControlAttributes, type TextControlContract, type TextControlController } from './text-control';

class AfInput extends HTMLElement implements TextControlContract {
  static observedAttributes = [...textControlAttributes];
  private controller?: TextControlController;
  private propertyControlled = false;
  private propertyValue: string | number | null | undefined;
  get value(): string | number | null { return getTextControlValue(this, this.propertyControlled, this.propertyValue); }
  set value(value: string | number | null | undefined) { this.propertyControlled = value !== undefined; this.propertyValue = value; this.controller?.sync(); }
  connectedCallback(): void {
    if (Object.prototype.hasOwnProperty.call(this, 'value')) {
      const value = this.value; delete (this as {value?: string | number | null}).value; this.value = value;
    }
    this.controller?.disconnect(); this.controller = connectTextControl(this, 'input', {controlled:()=>this.propertyControlled,value:()=>this.propertyValue});
  }
  disconnectedCallback(): void { this.controller?.disconnect(); this.controller = undefined; }
  attributeChangedCallback(): void { this.refresh(); }
  private refresh(): void { if (!this.isConnected) return; this.controller?.sync(); }
}

const inputStyles = `
af-input{display:inline-flex;min-width:12rem;flex-direction:column;gap:.375rem;vertical-align:top}
af-input>label[data-af-control-label]{font-family:inherit;font-size:11px;font-weight:500;line-height:1.5;letter-spacing:.05em;text-transform:uppercase;color:var(--muted-foreground,#666)}
af-input>label[hidden]{display:none}
af-input>label.af-visually-hidden{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0}
af-input>.af-text-control{box-sizing:border-box;width:100%;min-width:12rem;height:36px;border:1px solid var(--input,#d1d5db);border-radius:var(--radius-md,calc(var(--radius,.625rem) - 2px));background:var(--background,#fff);padding:0 12px;color:var(--foreground,#111);font-family:inherit;font-size:14px;line-height:20px;box-shadow:0 1px 2px #0000000d;outline:none;transition:color .15s,box-shadow .15s}
af-input>.af-text-control::placeholder{color:var(--muted-foreground,#737373)}
af-input>.af-text-control:focus-visible{box-shadow:0 0 0 2px color-mix(in srgb,var(--ring,#777) 50%,transparent)}
af-input>.af-text-control:disabled{cursor:not-allowed;opacity:.5}
af-input>.af-text-control:read-only{cursor:default}
af-input>.af-text-control[type=number]{font-variant-numeric:tabular-nums}
`;

registerComponent({
  styleKey: 'af-input-styles',
  styles: inputStyles,
  elements: { 'af-input': AfInput },
});
