// services/app/lib/html-components/dialog.ts
var sequence = 0;
var AfDialog = class extends HTMLElement {
  static observedAttributes = ["open"];
  local = false;
  initialized = false;
  supplied;
  native;
  mountedContent;
  opener = null;
  controlAttributes = /* @__PURE__ */ new WeakMap();
  disabledChildren = /* @__PURE__ */ new Map();
  observer = new MutationObserver(() => this.sync());
  get open() {
    return this.supplied ?? (this.hasAttribute("open") || this.local);
  }
  set open(value) {
    if (value === void 0) this.local = this.open;
    this.supplied = value;
    this.sync();
  }
  connectedCallback() {
    if (Object.prototype.hasOwnProperty.call(this, "open")) {
      const value = this.open;
      delete this.open;
      this.open = value;
    }
    if (!this.initialized) {
      this.local = this.hasAttribute("default-open");
      this.initialized = true;
    }
    this.addEventListener("click", this.onClick);
    this.addEventListener("keydown", this.keydown);
    this.observer.observe(this, { childList: true, subtree: true, attributes: true, attributeFilter: ["id", "disabled"] });
    this.sync();
  }
  disconnectedCallback() {
    this.observer.disconnect();
    this.removeEventListener("click", this.onClick);
    this.removeEventListener("keydown", this.keydown);
    if (this.native?.open) this.native.close();
  }
  attributeChangedCallback() {
    this.sync();
  }
  own(tag) {
    return [...this.querySelectorAll(tag)].filter((n) => n.closest("af-dialog") === this);
  }
  intent(value, opener) {
    if (value === this.open) return;
    if (value && opener) this.opener = opener;
    const event = new CustomEvent("af-change", { detail: { value }, bubbles: true, composed: true, cancelable: true });
    if (this.dispatchEvent(event) && this.supplied === void 0 && !this.hasAttribute("open")) this.local = value;
    this.sync();
  }
  onClick = (event) => {
    if (event.defaultPrevented || !(event.target instanceof Element) || event.target.closest("af-dialog") !== this) return;
    const control = event.target.closest("af-dialog-trigger,af-dialog-close");
    if (control) {
      if (control.hasAttribute("disabled") || event.target.closest(':disabled,[aria-disabled="true"]')) return;
      this.intent(control.localName === "af-dialog-trigger", event.target.closest("button,a[href],input,[tabindex]") ?? control);
    } else if (event.target === this.native) {
      const bounds = this.native.getBoundingClientRect();
      if (event.clientX <= bounds.left || event.clientX >= bounds.right || event.clientY <= bounds.top || event.clientY >= bounds.bottom) this.intent(false);
    }
  };
  keydown = (event) => {
    if (event.defaultPrevented || !(event.target instanceof Element) || event.target.closest("af-dialog") !== this) return;
    const control = event.target.closest("af-dialog-trigger,af-dialog-close");
    if (control && event.target === control && !control.hasAttribute("disabled") && (event.key === "Enter" || event.key === " ")) {
      event.preventDefault();
      control.click();
    }
  };
  cancel = (event) => {
    event.preventDefault();
    this.intent(false);
  };
  closed = () => {
    if (this.isConnected && this.open && !this.native?.open) this.intent(false);
  };
  identify(node) {
    if (!node.id) {
      let id;
      do {
        id = `af-dialog-label-${++sequence}`;
      } while (this.ownerDocument.getElementById(id));
      node.id = id;
    }
  }
  restoreAttribute(node, name, value) {
    if (value === null) node.removeAttribute(name);
    else node.setAttribute(name, value);
  }
  sync() {
    if (!this.isConnected) return;
    const content = this.own("af-dialog-content")[0];
    if (this.native && (content !== this.mountedContent || !content || !this.native.contains(content))) {
      const obsolete = this.native;
      this.native = void 0;
      obsolete.removeEventListener("cancel", this.cancel);
      obsolete.removeEventListener("close", this.closed);
      if (content && obsolete.contains(content)) obsolete.before(content);
      if (obsolete.open) obsolete.close();
      obsolete.remove();
      if (this.opener?.isConnected) this.opener.focus();
      this.opener = null;
    }
    if (!content) return;
    if (!this.native) {
      this.native = this.ownerDocument.createElement("dialog");
      this.native.setAttribute("data-af-dialog-native", "");
      this.native.tabIndex = -1;
      this.native.addEventListener("cancel", this.cancel);
      this.native.addEventListener("close", this.closed);
      content.before(this.native);
      this.native.append(content);
      this.mountedContent = content;
    } else if (content.parentElement !== this.native) this.native.append(content);
    for (const [tag, attribute] of [["af-dialog-title", "aria-labelledby"], ["af-dialog-description", "aria-describedby"]]) {
      const nodes = this.own(tag);
      nodes.forEach((n) => this.identify(n));
      if (nodes.length) this.native.setAttribute(attribute, nodes.map((n) => n.id).join(" "));
      else this.native.removeAttribute(attribute);
    }
    const disabledTargets = /* @__PURE__ */ new Set();
    for (const control of this.own("af-dialog-trigger,af-dialog-close")) {
      let authored = this.controlAttributes.get(control);
      if (!authored) {
        authored = { role: control.getAttribute("role"), tab: control.getAttribute("tabindex") };
        this.controlAttributes.set(control, authored);
      }
      const child = control.querySelector("button,input,select,textarea,a[href]");
      const target = child ?? control;
      if (child) {
        this.restoreAttribute(control, "role", authored.role);
        this.restoreAttribute(control, "tabindex", authored.tab);
        control.removeAttribute("aria-haspopup");
        control.removeAttribute("aria-expanded");
        control.removeAttribute("aria-disabled");
      } else {
        control.setAttribute("role", authored.role ?? "button");
        control.tabIndex = control.hasAttribute("disabled") ? -1 : Number(authored.tab ?? 0);
      }
      const disabled = control.hasAttribute("disabled");
      if (child && disabled) {
        disabledTargets.add(child);
        if (!this.disabledChildren.has(child)) this.disabledChildren.set(child, { disabled: child.getAttribute("disabled"), tab: child.getAttribute("tabindex") });
        if ("disabled" in child && !child.hasAttribute("disabled")) child.setAttribute("disabled", "");
        child.tabIndex = -1;
      }
      target.setAttribute("aria-disabled", String(disabled || (child?.hasAttribute("disabled") ?? false)));
      if (control.localName === "af-dialog-trigger") {
        target.setAttribute("aria-haspopup", "dialog");
        target.setAttribute("aria-expanded", String(this.open));
      }
    }
    for (const [child, authored] of this.disabledChildren) {
      if (disabledTargets.has(child)) continue;
      this.restoreAttribute(child, "disabled", authored.disabled);
      this.restoreAttribute(child, "tabindex", authored.tab);
      child.setAttribute("aria-disabled", String(authored.disabled !== null));
      this.disabledChildren.delete(child);
    }
    this.dataset.state = this.open ? "open" : "closed";
    if (this.open && !this.native.open) {
      this.opener ??= this.ownerDocument.activeElement;
      this.native.showModal();
    } else if (!this.open && this.native.open) {
      this.native.close();
      if (this.opener?.isConnected) this.opener.focus();
      this.opener = null;
    }
  }
};
var AfDialogTrigger = class extends HTMLElement {
};
var AfDialogContent = class extends HTMLElement {
};
var AfDialogHeader = class extends HTMLElement {
};
var AfDialogFooter = class extends HTMLElement {
};
var AfDialogTitle = class extends HTMLElement {
};
var AfDialogDescription = class extends HTMLElement {
};
var AfDialogClose = class extends HTMLElement {
};
var dialogStyles = `
af-dialog{display:contents}
dialog[data-af-dialog-native]{margin:auto;max-height:calc(100svh - 4rem);width:fit-content;max-width:min(32rem,calc(100vw - 2rem));overflow:auto;border-radius:var(--radius-lg,var(--radius,.5rem));border:1px solid var(--border);background:var(--background);padding:1.5rem;color:var(--foreground);box-shadow:var(--shadow-lg,0 10px 15px -3px color-mix(in srgb,var(--foreground) 10%,transparent),0 4px 6px -4px color-mix(in srgb,var(--foreground) 10%,transparent))}
dialog[data-af-dialog-native]::backdrop{background:color-mix(in srgb,var(--foreground) 50%,transparent)}
af-dialog-content{display:flex;flex-direction:column;gap:1rem}
af-dialog-header{display:flex;flex-direction:column;gap:.5rem}
af-dialog-footer{display:flex;justify-content:flex-end;gap:.5rem}
af-dialog-title{display:block;font-size:1.125rem;font-weight:600;line-height:1}
af-dialog-description{display:block;color:var(--muted-foreground);font-size:.875rem}
af-dialog-trigger,af-dialog-close{display:inline-flex;align-items:center;justify-content:center;gap:.5rem;border-radius:var(--radius-md,var(--radius,.375rem));padding:.5rem 1rem;font:inherit;font-size:.875rem;font-weight:500;cursor:pointer;background:var(--primary);color:var(--primary-foreground)}
af-dialog-trigger:has(button,input,select,textarea,a[href]),af-dialog-close:has(button,input,select,textarea,a[href]){display:contents}
af-dialog-close{border:1px solid var(--border);background:var(--background);color:var(--foreground)}
af-dialog-trigger:focus-visible,af-dialog-close:focus-visible{outline:2px solid var(--ring);outline-offset:2px}
af-dialog-trigger[disabled],af-dialog-close[disabled]{opacity:.5;cursor:default}
`;
function registerDialog(registry = customElements, document = globalThis.document) {
  if (!document.querySelector("style[data-af-dialog-styles]")) {
    const style = document.createElement("style");
    style.setAttribute("data-af-dialog-styles", "");
    style.textContent = dialogStyles;
    document.head.append(style);
  }
  for (const [name, ctor] of Object.entries({ "af-dialog": AfDialog, "af-dialog-trigger": AfDialogTrigger, "af-dialog-content": AfDialogContent, "af-dialog-header": AfDialogHeader, "af-dialog-footer": AfDialogFooter, "af-dialog-title": AfDialogTitle, "af-dialog-description": AfDialogDescription, "af-dialog-close": AfDialogClose })) if (!registry.get(name)) registry.define(name, ctor);
}
export {
  AfDialog,
  AfDialogClose,
  AfDialogContent,
  AfDialogDescription,
  AfDialogFooter,
  AfDialogHeader,
  AfDialogTitle,
  AfDialogTrigger,
  dialogStyles,
  registerDialog
};
