// services/app/lib/html-components/tabs.ts
var nextId = 0;
var AfTabs = class extends HTMLElement {
  static observedAttributes = ["value", "orientation", "activation-mode", "dir", "loop", "variant"];
  selection;
  initialized = false;
  controlled = false;
  propertyValue;
  focused;
  observer = new MutationObserver(() => this.sync());
  get value() {
    return this.controlled ? this.propertyValue : this.getAttribute("value") ?? this.selection;
  }
  set value(value) {
    if (value === void 0) this.selection = this.value;
    this.controlled = value !== void 0;
    this.propertyValue = value;
    this.sync();
  }
  connectedCallback() {
    if (Object.prototype.hasOwnProperty.call(this, "value")) {
      const value = this.value;
      delete this.value;
      this.value = value;
    }
    if (!this.initialized) {
      this.selection = this.getAttribute("default-value") ?? void 0;
      this.initialized = true;
    }
    this.addEventListener("click", this.onClick);
    this.addEventListener("keydown", this.keydown);
    this.addEventListener("focusin", this.focusin);
    this.addEventListener("focusout", this.focusout);
    this.observer.observe(this, { childList: true, subtree: true, attributes: true, attributeFilter: ["disabled", "value"] });
    this.sync();
  }
  disconnectedCallback() {
    this.observer.disconnect();
    this.removeEventListener("click", this.onClick);
    this.removeEventListener("keydown", this.keydown);
    this.removeEventListener("focusin", this.focusin);
    this.removeEventListener("focusout", this.focusout);
  }
  attributeChangedCallback() {
    this.sync();
  }
  own(tag) {
    return [...this.querySelectorAll(tag)].filter((node) => node.closest("af-tabs") === this);
  }
  triggers() {
    return this.own("af-tabs-trigger");
  }
  enabled() {
    return this.triggers().filter((t) => !t.hasAttribute("disabled"));
  }
  target(event) {
    const node = event.target instanceof Element ? event.target.closest("af-tabs-trigger") : null;
    return node?.closest("af-tabs") === this && !node.hasAttribute("disabled") ? node : void 0;
  }
  choose(trigger) {
    const value = trigger.getAttribute("value");
    if (value === null || value === this.value) return;
    const event = new CustomEvent("af-change", { detail: { value }, bubbles: true, composed: true, cancelable: true });
    if (this.dispatchEvent(event) && !this.controlled && !this.hasAttribute("value")) this.selection = value;
    this.sync();
  }
  onClick = (event) => {
    const trigger = this.target(event);
    if (trigger && !event.defaultPrevented) {
      this.focused = trigger;
      trigger.focus();
      this.choose(trigger);
    }
  };
  focusout = () => {
    queueMicrotask(() => this.sync());
  };
  focusin = (event) => {
    const trigger = this.target(event);
    if (trigger) {
      this.focused = trigger;
      this.sync();
    }
  };
  keydown = (event) => {
    const trigger = this.target(event);
    if (!trigger || event.defaultPrevented) return;
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      this.choose(trigger);
      return;
    }
    const vertical = this.getAttribute("orientation") === "vertical";
    const rtl = (this.closest("[dir]")?.getAttribute("dir") ?? getComputedStyle(this).direction) === "rtl";
    const forward = vertical ? "ArrowDown" : rtl ? "ArrowLeft" : "ArrowRight";
    const backward = vertical ? "ArrowUp" : rtl ? "ArrowRight" : "ArrowLeft";
    const enabled = this.enabled();
    let index = enabled.indexOf(trigger);
    if (event.key === "Home") index = 0;
    else if (event.key === "End") index = enabled.length - 1;
    else if (event.key === forward || event.key === backward) {
      index += event.key === forward ? 1 : -1;
      if (this.getAttribute("loop") !== "false") index = (index + enabled.length) % enabled.length;
      else index = Math.max(0, Math.min(enabled.length - 1, index));
    } else return;
    event.preventDefault();
    const next = enabled[index];
    if (!next) return;
    this.focused = next;
    next.focus();
    if (this.getAttribute("activation-mode") !== "manual") this.choose(next);
    this.sync();
  };
  identify(node, kind) {
    if (node.id) return;
    let id;
    do {
      id = `af-tabs-${kind}-${++nextId}`;
    } while (this.ownerDocument.getElementById(id));
    node.id = id;
  }
  sync() {
    if (!this.isConnected) return;
    const triggers = this.triggers();
    const panels = this.own("af-tabs-content");
    const enabled = this.enabled();
    if (!this.focused || !enabled.includes(this.focused) || !enabled.includes(this.ownerDocument.activeElement)) this.focused = enabled.find((t) => t.getAttribute("value") === this.value) ?? enabled[0];
    for (const list of this.own("af-tabs-list")) {
      list.dataset.orientation = this.getAttribute("orientation") === "vertical" ? "vertical" : "horizontal";
      list.dataset.variant = list.getAttribute("variant") ?? this.getAttribute("variant") ?? "default";
      list.setAttribute("role", "tablist");
      list.setAttribute("aria-orientation", this.getAttribute("orientation") === "vertical" ? "vertical" : "horizontal");
    }
    for (const trigger of triggers) {
      this.identify(trigger, "trigger");
      const active = trigger.getAttribute("value") === this.value;
      trigger.setAttribute("role", "tab");
      trigger.setAttribute("aria-selected", String(active));
      trigger.setAttribute("aria-disabled", String(trigger.hasAttribute("disabled")));
      trigger.tabIndex = trigger === this.focused ? 0 : -1;
      trigger.dataset.state = active ? "active" : "inactive";
      const panel = panels.find((p) => p.getAttribute("value") === trigger.getAttribute("value"));
      if (panel) {
        this.identify(panel, "panel");
        trigger.setAttribute("aria-controls", panel.id);
      } else trigger.removeAttribute("aria-controls");
    }
    for (const panel of panels) {
      this.identify(panel, "panel");
      const active = panel.getAttribute("value") === this.value;
      panel.setAttribute("role", "tabpanel");
      panel.hidden = !active;
      panel.toggleAttribute("inert", !active);
      panel.dataset.state = active ? "active" : "inactive";
      panel.tabIndex = active ? 0 : -1;
      const trigger = triggers.find((t) => t.getAttribute("value") === panel.getAttribute("value"));
      if (trigger) panel.setAttribute("aria-labelledby", trigger.id);
      else panel.removeAttribute("aria-labelledby");
    }
  }
};
var AfTabsList = class extends HTMLElement {
};
var AfTabsTrigger = class extends HTMLElement {
};
var AfTabsContent = class extends HTMLElement {
};
var tabsStyles = `
af-tabs{display:flex;gap:.5rem;flex-direction:column}
af-tabs[orientation=vertical]{flex-direction:row}
af-tabs-list{box-sizing:border-box;display:inline-flex;align-items:center;justify-content:center;width:fit-content;height:36px;padding:3px;border-radius:var(--radius-lg,.5rem);background:var(--muted,#eee);color:var(--muted-foreground,#555)}
af-tabs-list[data-orientation=vertical]{height:fit-content;flex-direction:column}
af-tabs-trigger{box-sizing:border-box;position:relative;display:inline-flex;flex:1;align-items:center;justify-content:center;gap:.375rem;height:calc(100% - 1px);cursor:pointer;border:1px solid transparent;padding:4px 8px;border-radius:var(--radius-md,.375rem);font-family:inherit;font-size:14px;font-weight:500;line-height:20px;white-space:nowrap;color:var(--muted-foreground,#555);transition:background-color .15s,color .15s,box-shadow .15s}
af-tabs-list[data-orientation=vertical]>af-tabs-trigger{width:100%;justify-content:flex-start}
af-tabs-trigger:focus-visible{z-index:10;outline:2px solid color-mix(in srgb,var(--ring,#777) 50%,transparent);outline-offset:2px}
af-tabs-trigger[disabled]{opacity:.5;cursor:default;pointer-events:none}
af-tabs-trigger[data-state=inactive]:hover{background:color-mix(in srgb,var(--foreground,#222) 10%,transparent);color:var(--foreground,#222)}
af-tabs-trigger[data-state=active]{background:var(--primary,#222);color:var(--primary-foreground,#fff);box-shadow:0 1px 2px #0000000d}
af-tabs-trigger>svg{pointer-events:none;flex-shrink:0;width:1rem;height:1rem}
af-tabs-list[data-variant=line]{background:transparent;gap:.25rem;border-radius:0}
af-tabs-list[data-variant=line]>af-tabs-trigger[data-state=active]{background:transparent;color:var(--foreground,#222);box-shadow:none}
af-tabs-list[data-variant=line]>af-tabs-trigger::after{position:absolute;content:"";background:var(--primary,#222);opacity:0;transition:opacity .15s}
af-tabs-list[data-variant=line][data-orientation=horizontal]>af-tabs-trigger::after{left:0;right:0;bottom:-5px;height:2px}
af-tabs-list[data-variant=line][data-orientation=vertical]>af-tabs-trigger::after{top:0;bottom:0;right:-4px;width:2px}
af-tabs-list[data-variant=line]>af-tabs-trigger[data-state=active]::after{opacity:1}
af-tabs-content{flex:1;outline:none}
af-tabs-content[hidden]{display:none!important}
`;
function registerTabs(registry = customElements, document = globalThis.document) {
  if (!document.querySelector("style[data-af-tabs-styles]")) {
    const style = document.createElement("style");
    style.setAttribute("data-af-tabs-styles", "");
    style.textContent = tabsStyles;
    document.head.append(style);
  }
  for (const [name, ctor] of Object.entries({ "af-tabs": AfTabs, "af-tabs-list": AfTabsList, "af-tabs-trigger": AfTabsTrigger, "af-tabs-content": AfTabsContent })) {
    if (!registry.get(name)) registry.define(name, ctor);
  }
}
export {
  AfTabs,
  AfTabsContent,
  AfTabsList,
  AfTabsTrigger,
  registerTabs,
  tabsStyles
};
