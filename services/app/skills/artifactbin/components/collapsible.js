// services/app/lib/html-components/collapsible.ts
var nextId = 0;
var AfCollapsible = class extends HTMLElement {
  static observedAttributes = ["open", "disabled"];
  expanded = false;
  initialized = false;
  propertyControlled = false;
  propertyValue = false;
  triggerSemantics = /* @__PURE__ */ new WeakMap();
  nativeButtonDisabled = /* @__PURE__ */ new WeakMap();
  disabledNativeButtons = /* @__PURE__ */ new WeakSet();
  observer = new MutationObserver(() => this.sync());
  get open() {
    return this.propertyControlled ? this.propertyValue : this.hasAttribute("open") || !this.hasAttribute("open") && this.expanded;
  }
  set open(value) {
    this.propertyControlled = true;
    this.propertyValue = Boolean(value);
    this.sync();
  }
  connectedCallback() {
    if (Object.prototype.hasOwnProperty.call(this, "open")) {
      const value = this.open;
      delete this.open;
      this.open = value;
    }
    if (!this.initialized) {
      this.expanded = this.hasAttribute("default-open");
      this.initialized = true;
    }
    this.addEventListener("click", this.onClick);
    this.addEventListener("keydown", this.onKeydown);
    this.observer.observe(this, { childList: true, subtree: true, attributes: true, attributeFilter: ["open", "disabled", "id"] });
    this.sync();
  }
  disconnectedCallback() {
    this.observer.disconnect();
    this.removeEventListener("click", this.onClick);
    this.removeEventListener("keydown", this.onKeydown);
  }
  attributeChangedCallback() {
    this.sync();
  }
  own(selector) {
    return [...this.querySelectorAll(selector)].filter((node) => node.closest("af-collapsible") === this);
  }
  triggerTarget(event) {
    const target = event.target instanceof Element ? event.target.closest("af-collapsible-trigger") : null;
    return target?.closest("af-collapsible") === this ? target : void 0;
  }
  request(value) {
    if (this.hasAttribute("disabled") || value === this.open) return;
    const event = new CustomEvent("af-change", { detail: { value }, bubbles: true, composed: true, cancelable: true });
    if (this.dispatchEvent(event) && !this.propertyControlled && !this.hasAttribute("open")) this.expanded = value;
    this.sync();
  }
  onClick = (event) => {
    const trigger = this.triggerTarget(event);
    const nativeButton = event.target instanceof Element ? event.target.closest("button") : null;
    if (trigger && !event.defaultPrevented && !this.hasAttribute("disabled") && !trigger.hasAttribute("disabled") && !nativeButton?.disabled) this.request(!this.open);
  };
  onKeydown = (event) => {
    const trigger = this.triggerTarget(event);
    if (!trigger || event.target !== trigger || event.defaultPrevented || this.hasAttribute("disabled") || trigger.hasAttribute("disabled")) return;
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    this.request(!this.open);
  };
  identify(node, kind) {
    if (node.id) return;
    let id;
    do {
      id = `af-collapsible-${kind}-${++nextId}`;
    } while (this.ownerDocument.getElementById(id));
    node.id = id;
  }
  sync() {
    if (!this.isConnected) return;
    const open = this.open;
    const disabled = this.hasAttribute("disabled");
    const triggers = this.own("af-collapsible-trigger");
    const contents = this.own("af-collapsible-content");
    const content = contents[0];
    if (content) this.identify(content, "content");
    for (const trigger of triggers) {
      this.identify(trigger, "trigger");
      if (!this.triggerSemantics.has(trigger)) this.triggerSemantics.set(trigger, { role: trigger.getAttribute("role"), tabindex: trigger.getAttribute("tabindex") });
      const nativeButtons = [...trigger.querySelectorAll("button")].filter((button) => button.closest("af-collapsible") === this);
      const triggerDisabled = disabled || trigger.hasAttribute("disabled");
      if (nativeButtons.length) {
        trigger.removeAttribute("role");
        trigger.removeAttribute("tabindex");
        trigger.removeAttribute("aria-expanded");
        trigger.removeAttribute("aria-controls");
        trigger.removeAttribute("aria-disabled");
        for (const button of nativeButtons) {
          if (triggerDisabled) {
            if (!this.disabledNativeButtons.has(button)) this.nativeButtonDisabled.set(button, button.hasAttribute("disabled"));
            if (!button.hasAttribute("disabled")) button.setAttribute("disabled", "");
            this.disabledNativeButtons.add(button);
          } else if (this.disabledNativeButtons.has(button)) {
            if (this.nativeButtonDisabled.get(button)) {
              if (!button.hasAttribute("disabled")) button.setAttribute("disabled", "");
            } else if (button.hasAttribute("disabled")) button.removeAttribute("disabled");
            this.disabledNativeButtons.delete(button);
            this.nativeButtonDisabled.delete(button);
          }
          button.setAttribute("aria-expanded", String(open));
          button.setAttribute("aria-disabled", String(triggerDisabled || button.disabled));
          if (content) button.setAttribute("aria-controls", content.id);
          else button.removeAttribute("aria-controls");
        }
      } else {
        const semantics = this.triggerSemantics.get(trigger);
        trigger.setAttribute("role", "button");
        trigger.setAttribute("aria-expanded", String(open));
        trigger.setAttribute("aria-disabled", String(triggerDisabled));
        if (content) trigger.setAttribute("aria-controls", content.id);
        else trigger.removeAttribute("aria-controls");
        if (triggerDisabled) trigger.tabIndex = -1;
        else if (semantics?.tabindex === null) trigger.tabIndex = 0;
        else if (semantics?.tabindex !== void 0) trigger.setAttribute("tabindex", semantics.tabindex);
      }
      trigger.dataset.state = open ? "open" : "closed";
    }
    for (const panel of contents) {
      panel.hidden = !open;
      panel.toggleAttribute("inert", !open);
      panel.dataset.state = open ? "open" : "closed";
    }
  }
};
var AfCollapsibleTrigger = class extends HTMLElement {
};
var AfCollapsibleContent = class extends HTMLElement {
};
var collapsibleStyles = `
af-collapsible{display:block}
af-collapsible-trigger{box-sizing:border-box;display:inline-flex;align-items:center;justify-content:center;gap:.5rem;cursor:pointer;font-family:inherit;color:inherit}
af-collapsible-trigger:focus-visible{outline:2px solid color-mix(in srgb,var(--ring,#777) 50%,transparent);outline-offset:2px}
af-collapsible-trigger[aria-disabled=true]{opacity:.5;cursor:default}
af-collapsible-content{display:block;overflow:hidden}
af-collapsible-content[hidden]{display:none!important}
`;
function registerCollapsible(registry = customElements, document = globalThis.document) {
  if (!document.querySelector("style[data-af-collapsible-styles]")) {
    const style = document.createElement("style");
    style.setAttribute("data-af-collapsible-styles", "");
    style.textContent = collapsibleStyles;
    document.head.append(style);
  }
  for (const [name, ctor] of Object.entries({ "af-collapsible": AfCollapsible, "af-collapsible-trigger": AfCollapsibleTrigger, "af-collapsible-content": AfCollapsibleContent })) {
    if (!registry.get(name)) registry.define(name, ctor);
  }
}
export {
  AfCollapsible,
  AfCollapsibleContent,
  AfCollapsibleTrigger,
  collapsibleStyles,
  registerCollapsible
};
