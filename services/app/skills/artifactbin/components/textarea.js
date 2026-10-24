// services/app/lib/html-components/text-control.ts
var textControlAttributes = [
  "value",
  "default-value",
  "type",
  "label",
  "aria-label",
  "name",
  "placeholder",
  "autofocus",
  "required",
  "min",
  "max",
  "step",
  "rows",
  "disabled",
  "readonly",
  "minlength",
  "maxlength",
  "resize"
];
var nextTextControlId = 0;
var initializedTextControls = /* @__PURE__ */ new WeakSet();
var supportedInputTypes = /* @__PURE__ */ new Set(["text", "number", "email", "url", "search", "password"]);
function connectTextControl(host, kind, property = { controlled: () => false, value: () => void 0 }) {
  const doc = host.ownerDocument;
  let native = host.querySelector(kind === "input" ? ":scope > input" : ":scope > textarea");
  if (!native) {
    native = doc.createElement(kind);
    native.className = kind === "input" ? "af-text-control af-text-control-input" : "af-text-control af-text-control-textarea";
    host.append(native);
  }
  let label = host.querySelector(":scope > label[data-af-control-label]");
  if (!label) {
    label = doc.createElement("label");
    label.dataset.afControlLabel = "";
    host.prepend(label);
  }
  if (!native.id) {
    do {
      native.id = `af-${kind}-${++nextTextControlId}`;
    } while (doc.getElementById(native.id) && doc.getElementById(native.id) !== native);
  }
  label.htmlFor = native.id;
  let composing = false;
  let queuedDuringComposition = false;
  const numeric = () => kind === "input" && native.type === "number";
  const current = () => numeric() ? native.value === "" || !Number.isFinite(Number(native.value)) ? null : Number(native.value) : native.value === "" ? null : native.value;
  let acceptedValue = current();
  const setNativeValue = (value) => {
    const next = value == null ? "" : String(value);
    if (native.value !== next) native.value = next;
  };
  const modelValue = () => {
    if (property.controlled()) return property.value() ?? null;
    if (!host.hasAttribute("value")) return acceptedValue;
    const raw = host.getAttribute("value") ?? "";
    if (numeric()) return raw === "" || !Number.isFinite(Number(raw)) ? null : Number(raw);
    return raw === "" ? null : raw;
  };
  const sync = () => {
    const visibleLabel = host.getAttribute("label");
    const ariaLabel = host.getAttribute("aria-label");
    const labelText = visibleLabel ?? ariaLabel ?? "";
    label.textContent = labelText;
    label.hidden = !labelText;
    label.classList.toggle("af-visually-hidden", !visibleLabel && !!ariaLabel);
    for (const attr of ["name", "placeholder", "required", "min", "max", "step", "autofocus", "disabled", "readonly", "minlength", "maxlength"]) {
      const mapped = attr === "autofocus" ? "autofocus" : attr === "readonly" ? "readonly" : attr;
      if (host.hasAttribute(attr)) native.setAttribute(mapped, host.getAttribute(attr) ?? "");
      else native.removeAttribute(mapped);
    }
    if (kind === "input") {
      const requested = host.getAttribute("type")?.toLowerCase() ?? "text";
      native.type = supportedInputTypes.has(requested) ? requested : "text";
    } else {
      const rows = Number(host.getAttribute("rows"));
      native.rows = Number.isInteger(rows) && rows > 0 ? rows : 3;
      const resize = host.getAttribute("resize");
      native.style.resize = resize === "none" || resize === "both" || resize === "horizontal" || resize === "vertical" ? resize : "vertical";
    }
    const controlled = property.controlled() || host.hasAttribute("value");
    if (controlled) {
      if (!composing) setNativeValue(modelValue());
      if (!composing) acceptedValue = modelValue();
    } else if (!initializedTextControls.has(host)) {
      const initial = host.getAttribute("default-value") ?? (kind === "textarea" ? [...host.childNodes].filter((node) => node !== label && node !== native).map((node) => node.textContent ?? "").join("") : "");
      setNativeValue(initial);
      initializedTextControls.add(host);
      acceptedValue = current();
    }
  };
  const commit = () => {
    if (composing) {
      queuedDuringComposition = true;
      return;
    }
    if (native.disabled || native.readOnly) {
      setNativeValue(modelValue());
      return;
    }
    const value = current();
    if (value === acceptedValue) return;
    const detail = numeric() ? { value: value === null ? null : Number(value) } : { value: value === null ? null : String(value) };
    const event = new CustomEvent("af-change", { detail, bubbles: true, composed: true, cancelable: true });
    const accepted = host.dispatchEvent(event);
    if (property.controlled() || host.hasAttribute("value")) sync();
    else if (!accepted) setNativeValue(acceptedValue);
    else acceptedValue = value;
  };
  const onInput = () => commit();
  const onCompositionStart = () => {
    composing = true;
    queuedDuringComposition = false;
  };
  const onCompositionEnd = () => {
    composing = false;
    const changed = current() !== acceptedValue;
    if ((queuedDuringComposition || changed) && changed) {
      queuedDuringComposition = false;
      commit();
    } else sync();
  };
  native.addEventListener("input", onInput);
  native.addEventListener("compositionstart", onCompositionStart);
  native.addEventListener("compositionend", onCompositionEnd);
  const controller = { sync, disconnect: () => {
    native.removeEventListener("input", onInput);
    native.removeEventListener("compositionstart", onCompositionStart);
    native.removeEventListener("compositionend", onCompositionEnd);
  } };
  sync();
  return controller;
}
function getTextControlValue(host, controlledProperty, propertyValue) {
  const native = host.querySelector("input,textarea");
  const number = native?.tagName === "INPUT" && native.type === "number";
  const raw = controlledProperty ? propertyValue == null ? "" : String(propertyValue) : host.hasAttribute("value") ? host.getAttribute("value") ?? "" : native?.value ?? "";
  if (number) return raw === "" || !Number.isFinite(Number(raw)) ? null : Number(raw);
  if (controlledProperty) return propertyValue ?? null;
  if (host.hasAttribute("value")) return raw === "" ? null : raw;
  return native?.value || null;
}

// services/app/lib/html-components/textarea.ts
var AfTextarea = class extends HTMLElement {
  static observedAttributes = [...textControlAttributes];
  controller;
  propertyControlled = false;
  propertyValue;
  get value() {
    return getTextControlValue(this, this.propertyControlled, this.propertyValue);
  }
  set value(value) {
    this.propertyControlled = value !== void 0;
    this.propertyValue = value;
    this.controller?.sync();
  }
  connectedCallback() {
    if (Object.prototype.hasOwnProperty.call(this, "value")) {
      const value = this.value;
      delete this.value;
      this.value = value;
    }
    this.controller?.disconnect();
    this.controller = connectTextControl(this, "textarea", { controlled: () => this.propertyControlled, value: () => this.propertyValue });
  }
  disconnectedCallback() {
    this.controller?.disconnect();
    this.controller = void 0;
  }
  attributeChangedCallback() {
    this.refresh();
  }
  refresh() {
    if (!this.isConnected) return;
    this.controller?.sync();
  }
};
var textareaStyles = `
af-textarea{display:inline-flex;min-width:16rem;flex-direction:column;gap:.375rem;vertical-align:top}
af-textarea>label[data-af-control-label]{font-family:inherit;font-size:11px;font-weight:500;line-height:1.4;letter-spacing:.08em;text-transform:uppercase;color:var(--muted-foreground,#666)}
af-textarea>label[hidden]{display:none}
af-textarea>label.af-visually-hidden{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0}
af-textarea>.af-text-control{box-sizing:border-box;width:100%;min-width:16rem;min-height:36px;border:1px solid var(--input,#d1d5db);border-radius:var(--radius-md,.375rem);background:var(--background,#fff);padding:8px 12px;color:var(--foreground,#111);font-family:inherit;font-size:14px;line-height:20px;box-shadow:0 1px 2px #0000000d;outline:none;transition:color .15s,box-shadow .15s}
af-textarea>.af-text-control::placeholder{color:var(--muted-foreground,#737373)}
af-textarea>.af-text-control:focus-visible{box-shadow:0 0 0 2px color-mix(in srgb,var(--ring,#777) 50%,transparent)}
af-textarea>.af-text-control:disabled{cursor:not-allowed;opacity:.5}
af-textarea>.af-text-control:read-only{cursor:default}
`;
function registerTextarea(registry = customElements, document = globalThis.document) {
  if (!document.querySelector("style[data-af-textarea-styles]")) {
    const style = document.createElement("style");
    style.dataset.afTextareaStyles = "";
    style.textContent = textareaStyles;
    document.head.append(style);
  }
  if (!registry.get("af-textarea")) registry.define("af-textarea", AfTextarea);
}
export {
  registerTextarea
};
