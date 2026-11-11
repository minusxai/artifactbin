/** Internal: shared registration for the hosted component modules. Each user-facing
 * module calls registerComponent once at top level, so a bare `import '@afbin/<name>'`
 * defines its tags. Re-evaluated copies of a module (separate chunks, test resets)
 * reuse the first definition and the first stylesheet instead of throwing.
 *
 * Styles go in a `<style data-KEY>` appended to <head>, as published pages have always had them. A host page
 * under a strict `style-src` (no 'unsafe-inline') opts out in its <head>, before the first import:
 *   <meta name="af-styles" content="adopted">   constructed sheets on document.adoptedStyleSheets: no element,
 *                                                no nonce (falls back to the <style> below where unsupported);
 *   <meta name="af-style-nonce" content="N">    the <style> carries nonce="N" (the host's style-src nonce).
 * Adopted sheets cascade after the document's own sheets; the component rules use low specificity, so a host
 * that overrides one does it with a more specific selector, never by source order. */
export interface ComponentDescriptor {
  /** Data attribute (without `data-`) that marks the injected stylesheet, e.g. `af-accordion-styles`. */
  styleKey?: string;
  styles?: string;
  elements: Record<string, CustomElementConstructor>;
}

/** Every copy of this module (one per chunk) shares the document's adopted sheets by key. */
const ADOPTED = Symbol.for('afbin.adopted-component-styles');
type AdoptingDocument = Document & { [ADOPTED]?: Map<string, CSSStyleSheet> };

const metaContent = (doc: Document, name: string): string | null =>
  doc.querySelector(`meta[name="${name}"]`)?.getAttribute('content')?.trim() || null;

function adopt(doc: AdoptingDocument, styleKey: string, styles: string): boolean {
  const view = doc.defaultView as (Window & typeof globalThis) | null;
  const Sheet = view?.CSSStyleSheet;
  if (!Sheet || !('adoptedStyleSheets' in doc) || typeof Sheet.prototype.replaceSync !== 'function') return false;
  const adopted = (doc[ADOPTED] ??= new Map());
  if (adopted.has(styleKey)) return true;
  const sheet = new Sheet();
  sheet.replaceSync(styles);
  adopted.set(styleKey, sheet);
  doc.adoptedStyleSheets = [...doc.adoptedStyleSheets, sheet];
  return true;
}

export function registerComponent(
  {styleKey, styles, elements}: ComponentDescriptor,
  registry: CustomElementRegistry | undefined = globalThis.customElements,
  doc: Document | undefined = globalThis.document,
): void {
  // Non-DOM environments (Node tooling importing for types) register nothing.
  if (!registry || !doc) return;
  if (styleKey && styles !== undefined
    && !(metaContent(doc, 'af-styles') === 'adopted' && adopt(doc, styleKey, styles))
    && !doc.querySelector(`style[data-${styleKey}]`)) {
    const style = doc.createElement('style');
    const nonce = metaContent(doc, 'af-style-nonce');
    if (nonce) style.setAttribute('nonce', nonce);
    style.setAttribute(`data-${styleKey}`, '');
    style.textContent = styles;
    doc.head.append(style);
  }
  for (const [name, ctor] of Object.entries(elements)) if (!registry.get(name)) registry.define(name, ctor);
}
