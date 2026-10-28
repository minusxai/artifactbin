/** Internal: shared registration for the hosted component modules. Each user-facing
 * module calls registerComponent once at top level, so a bare `import '@afbin/<name>'`
 * defines its tags. Re-evaluated copies of a module (separate chunks, test resets)
 * reuse the first definition and the first stylesheet instead of throwing. */
export interface ComponentDescriptor {
  /** Data attribute (without `data-`) that marks the injected stylesheet, e.g. `af-accordion-styles`. */
  styleKey?: string;
  styles?: string;
  elements: Record<string, CustomElementConstructor>;
}

export function registerComponent(
  {styleKey, styles, elements}: ComponentDescriptor,
  registry: CustomElementRegistry | undefined = globalThis.customElements,
  doc: Document | undefined = globalThis.document,
): void {
  // Non-DOM environments (Node tooling importing for types) register nothing.
  if (!registry || !doc) return;
  if (styleKey && styles !== undefined && !doc.querySelector(`style[data-${styleKey}]`)) {
    const style = doc.createElement('style');
    style.setAttribute(`data-${styleKey}`, '');
    style.textContent = styles;
    doc.head.append(style);
  }
  for (const [name, ctor] of Object.entries(elements)) if (!registry.get(name)) registry.define(name, ctor);
}
