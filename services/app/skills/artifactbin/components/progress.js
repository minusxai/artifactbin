// services/app/lib/html-components/progress.ts
var validProgressValue = (value) => typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 100;
var AfProgress = class extends HTMLElement {
  static observedAttributes = ["value", "label", "aria-label"];
  indicator;
  propertyValue;
  generatedLabel = false;
  writingMappedLabel = false;
  get value() {
    if (this.propertyValue !== void 0) return this.propertyValue;
    const attribute = this.getAttribute("value");
    if (attribute === null || attribute.trim() === "") return null;
    const value = Number(attribute);
    return validProgressValue(value) ? value : null;
  }
  set value(value) {
    const normalized = validProgressValue(value) ? value : null;
    this.propertyValue = normalized;
    if (normalized === null) this.removeAttribute("value");
    else this.setAttribute("value", String(normalized));
    this.render();
  }
  connectedCallback() {
    if (Object.prototype.hasOwnProperty.call(this, "value")) {
      const value = this.value;
      delete this.value;
      this.value = value;
    }
    this.syncLabel();
    this.render();
  }
  attributeChangedCallback(name) {
    if (name === "aria-label") {
      if (this.writingMappedLabel) return;
      this.generatedLabel = false;
      this.syncLabel();
      return;
    }
    if (name === "label") this.syncLabel();
    this.propertyValue = void 0;
    this.render();
  }
  syncLabel() {
    if (!this.isConnected || this.writingMappedLabel) return;
    const label = this.getAttribute("label");
    if (this.hasAttribute("aria-label") && !this.generatedLabel) return;
    if (label !== null) {
      this.writingMappedLabel = true;
      this.setAttribute("aria-label", label);
      this.writingMappedLabel = false;
      this.generatedLabel = true;
    } else if (this.generatedLabel) {
      this.writingMappedLabel = true;
      this.removeAttribute("aria-label");
      this.writingMappedLabel = false;
      this.generatedLabel = false;
    }
  }
  render() {
    if (!this.isConnected) return;
    const value = this.value;
    const determinate = value !== null;
    const state = !determinate ? "indeterminate" : value === 100 ? "complete" : "loading";
    this.setAttribute("role", "progressbar");
    this.setAttribute("aria-valuemin", "0");
    this.setAttribute("aria-valuemax", "100");
    if (determinate) this.setAttribute("aria-valuenow", String(value));
    else this.removeAttribute("aria-valuenow");
    this.dataset.slot = "progress";
    this.dataset.state = state;
    if (determinate) this.dataset.value = String(value);
    else delete this.dataset.value;
    this.dataset.max = "100";
    if (!this.indicator || this.indicator.parentElement !== this) {
      this.indicator = [...this.children].find((child) => child instanceof HTMLDivElement && child.dataset.slot === "progress-indicator") ?? void 0;
      if (!this.indicator) {
        this.indicator = this.ownerDocument.createElement("div");
        this.indicator.dataset.slot = "progress-indicator";
        this.append(this.indicator);
      }
    }
    this.indicator.dataset.state = state;
    if (determinate) this.indicator.dataset.value = String(value);
    else delete this.indicator.dataset.value;
    this.indicator.dataset.max = "100";
    this.indicator.style.transform = `translateX(-${100 - (value ?? 0)}%)`;
  }
};
var progressStyles = `
af-progress{display:block;position:relative;box-sizing:border-box;width:100%;height:.5rem;overflow:hidden;border-radius:var(--radius-full,9999px);background:color-mix(in srgb,var(--primary,#222) 20%,transparent)}
af-progress>[data-slot=progress-indicator]{box-sizing:border-box;display:flex;width:100%;height:100%;flex:1;background:var(--primary,#222);transition:transform .2s ease}
af-progress[data-state=indeterminate]>[data-slot=progress-indicator]{width:40%;animation:af-progress-indeterminate 1.4s ease-in-out infinite}
@keyframes af-progress-indeterminate{from{transform:translateX(-100%)}to{transform:translateX(250%)}}
@media(prefers-reduced-motion:reduce){af-progress>[data-slot=progress-indicator]{transition:none}af-progress[data-state=indeterminate]>[data-slot=progress-indicator]{animation:none;transform:translateX(0)}}
`;
function registerProgress(registry = customElements, document = globalThis.document) {
  if (!document.querySelector("style[data-af-progress-styles]")) {
    const style = document.createElement("style");
    style.setAttribute("data-af-progress-styles", "");
    style.textContent = progressStyles;
    document.head.append(style);
  }
  if (!registry.get("af-progress")) registry.define("af-progress", AfProgress);
}
export {
  AfProgress,
  progressStyles,
  registerProgress
};
