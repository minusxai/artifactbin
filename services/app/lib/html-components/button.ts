/** Public attributes and forwarded properties supported by the native light-DOM button. */
export type ButtonVariant = 'default' | 'destructive' | 'outline' | 'secondary' | 'ghost' | 'link';
export type ButtonSize = 'default' | 'xs' | 'sm' | 'lg' | 'icon' | 'icon-xs' | 'icon-sm' | 'icon-lg';
export type ButtonType = 'button' | 'submit' | 'reset';
export interface ButtonContract {
  type: ButtonType;
  disabled: boolean;
  busy: boolean;
  variant: ButtonVariant;
  size: ButtonSize;
  label: string | undefined;
  focus(options?: FocusOptions): void;
}

export class AfButton extends HTMLElement implements ButtonContract {
  static observedAttributes = ['type', 'disabled', 'busy', 'variant', 'size', 'label', 'aria-label', 'name', 'value'];
  private nativeButton: HTMLButtonElement | undefined;
  get type(): ButtonType { return this.getAttribute('type') === 'submit' || this.getAttribute('type') === 'reset' ? this.getAttribute('type') as ButtonType : 'button'; }
  set type(value: ButtonType) { this.setAttribute('type', value); }
  get disabled(): boolean { return this.hasAttribute('disabled'); }
  set disabled(value: boolean) { this.toggleAttribute('disabled', Boolean(value)); }
  get busy(): boolean { return this.hasAttribute('busy'); }
  set busy(value: boolean) { this.toggleAttribute('busy', Boolean(value)); }
  get variant(): ButtonVariant { return isVariant(this.getAttribute('variant')) ? this.getAttribute('variant') as ButtonVariant : 'default'; }
  set variant(value: ButtonVariant) { this.setAttribute('variant', value); }
  get size(): ButtonSize { return isSize(this.getAttribute('size')) ? this.getAttribute('size') as ButtonSize : 'default'; }
  set size(value: ButtonSize) { this.setAttribute('size', value); }
  get label(): string | undefined { return this.getAttribute('label') ?? undefined; }
  set label(value: string | undefined) { if (value === undefined) this.removeAttribute('label'); else this.setAttribute('label', value); }

  connectedCallback(): void {
    const properties = this as unknown as Record<string, unknown>;
    for (const property of ['type', 'disabled', 'busy', 'variant', 'size', 'label'] as const) {
      if (Object.prototype.hasOwnProperty.call(this, property)) {
        const value = properties[property];
        delete properties[property];
        properties[property] = value;
      }
    }
    if (!this.nativeButton) {
      const button = this.ownerDocument.createElement('button');
      button.setAttribute('part', 'button');
      // Move authored nodes exactly once so stable platform identities and listeners survive.
      button.append(...Array.from(this.childNodes));
      this.append(button);
      this.nativeButton = button;
    }
    this.sync();
  }

  attributeChangedCallback(): void { this.sync(); }
  focus(options?: FocusOptions): void { (this.nativeButton ?? this.querySelector('button'))?.focus(options); }
  click(): void {
    const button = this.nativeButton ?? this.querySelector('button');
    if (!button || this.disabled || this.busy) return;
    button.click();
  }

  private sync(): void {
    const button = this.nativeButton;
    if (!button) return;
    button.type = this.type;
    button.disabled = this.disabled || this.busy;
    button.toggleAttribute('aria-busy', this.busy);
    if (this.busy) button.setAttribute('aria-busy', 'true');
    button.dataset.variant = this.variant;
    button.dataset.size = this.size;
    const name = this.getAttribute('aria-label') ?? this.getAttribute('label');
    if (name === null) button.removeAttribute('aria-label'); else button.setAttribute('aria-label', name);
    for (const attr of ['name', 'value']) {
      const value = this.getAttribute(attr);
      if (value === null) button.removeAttribute(attr); else button.setAttribute(attr, value);
    }
  }
}

function isVariant(value: string | null): value is ButtonVariant {
  return value === 'default' || value === 'destructive' || value === 'outline' || value === 'secondary' || value === 'ghost' || value === 'link';
}
function isSize(value: string | null): value is ButtonSize {
  return value === 'default' || value === 'xs' || value === 'sm' || value === 'lg' || value === 'icon' || value === 'icon-xs' || value === 'icon-sm' || value === 'icon-lg';
}

/** Semantic-token styling for the recipes supported by the author contract. */
const buttonStyles = `
af-button{box-sizing:border-box;display:inline-flex;align-items:center;justify-content:center;vertical-align:middle}
af-button>button{box-sizing:border-box;display:inline-flex;flex-shrink:0;align-items:center;justify-content:center;gap:.5rem;border:1px solid transparent;border-radius:var(--radius-md,calc(var(--radius,.625rem) - 2px));font-family:inherit;font-size:.875rem;font-weight:500;line-height:1.25rem;white-space:nowrap;cursor:pointer;transition:all .15s;outline:none;color:var(--primary-foreground,#fff);background:var(--primary,#171717)}
af-button>button:focus-visible{border-color:var(--ring,#737373);box-shadow:0 0 0 3px color-mix(in srgb,var(--ring,#737373) 50%,transparent)}
af-button>button:disabled{pointer-events:none;opacity:.5;cursor:default}
af-button>button[data-variant=default]:hover{background:color-mix(in srgb,var(--primary,#171717) 90%,transparent)}
af-button>button[data-variant=destructive]{color:#fff;background:var(--destructive,#dc2626)}
af-button>button[data-variant=destructive]:hover{background:color-mix(in srgb,var(--destructive,#dc2626) 90%,transparent)}
af-button>button[data-variant=outline]{color:var(--foreground,#171717);background:var(--background,#fff);border-color:var(--border,#d4d4d4);box-shadow:0 1px 2px rgb(0 0 0 / .05)}
af-button>button[data-variant=outline]:hover{background:var(--accent,#f5f5f5);color:var(--accent-foreground,#171717)}
af-button>button[data-variant=secondary]{background:var(--secondary,#f5f5f5);color:var(--secondary-foreground,#262626)}
af-button>button[data-variant=secondary]:hover{background:color-mix(in srgb,var(--secondary,#f5f5f5) 80%,transparent)}
af-button>button[data-variant=ghost]{color:var(--foreground,#171717);background:transparent}
af-button>button[data-variant=ghost]:hover{background:var(--accent,#f5f5f5);color:var(--accent-foreground,#171717)}
af-button>button[data-variant=link]{color:var(--primary,#171717);background:transparent;text-underline-offset:4px}
af-button>button[data-variant=link]:hover{text-decoration:underline}
af-button>button[data-size=default]{height:2.25rem;padding:.5rem 1rem}
af-button>button[data-size=xs]{height:1.5rem;gap:.25rem;padding:0 .5rem;border-radius:var(--radius-md,calc(var(--radius,.625rem) - 2px));font-size:.75rem;line-height:1rem}
af-button>button[data-size=sm]{height:2rem;gap:.375rem;padding:0 .75rem}
af-button>button[data-size=lg]{height:2.5rem;padding:0 1.5rem}
af-button>button[data-size=icon]{width:2.25rem;height:2.25rem;padding:0}
af-button>button[data-size=icon-xs]{width:1.5rem;height:1.5rem;padding:0;border-radius:var(--radius-md,calc(var(--radius,.625rem) - 2px))}
af-button>button[data-size=icon-sm]{width:2rem;height:2rem;padding:0}
af-button>button[data-size=icon-lg]{width:2.5rem;height:2.5rem;padding:0}
af-button>button[data-size=default]:has(>svg){padding-inline:.75rem}
af-button>button[data-size=xs]:has(>svg){padding-inline:.375rem}
af-button>button[data-size=sm]:has(>svg){padding-inline:.625rem}
af-button>button[data-size=lg]:has(>svg){padding-inline:1rem}
af-button>button>svg{pointer-events:none;flex-shrink:0;width:1rem;height:1rem}
af-button>button[data-size=xs]>svg,af-button>button[data-size=icon-xs]>svg{width:.75rem;height:.75rem}
html[data-af-dark="true"] af-button>button[data-variant=outline]{border-color:var(--input,#d4d4d4);background:color-mix(in srgb,var(--input,#d4d4d4) 30%,transparent)}
html[data-af-dark="true"] af-button>button[data-variant=outline]:hover{background:color-mix(in srgb,var(--input,#d4d4d4) 50%,transparent)}
html[data-af-dark="true"] af-button>button[data-variant=ghost]:hover{background:color-mix(in srgb,var(--accent,#f5f5f5) 50%,transparent)}
html[data-af-dark="true"] af-button>button[data-variant=destructive]{background:color-mix(in srgb,var(--destructive,#dc2626) 60%,transparent)}
html[data-af-dark="true"] af-button>button:focus-visible{box-shadow:0 0 0 3px color-mix(in srgb,var(--ring,#737373) 40%,transparent)}
 `;

export function registerButton(registry: CustomElementRegistry = customElements, document: Document = globalThis.document): void {
  if (!document.querySelector('style[data-af-button-styles]')) {
    const style = document.createElement('style'); style.setAttribute('data-af-button-styles', ''); style.textContent = buttonStyles; document.head.append(style);
  }
  if (!registry.get('af-button')) registry.define('af-button', AfButton);
}
