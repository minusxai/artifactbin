// services/app/lib/html-components/switch.ts
var AfSwitch = class extends HTMLElement {
  static observedAttributes = ["label", "aria-label", "checked", "default-checked", "disabled", "read-only", "readonly"];
  shell;
  labelNode;
  button;
  thumb;
  propertyChecked;
  hasPropertyChecked = false;
  state = false;
  initialized = false;
  constructor() {
    super();
    this.upgradeProperty("checked");
  }
  get checked() {
    return this.currentChecked();
  }
  set checked(value) {
    this.hasPropertyChecked = true;
    this.propertyChecked = Boolean(value);
    this.update();
  }
  get disabled() {
    return this.hasAttribute("disabled");
  }
  set disabled(value) {
    this.toggleAttribute("disabled", Boolean(value));
  }
  connectedCallback() {
    if (!this.initialized) {
      this.state = this.hasAttribute("default-checked");
      this.initialized = true;
    }
    this.ensureStructure();
    this.update();
  }
  attributeChangedCallback() {
    this.update();
  }
  currentChecked() {
    if (this.hasPropertyChecked) return this.propertyChecked ?? false;
    if (this.hasAttribute("checked")) return true;
    return this.state;
  }
  upgradeProperty(name) {
    if (Object.prototype.hasOwnProperty.call(this, name)) {
      const value = this[name];
      delete this[name];
      this.checked = Boolean(value);
    }
  }
  ensureStructure() {
    if (this.button) return;
    const doc = this.ownerDocument;
    this.shell = doc.createElement("div");
    this.shell.className = "af-switch-shell";
    this.labelNode = doc.createElement("span");
    this.labelNode.className = "af-switch-label";
    this.button = doc.createElement("button");
    this.button.type = "button";
    this.button.className = "af-switch-button";
    this.button.setAttribute("role", "switch");
    this.thumb = doc.createElement("span");
    this.thumb.className = "af-switch-thumb";
    this.thumb.setAttribute("aria-hidden", "true");
    this.button.append(this.thumb);
    this.shell.append(this.labelNode, this.button);
    this.prepend(this.shell);
    this.button.addEventListener("click", this.activate);
  }
  activate = () => {
    if (this.disabled || this.hasAttribute("read-only") || this.hasAttribute("readonly")) return;
    const value = !this.currentChecked();
    const accepted = this.dispatchEvent(new CustomEvent("af-change", {
      bubbles: true,
      composed: true,
      cancelable: true,
      detail: { value }
    }));
    if (!accepted) {
      this.update();
      return;
    }
    if (!this.hasPropertyChecked && !this.hasAttribute("checked")) this.state = value;
    this.update();
  };
  update() {
    if (!this.button || !this.labelNode) return;
    const label = this.getAttribute("label") ?? "";
    this.labelNode.textContent = label;
    this.labelNode.hidden = !label;
    const accessibleName = this.getAttribute("aria-label") || label;
    if (accessibleName) this.button.setAttribute("aria-label", accessibleName);
    else this.button.removeAttribute("aria-label");
    const checked = this.currentChecked();
    this.button.setAttribute("aria-checked", String(checked));
    this.button.disabled = this.disabled;
    this.button.setAttribute("aria-readonly", String(this.hasAttribute("read-only") || this.hasAttribute("readonly")));
    this.button.setAttribute("data-state", checked ? "checked" : "unchecked");
  }
};
var switchStyles = `
af-switch{display:inline-flex;vertical-align:top}
af-switch .af-switch-shell{display:inline-flex;flex-direction:column;gap:.375rem;align-items:flex-start}
af-switch .af-switch-label{font-size:11px;font-weight:500;line-height:1.25;color:var(--muted-foreground,#555)}
af-switch .af-switch-label[hidden]{display:none}
af-switch .af-switch-button{position:relative;display:inline-flex;box-sizing:border-box;width:36px;height:20px;flex-shrink:0;align-items:center;border:0;border-radius:9999px;padding:0;cursor:pointer;background:var(--input,#ddd);box-shadow:0 1px 2px #0000000d;transition:background-color .15s;outline:none}
af-switch .af-switch-button[data-state=checked]{background:var(--primary,#222)}
af-switch .af-switch-button:focus-visible{outline:2px solid color-mix(in srgb,var(--ring,#777) 50%,transparent);outline-offset:2px}
af-switch .af-switch-button:disabled{cursor:not-allowed;opacity:.5}
af-switch .af-switch-thumb{display:block;width:16px;height:16px;margin-left:2px;border-radius:9999px;background:var(--background,#fff);box-shadow:0 1px 2px #0000001a;transform:translateX(0);transition:transform .15s}
af-switch .af-switch-button[data-state=checked] .af-switch-thumb{transform:translateX(16px)}
`;
function registerSwitch(registry = customElements, document = globalThis.document) {
  if (!document.querySelector("style[data-af-switch-styles]")) {
    const style = document.createElement("style");
    style.setAttribute("data-af-switch-styles", "");
    style.textContent = switchStyles;
    document.head.append(style);
  }
  if (!registry.get("af-switch")) registry.define("af-switch", AfSwitch);
}
export {
  AfSwitch,
  registerSwitch
};
