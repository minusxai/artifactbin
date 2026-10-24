// services/app/lib/html-components/button.ts
var AfButton = class extends HTMLElement {
  static observedAttributes = ["type", "disabled", "busy", "variant", "size", "label", "aria-label", "name", "value"];
  nativeButton;
  get type() {
    return this.getAttribute("type") === "submit" || this.getAttribute("type") === "reset" ? this.getAttribute("type") : "button";
  }
  set type(value) {
    this.setAttribute("type", value);
  }
  get disabled() {
    return this.hasAttribute("disabled");
  }
  set disabled(value) {
    this.toggleAttribute("disabled", Boolean(value));
  }
  get busy() {
    return this.hasAttribute("busy");
  }
  set busy(value) {
    this.toggleAttribute("busy", Boolean(value));
  }
  get variant() {
    return isVariant(this.getAttribute("variant")) ? this.getAttribute("variant") : "default";
  }
  set variant(value) {
    this.setAttribute("variant", value);
  }
  get size() {
    return isSize(this.getAttribute("size")) ? this.getAttribute("size") : "default";
  }
  set size(value) {
    this.setAttribute("size", value);
  }
  get label() {
    return this.getAttribute("label") ?? void 0;
  }
  set label(value) {
    if (value === void 0) this.removeAttribute("label");
    else this.setAttribute("label", value);
  }
  connectedCallback() {
    const properties = this;
    for (const property of ["type", "disabled", "busy", "variant", "size", "label"]) {
      if (Object.prototype.hasOwnProperty.call(this, property)) {
        const value = properties[property];
        delete properties[property];
        properties[property] = value;
      }
    }
    if (!this.nativeButton) {
      const button = this.ownerDocument.createElement("button");
      button.setAttribute("part", "button");
      button.append(...Array.from(this.childNodes));
      this.append(button);
      this.nativeButton = button;
    }
    this.sync();
  }
  attributeChangedCallback() {
    this.sync();
  }
  focus(options) {
    (this.nativeButton ?? this.querySelector("button"))?.focus(options);
  }
  click() {
    const button = this.nativeButton ?? this.querySelector("button");
    if (!button || this.disabled || this.busy) return;
    button.click();
  }
  sync() {
    const button = this.nativeButton;
    if (!button) return;
    button.type = this.type;
    button.disabled = this.disabled || this.busy;
    button.toggleAttribute("aria-busy", this.busy);
    if (this.busy) button.setAttribute("aria-busy", "true");
    button.dataset.variant = this.variant;
    button.dataset.size = this.size;
    const name = this.getAttribute("aria-label") ?? this.getAttribute("label");
    if (name === null) button.removeAttribute("aria-label");
    else button.setAttribute("aria-label", name);
    for (const attr of ["name", "value"]) {
      const value = this.getAttribute(attr);
      if (value === null) button.removeAttribute(attr);
      else button.setAttribute(attr, value);
    }
  }
};
function isVariant(value) {
  return value === "default" || value === "destructive" || value === "outline" || value === "secondary" || value === "ghost" || value === "link";
}
function isSize(value) {
  return value === "default" || value === "xs" || value === "sm" || value === "lg" || value === "icon" || value === "icon-xs" || value === "icon-sm" || value === "icon-lg";
}
var buttonStyles = `
af-button{box-sizing:border-box;display:inline-flex;align-items:center;justify-content:center;vertical-align:middle}
af-button>button{box-sizing:border-box;display:inline-flex;flex-shrink:0;align-items:center;justify-content:center;gap:.5rem;border:1px solid transparent;border-radius:var(--radius-md,.375rem);font-family:inherit;font-size:.875rem;font-weight:500;line-height:1.25rem;white-space:nowrap;cursor:pointer;transition:all .15s;outline:none;color:var(--primary-foreground,#fff);background:var(--primary,#171717)}
af-button>button:focus-visible{border-color:var(--ring,#737373);box-shadow:0 0 0 3px color-mix(in srgb,var(--ring,#737373) 50%,transparent)}
af-button>button:disabled{pointer-events:none;opacity:.5;cursor:default}
af-button>button[data-variant=default]:hover{background:color-mix(in srgb,var(--primary,#171717) 90%,transparent)}
af-button>button[data-variant=destructive]{color:#fff;background:var(--destructive,#dc2626)}
af-button>button[data-variant=destructive]:hover{background:color-mix(in srgb,var(--destructive,#dc2626) 90%,transparent)}
af-button>button[data-variant=outline]{color:var(--foreground,#171717);background:var(--background,#fff);border-color:var(--input,#d4d4d4);box-shadow:0 1px 2px #0000000d}
af-button>button[data-variant=outline]:hover,af-button>button[data-variant=secondary]{background:var(--secondary,#f5f5f5);color:var(--secondary-foreground,#262626)}
af-button>button[data-variant=secondary]:hover{background:color-mix(in srgb,var(--secondary,#f5f5f5) 80%,transparent)}
af-button>button[data-variant=ghost]{color:var(--foreground,#171717);background:transparent}
af-button>button[data-variant=ghost]:hover{background:var(--accent,#f5f5f5);color:var(--accent-foreground,#171717)}
af-button>button[data-variant=link]{color:var(--primary,#171717);background:transparent;text-underline-offset:4px}
af-button>button[data-variant=link]:hover{text-decoration:underline}
af-button>button[data-size=default]{height:2.25rem;padding:.5rem 1rem}
af-button>button[data-size=xs]{height:1.5rem;gap:.25rem;padding:0 .5rem;border-radius:var(--radius-md,.375rem);font-size:.75rem;line-height:1rem}
af-button>button[data-size=sm]{height:2rem;gap:.375rem;padding:0 .75rem}
af-button>button[data-size=lg]{height:2.5rem;padding:0 1.5rem}
af-button>button[data-size=icon]{width:2.25rem;height:2.25rem;padding:0}
af-button>button[data-size=icon-xs]{width:1.5rem;height:1.5rem;padding:0;border-radius:var(--radius-md,.375rem)}
af-button>button[data-size=icon-sm]{width:2rem;height:2rem;padding:0}
af-button>button[data-size=icon-lg]{width:2.5rem;height:2.5rem;padding:0}
af-button>button>svg{pointer-events:none;flex-shrink:0;width:1rem;height:1rem}
 `;
function registerButton(registry = customElements, document = globalThis.document) {
  if (!document.querySelector("style[data-af-button-styles]")) {
    const style = document.createElement("style");
    style.setAttribute("data-af-button-styles", "");
    style.textContent = buttonStyles;
    document.head.append(style);
  }
  if (!registry.get("af-button")) registry.define("af-button", AfButton);
}
export {
  AfButton,
  registerButton
};
