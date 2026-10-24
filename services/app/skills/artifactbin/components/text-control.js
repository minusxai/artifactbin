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
export {
  connectTextControl,
  getTextControlValue,
  textControlAttributes
};
