import { validateDeckMap } from "../jsx/deck-spec";
import { DeckGeneration, type DeckGLOptions } from "./deck-gl-model";
export type { DeckGLOptions } from "./deck-gl-model";
export interface DeckGLAdapter {
  update(options: DeckGLOptions): void;
  dispose(): void;
}
/** Lazy engine import keeps WebGL dependencies out of ordinary HTML controls. Bundlers retain this local chunk. */
export class AfDeckGL extends HTMLElement {
  private config?: DeckGLOptions;
  private adapter?: DeckGLAdapter;
  private generation = new DeckGeneration();
  private status?: HTMLParagraphElement;
  private themeObserver?: MutationObserver;
  private resolvedOptions(): DeckGLOptions | undefined {
    if (!this.config) return undefined;
    return {
      ...this.config,
      colorMode:
        this.config.colorMode ??
        (this.closest("[data-af-dark]") ? "dark" : "light"),
    };
  }
  private clearStatus(): void {
    this.status?.remove();
    this.status = undefined;
  }
  get options(): DeckGLOptions | undefined {
    return this.config;
  }
  set options(value: DeckGLOptions | undefined) {
    if (value) {
      const errors = validateDeckMap(value);
      if (errors.length) throw new TypeError(errors.join(" "));
    }
    this.clearStatus();
    this.config = value;
    if (this.adapter && value) this.adapter.update(this.resolvedOptions()!);
    else if (this.isConnected) this.mount();
    if (!value) {
      this.generation.invalidate();
      this.adapter?.dispose();
      this.adapter = undefined;
    }
  }
  connectedCallback(): void {
    if (Object.hasOwn(this, "options")) {
      const value = this.options;
      delete (this as { options?: DeckGLOptions }).options;
      this.options = value;
    }
    this.themeObserver?.disconnect();
    this.themeObserver = new MutationObserver(() => {
      if (this.adapter && this.config)
        this.adapter.update(this.resolvedOptions()!);
    });
    // Only theme-bearing ancestor attributes: rendered map mutations never feed back.
    for (
      let ancestor: Element | null = this;
      ancestor;
      ancestor = ancestor.parentElement
    ) {
      this.themeObserver.observe(ancestor, {
        attributes: true,
        attributeFilter: ["data-af-dark", "data-af-design-system"],
      });
    }
    this.mount();
  }
  disconnectedCallback(): void {
    this.themeObserver?.disconnect();
    this.clearStatus();
    this.generation.invalidate();
    this.adapter?.dispose();
    this.adapter = undefined;
  }
  private mount(): void {
    if (!this.config || this.adapter) return;
    this.clearStatus();
    const current = this.generation.next();
    void import("./deck-gl-engine")
      .then(({ mountDeckGL }) => {
        if (!current() || !this.isConnected || !this.config) return;
        this.adapter = mountDeckGL(this, this.resolvedOptions()!);
        this.clearStatus();
      })
      .catch((error) => {
        if (!current()) return;
        const status = (this.status ??= this.ownerDocument.createElement("p"));
        status.setAttribute("role", "status");
        status.textContent = `Map could not load: ${error instanceof Error ? error.message : "engine unavailable"}`;
        this.append(status);
      });
  }
}
export function registerDeckGL(
  registry: CustomElementRegistry = customElements,
): void {
  if (!registry.get("af-deck-gl")) registry.define("af-deck-gl", AfDeckGL);
}
