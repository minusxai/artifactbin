// services/app/lib/html-components/segmented.ts
var isValue = (value) => value === null || typeof value === "string" || typeof value === "boolean" || typeof value === "number" && Number.isFinite(value);
var keyOf = (value) => `${typeof value}:${String(value)}`;
var AfSegmented = class extends HTMLElement {
  static observedAttributes = ["value", "default-value", "disabled", "orientation", "label", "aria-label"];
  optionValues = [];
  buttons = /* @__PURE__ */ new Map();
  buttonOptions = /* @__PURE__ */ new WeakMap();
  selection = null;
  controlled = false;
  propertyValue;
  initialized = false;
  writingValue = false;
  defaultValueOverride = null;
  hasDefaultValueOverride = false;
  writingDefaultValue = false;
  mappedLabel = false;
  writingMappedLabel = false;
  get options() {
    return this.optionValues;
  }
  set options(value) {
    this.optionValues = Array.isArray(value) ? value.filter((item) => isValue(item) || item !== null && typeof item === "object" && isValue(item.value) && typeof item.label === "string") : [];
    this.render();
  }
  get value() {
    if (this.propertyValue !== void 0) return this.propertyValue;
    if (this.hasAttribute("value")) return this.fromAttribute(this.getAttribute("value") ?? "");
    return this.selection;
  }
  set value(value) {
    this.controlled = true;
    this.propertyValue = isValue(value) ? value : null;
    this.writingValue = true;
    this.toggleAttribute("value", this.propertyValue !== null);
    if (this.propertyValue !== null) this.setAttribute("value", String(this.propertyValue));
    this.writingValue = false;
    this.render();
  }
  get defaultValue() {
    if (this.hasDefaultValueOverride) return this.defaultValueOverride;
    return this.hasAttribute("default-value") ? this.fromAttribute(this.getAttribute("default-value") ?? "") : null;
  }
  set defaultValue(value) {
    this.defaultValueOverride = isValue(value) ? value : null;
    this.hasDefaultValueOverride = true;
    this.writingDefaultValue = true;
    if (this.defaultValueOverride === null) this.setAttribute("default-value", "");
    else this.setAttribute("default-value", String(this.defaultValueOverride));
    this.writingDefaultValue = false;
  }
  get disabled() {
    return this.hasAttribute("disabled");
  }
  set disabled(value) {
    this.toggleAttribute("disabled", Boolean(value));
  }
  get orientation() {
    return this.getAttribute("orientation") === "vertical" ? "vertical" : "horizontal";
  }
  set orientation(value) {
    this.setAttribute("orientation", value === "vertical" ? "vertical" : "horizontal");
  }
  connectedCallback() {
    for (const name of ["options", "value", "defaultValue", "disabled", "orientation"]) {
      if (!Object.prototype.hasOwnProperty.call(this, name)) continue;
      const value = this[name];
      delete this[name];
      this[name] = value;
    }
    if (!this.initialized) {
      this.selection = this.defaultValue;
      this.initialized = true;
    }
    this.addEventListener("click", this.onClick);
    this.addEventListener("keydown", this.onKeyDown);
    this.render();
  }
  disconnectedCallback() {
    this.removeEventListener("click", this.onClick);
    this.removeEventListener("keydown", this.onKeyDown);
  }
  attributeChangedCallback(name) {
    if (name === "value" && !this.writingValue) this.propertyValue = void 0;
    if (name === "default-value" && !this.writingDefaultValue) this.hasDefaultValueOverride = false;
    if (name === "aria-label") {
      if (this.writingMappedLabel) return;
      this.mappedLabel = false;
      this.syncLabel();
    }
    this.render();
  }
  fromAttribute(raw) {
    const match = this.normalized().find((option) => String(option.value ?? "") === raw);
    return match?.value ?? (raw === "" && this.normalized().some((option) => option.value === null) ? null : raw);
  }
  normalized() {
    const unique = /* @__PURE__ */ new Map();
    for (const item of this.optionValues) {
      const option = isValue(item) ? { value: item, label: item === null ? "All" : String(item) } : item;
      if (!unique.has(keyOf(option.value))) unique.set(keyOf(option.value), option);
    }
    return [...unique.values()];
  }
  ownedButtons() {
    return [...this.children].filter((node) => node instanceof HTMLButtonElement && node.hasAttribute("data-segment-option"));
  }
  syncLabel() {
    if (!this.isConnected || this.writingMappedLabel) return;
    const label = this.getAttribute("label");
    if (this.hasAttribute("aria-label") && !this.mappedLabel) return;
    if (label !== null) {
      this.writingMappedLabel = true;
      this.setAttribute("aria-label", label);
      this.writingMappedLabel = false;
      this.mappedLabel = true;
    } else if (this.mappedLabel) {
      this.writingMappedLabel = true;
      this.removeAttribute("aria-label");
      this.writingMappedLabel = false;
      this.mappedLabel = false;
    }
  }
  controlledValue() {
    return this.propertyValue !== void 0 || this.hasAttribute("value") || this.controlled;
  }
  currentValue() {
    if (this.propertyValue !== void 0) return this.propertyValue;
    if (this.hasAttribute("value")) return this.fromAttribute(this.getAttribute("value") ?? "");
    return this.selection;
  }
  render() {
    if (!this.isConnected) return;
    this.setAttribute("role", "group");
    this.syncLabel();
    this.dataset.orientation = this.orientation;
    this.dataset.disabled = String(this.disabled);
    const normalized = this.normalized();
    const active = normalized.find((option) => option.value === this.currentValue()) ?? normalized[0];
    const validKeys = /* @__PURE__ */ new Set();
    normalized.forEach((option, index) => {
      const key = keyOf(option.value);
      validKeys.add(key);
      let button = this.buttons.get(key);
      if (!button) {
        button = this.ownerDocument.createElement("button");
        button.type = "button";
        button.dataset.segmentOption = "";
        this.buttons.set(key, button);
      }
      button.textContent = option.label;
      button.disabled = this.disabled;
      button.setAttribute("aria-pressed", String(option.value === this.currentValue()));
      button.tabIndex = !this.disabled && option === active ? 0 : -1;
      button.dataset.state = option.value === this.currentValue() ? "active" : "inactive";
      button.dataset.value = String(option.value ?? "");
      this.buttonOptions.set(button, option);
      const owned = this.ownedButtons();
      const desiredAtIndex = owned[index];
      if (desiredAtIndex !== button) this.insertBefore(button, desiredAtIndex ?? null);
    });
    for (const [key, button] of this.buttons) if (!validKeys.has(key)) {
      button.remove();
      this.buttons.delete(key);
    }
  }
  optionFor(button) {
    if (!button || button.parentElement !== this || button.closest("af-segmented") !== this) return void 0;
    return this.buttonOptions.get(button);
  }
  choose(option) {
    if (this.disabled || option.value === this.currentValue()) return;
    const event = new CustomEvent("af-change", { detail: { value: option.value }, bubbles: true, composed: true, cancelable: true });
    if (this.dispatchEvent(event) && !this.controlledValue()) this.selection = option.value;
    this.render();
  }
  onClick = (event) => {
    const target = event.target instanceof Element ? event.target.closest("button[data-segment-option]") : null;
    const option = this.optionFor(target);
    if (option) this.choose(option);
  };
  onKeyDown = (event) => {
    const target = event.target instanceof Element ? event.target.closest("button[data-segment-option]") : null;
    const current = this.optionFor(target);
    if (!current || this.disabled || event.defaultPrevented) return;
    const options = this.normalized();
    const index = this.ownedButtons().indexOf(target);
    const rtl = (this.closest("[dir]")?.getAttribute("dir") ?? getComputedStyle(this).direction) === "rtl";
    const forward = this.orientation === "vertical" ? "ArrowDown" : rtl ? "ArrowLeft" : "ArrowRight";
    const backward = this.orientation === "vertical" ? "ArrowUp" : rtl ? "ArrowRight" : "ArrowLeft";
    let next = -1;
    if (event.key === forward) next = (index + 1) % options.length;
    else if (event.key === backward) next = (index - 1 + options.length) % options.length;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = options.length - 1;
    if (next < 0 || !options[next]) return;
    event.preventDefault();
    this.buttons.get(keyOf(options[next].value))?.focus();
    this.choose(options[next]);
  };
};
var segmentedStyles = `
af-segmented{display:inline-flex;align-items:center;gap:.125rem;width:fit-content;box-sizing:border-box;border:1px solid var(--input,#ddd);border-radius:var(--radius-md,.375rem);padding:.125rem;background:color-mix(in srgb,var(--muted,#eee) 40%,transparent);box-shadow:0 1px 2px #0000000d}
af-segmented[data-orientation=vertical]{flex-direction:column;align-items:stretch}
af-segmented>button[data-segment-option]{position:relative;box-sizing:border-box;height:2rem;cursor:pointer;border:0;border-radius:5px;padding:0 .75rem;background:transparent;color:var(--muted-foreground,#555);font:inherit;font-size:.875rem;transition:background-color .15s,color .15s}
af-segmented>button[data-segment-option][data-state=active]{background:var(--primary,#222);color:var(--primary-foreground,#fff);box-shadow:0 1px 2px #0000000d}
af-segmented>button[data-segment-option]:not([data-state=active]):hover{background:color-mix(in srgb,var(--foreground,#222) 10%,transparent);color:var(--foreground,#222)}
af-segmented>button[data-segment-option]:focus-visible{z-index:1;outline:2px solid color-mix(in srgb,var(--ring,#777) 50%,transparent);outline-offset:2px}
af-segmented>button[data-segment-option]:disabled{cursor:not-allowed;opacity:.5}
`;
function registerSegmented(registry = customElements, document = globalThis.document) {
  if (!document.querySelector("style[data-af-segmented-styles]")) {
    const style = document.createElement("style");
    style.setAttribute("data-af-segmented-styles", "");
    style.textContent = segmentedStyles;
    document.head.append(style);
  }
  if (!registry.get("af-segmented")) registry.define("af-segmented", AfSegmented);
}
export {
  AfSegmented,
  registerSegmented,
  segmentedStyles
};
