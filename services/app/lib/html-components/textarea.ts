import { connectTextControl, getTextControlValue, textControlAttributes, type TextControlContract } from './text-control';

class AfTextarea extends HTMLElement implements TextControlContract {
  static observedAttributes = [...textControlAttributes];
  private cleanup?: () => void;
  private propertyControlled = false;
  private propertyValue: string | number | null | undefined;
  get value(): string | number | null { return getTextControlValue(this, this.propertyControlled, this.propertyValue); }
  set value(value: string | number | null | undefined) { this.propertyControlled = value !== undefined; this.propertyValue = value; if (this.isConnected) this.refresh(); }
  connectedCallback(): void {
    if (Object.prototype.hasOwnProperty.call(this, 'value')) {
      const value = this.value; delete (this as {value?: string | number | null}).value; this.value = value;
    }
    this.cleanup?.(); this.cleanup = connectTextControl(this, 'textarea', {controlled:this.propertyControlled,value:this.propertyValue});
  }
  disconnectedCallback(): void { this.cleanup?.(); this.cleanup = undefined; }
  attributeChangedCallback(): void { this.refresh(); }
  private refresh(): void { if (!this.isConnected) return; this.cleanup?.(); this.cleanup = connectTextControl(this, 'textarea', {controlled:this.propertyControlled,value:this.propertyValue}); }
}

const textareaStyles = `
af-textarea{display:inline-flex;min-width:16rem;flex-direction:column;gap:.375rem;vertical-align:top}
af-textarea>label[data-af-control-label]{font-family:inherit;font-size:11px;font-weight:500;line-height:1.4;letter-spacing:.08em;text-transform:uppercase;color:var(--muted-foreground,#666)}
af-textarea>label[hidden]{display:none}
af-textarea>.af-text-control{box-sizing:border-box;width:100%;min-width:16rem;min-height:36px;border:1px solid var(--input,#d1d5db);border-radius:var(--radius-md,.375rem);background:var(--background,#fff);padding:8px 12px;color:var(--foreground,#111);font-family:inherit;font-size:14px;line-height:20px;box-shadow:0 1px 2px #0000000d;outline:none;transition:color .15s,box-shadow .15s}
af-textarea>.af-text-control::placeholder{color:var(--muted-foreground,#737373)}
af-textarea>.af-text-control:focus-visible{box-shadow:0 0 0 2px color-mix(in srgb,var(--ring,#777) 50%,transparent)}
af-textarea>.af-text-control:disabled{cursor:not-allowed;opacity:.5}
af-textarea>.af-text-control:read-only{cursor:default}
`;

export function registerTextarea(registry: CustomElementRegistry = customElements, document: Document = globalThis.document): void {
  if (!document.querySelector('style[data-af-textarea-styles]')) {
    const style = document.createElement('style'); style.dataset.afTextareaStyles = ''; style.textContent = textareaStyles; document.head.append(style);
  }
  if (!registry.get('af-textarea')) registry.define('af-textarea', AfTextarea);
}
