// services/app/lib/html-components/avatar.ts
function replayPreUpgradeProperties(element, names) {
  const properties = element;
  for (const name of names) {
    if (!Object.prototype.hasOwnProperty.call(element, name)) continue;
    const value = properties[name];
    delete properties[name];
    properties[name] = value;
  }
}
var AfAvatar = class extends HTMLElement {
  static observedAttributes = ["size"];
  currentStatus = "idle";
  primaryImage = null;
  observer = new MutationObserver(() => this.syncParts());
  get size() {
    const size = this.getAttribute("size");
    return size === "sm" || size === "lg" ? size : "default";
  }
  set size(value) {
    this.setAttribute("size", value);
  }
  get status() {
    return this.currentStatus;
  }
  connectedCallback() {
    replayPreUpgradeProperties(this, ["size"]);
    this.addEventListener("af-avatar-status", this.onStatus);
    this.observer.observe(this, { childList: true, subtree: true });
    const image = this.images()[0];
    if (image) {
      const state = image.dataset.state;
      this.currentStatus = state === "loading" || state === "loaded" || state === "error" ? state : image.hasAttribute("src") ? "loading" : "error";
    } else this.currentStatus = "idle";
    this.syncParts();
  }
  disconnectedCallback() {
    this.observer.disconnect();
    this.removeEventListener("af-avatar-status", this.onStatus);
  }
  attributeChangedCallback() {
    this.dataset.size = this.size;
  }
  images() {
    return [...this.querySelectorAll("af-avatar-image")].filter((image) => image.closest("af-avatar") === this);
  }
  fallbacks() {
    return [...this.querySelectorAll("af-avatar-fallback")].filter((part) => part.closest("af-avatar") === this);
  }
  onStatus = (event) => {
    const image = this.images()[0] ?? null;
    if (event.target !== image) return;
    this.primaryImage = image;
    this.currentStatus = event.detail.status;
    this.syncParts();
  };
  syncParts() {
    if (!this.isConnected) return;
    const image = this.images()[0] ?? null;
    if (image !== this.primaryImage) {
      this.primaryImage = image;
      const state = image?.dataset.state;
      this.currentStatus = image ? state === "loading" || state === "loaded" || state === "error" ? state : image.hasAttribute("src") ? "loading" : "error" : "idle";
    }
    this.dataset.size = this.size;
    this.dataset.state = this.currentStatus;
    for (const part of this.images()) part.hidden = this.currentStatus !== "loaded";
    for (const fallback of this.fallbacks()) fallback.hidden = this.currentStatus === "loaded";
  }
};
var AfAvatarImage = class extends HTMLElement {
  static observedAttributes = ["src", "alt"];
  nativeImage;
  generation = 0;
  replayingProperties = false;
  onLoad;
  onError;
  get src() {
    return this.getAttribute("src");
  }
  set src(value) {
    if (value === null) this.removeAttribute("src");
    else this.setAttribute("src", value);
  }
  get alt() {
    return this.getAttribute("alt") ?? "";
  }
  set alt(value) {
    this.setAttribute("alt", value);
  }
  connectedCallback() {
    this.replayingProperties = true;
    try {
      replayPreUpgradeProperties(this, ["src", "alt"]);
    } finally {
      this.replayingProperties = false;
    }
    this.ensureSlot();
    this.loadSource(false);
  }
  disconnectedCallback() {
    this.unbind();
    this.generation++;
  }
  attributeChangedCallback(name) {
    if (!this.isConnected || this.replayingProperties) return;
    if (name === "src") this.loadSource(true);
    else if (this.nativeImage) this.nativeImage.alt = this.alt;
  }
  ensureSlot() {
    if (!this.hasAttribute("data-slot")) this.setAttribute("data-slot", "avatar-image");
  }
  unbind() {
    if (!this.nativeImage) return;
    if (this.onLoad) this.nativeImage.removeEventListener("load", this.onLoad);
    if (this.onError) this.nativeImage.removeEventListener("error", this.onError);
    this.onLoad = void 0;
    this.onError = void 0;
  }
  emit(status, generation) {
    if (this.dataset.state === status) return;
    this.dataset.state = status;
    this.dispatchEvent(new CustomEvent("af-avatar-status", {
      detail: { status, generation },
      bubbles: true,
      composed: true
    }));
  }
  loadSource(changed) {
    const src = this.src;
    const generation = ++this.generation;
    this.unbind();
    if (!this.nativeImage || changed) {
      const oldImage = this.nativeImage;
      const image2 = this.ownerDocument.createElement("img");
      image2.alt = this.alt;
      image2.setAttribute("part", "image");
      if (oldImage?.parentNode === this) oldImage.remove();
      this.nativeImage = image2;
      this.append(image2);
    }
    const image = this.nativeImage;
    image.alt = this.alt;
    if (!src) {
      image.removeAttribute("src");
      this.emit("error", generation);
      return;
    }
    this.onLoad = () => {
      if (generation === this.generation && this.nativeImage === image) this.emit(image.naturalWidth > 0 ? "loaded" : "error", generation);
    };
    this.onError = () => {
      if (generation === this.generation && this.nativeImage === image) this.emit("error", generation);
    };
    image.addEventListener("load", this.onLoad);
    image.addEventListener("error", this.onError);
    this.emit("loading", generation);
    if (changed || !image.hasAttribute("src")) image.setAttribute("src", src);
    if (image.complete) this.emit(image.naturalWidth > 0 ? "loaded" : "error", generation);
  }
};
var AfAvatarFallback = class extends HTMLElement {
  connectedCallback() {
    if (!this.hasAttribute("data-slot")) this.setAttribute("data-slot", "avatar-fallback");
  }
};
var AfAvatarBadge = class extends HTMLElement {
  connectedCallback() {
    if (!this.hasAttribute("data-slot")) this.setAttribute("data-slot", "avatar-badge");
  }
};
var AfAvatarGroup = class extends HTMLElement {
  connectedCallback() {
    if (!this.hasAttribute("data-slot")) this.setAttribute("data-slot", "avatar-group");
  }
};
var AfAvatarGroupCount = class extends HTMLElement {
  connectedCallback() {
    if (!this.hasAttribute("data-slot")) this.setAttribute("data-slot", "avatar-group-count");
  }
};
var avatarStyles = `
af-avatar{box-sizing:border-box;position:relative;display:inline-flex;flex:none;align-items:center;justify-content:center;width:2rem;height:2rem;overflow:hidden;border-radius:9999px;background:var(--muted,#f5f5f5);color:var(--muted-foreground,#737373);vertical-align:middle;isolation:isolate}
af-avatar[data-size=sm]{width:1.5rem;height:1.5rem}
af-avatar[data-size=lg]{width:2.5rem;height:2.5rem}
af-avatar-image{position:absolute;inset:0;display:block;width:100%;height:100%;aspect-ratio:1}
af-avatar-image[hidden],af-avatar-fallback[hidden]{display:none!important}
af-avatar-image>img{display:block;width:100%;height:100%;aspect-ratio:1;object-fit:cover}
af-avatar-fallback{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;width:100%;height:100%;border-radius:inherit;background:var(--muted,#f5f5f5);color:var(--muted-foreground,#737373);font-size:.875rem;line-height:1;user-select:none}
af-avatar[data-size=sm]>af-avatar-fallback{font-size:.75rem}
af-avatar-badge{position:absolute;right:0;bottom:0;z-index:1;display:inline-flex;align-items:center;justify-content:center;width:.625rem;height:.625rem;overflow:hidden;border:2px solid var(--background,#fff);border-radius:9999px;background:var(--primary,#171717);color:var(--primary-foreground,#fff);font-size:0;line-height:1;user-select:none}
af-avatar[data-size=sm]>af-avatar-badge{width:.5rem;height:.5rem}
af-avatar[data-size=lg]>af-avatar-badge{width:.75rem;height:.75rem}
af-avatar-badge>svg{width:.5rem;height:.5rem;flex:none}
af-avatar-group{display:flex;align-items:center}
af-avatar-group>af-avatar,af-avatar-group>af-avatar-group-count{border:2px solid var(--background,#fff)}
af-avatar-group>af-avatar~af-avatar,af-avatar-group>af-avatar-group-count{margin-inline-start:-.5rem}
af-avatar-group-count{position:relative;display:inline-flex;flex:none;align-items:center;justify-content:center;width:2rem;height:2rem;border-radius:9999px;background:var(--muted,#f5f5f5);color:var(--muted-foreground,#737373);font-size:.875rem;line-height:1}
af-avatar-group:has(af-avatar[data-size=sm])>af-avatar-group-count{width:1.5rem;height:1.5rem;font-size:.75rem}
af-avatar-group:has(af-avatar[data-size=lg])>af-avatar-group-count{width:2.5rem;height:2.5rem}
af-avatar-group-count>svg{width:1rem;height:1rem}
`;
function registerAvatar(registry = customElements, document = globalThis.document) {
  if (!document.querySelector("style[data-af-avatar-styles]")) {
    const style = document.createElement("style");
    style.setAttribute("data-af-avatar-styles", "");
    style.textContent = avatarStyles;
    document.head.append(style);
  }
  for (const [name, ctor] of Object.entries({
    "af-avatar": AfAvatar,
    "af-avatar-image": AfAvatarImage,
    "af-avatar-fallback": AfAvatarFallback,
    "af-avatar-badge": AfAvatarBadge,
    "af-avatar-group": AfAvatarGroup,
    "af-avatar-group-count": AfAvatarGroupCount
  })) if (!registry.get(name)) registry.define(name, ctor);
}
export {
  AfAvatar,
  AfAvatarImage,
  registerAvatar
};
