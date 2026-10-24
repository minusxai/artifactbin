/**
 * WHICH APPEARANCE A PORTALLED SURFACE TAKES. A Select's listbox, a Menu, a Tooltip or a Dialog renders in the
 * trusted portal or <body>, outside the element it was opened from — so an editor that sets its own
 * `data-app-appearance` on a wrapper (editor/InPlaceEditor, editor/EditEntryChrome) would otherwise get panels
 * in the page's palette. The surface reads the appearance where it was opened (its anchor, where the caller
 * rendered it, or the focused opener) and stamps it on its own root; the palette in app/globals.css follows the
 * attribute. Nothing is stamped when nothing sets an appearance, so the page's own palette applies.
 *
 * The APP appearance (`createAppAppearance`) is the shell's own: `data-theme` on the document element, which the
 * app bar's mode toggle and the pre-paint stamp write. It is not a document's colour mode — an editor's chrome
 * stamps the app appearance, while the document in its frame keeps the mode its author (or reader) chose.
 */
import { createEffect, createSignal, onCleanup, onMount, type Accessor } from 'solid-js';

export type Appearance = 'light' | 'dark';

/** A portalled surface follows its source context for the lifetime of its Solid owner. */
export interface PlacedAppearance {
  marker: (el: HTMLElement) => void;
  appearance: Accessor<Appearance | undefined>;
}

/** The nearest `data-app-appearance` above `node` (crossing shadow roots); else, with `root`, a dark document. */
export function appearanceOf(node: Node | null | undefined, root = true): Appearance | undefined {
  for (let at: Node | null | undefined = node; at;) {
    if (at instanceof Element) {
      const value = at.getAttribute('data-app-appearance');
      if (value === 'light' || value === 'dark') return value;
    }
    at = at.parentNode ?? (at instanceof ShadowRoot ? at.host : null);
  }
  if (!root) return undefined;
  const doc = node?.ownerDocument ?? (typeof document === 'undefined' ? undefined : document);
  return doc?.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : undefined;
}

/** Capture the source element before modal focus moves into the portal. */
const openerElement = (): Element | undefined => {
  if (typeof document === 'undefined') return undefined;
  let active: Element | null = document.activeElement;
  while (active?.shadowRoot?.activeElement) active = active.shadowRoot.activeElement;
  return active ?? document.body;
};

/**
 * Observe only source ancestors, including shadow hosts, never the portal's stamped palette. Reading the
 * nearest override on every change preserves local chrome modes while the document mode changes underneath.
 * The Solid owner disconnects the observer on source replacement and disposal.
 */
function createSourceAppearance(sources: Accessor<readonly (Node | undefined)[]>): Accessor<Appearance | undefined> {
  const read = (): Appearance | undefined => {
    const nodes = sources();
    for (const node of nodes) {
      const local = appearanceOf(node, false);
      if (local) return local;
    }
    return appearanceOf(nodes.find(Boolean));
  };
  const [appearance, setAppearance] = createSignal(read());
  createEffect(() => {
    const nodes = sources();
    const observer = new MutationObserver(() => setAppearance(read()));
    const ancestors = new Set<Element>();
    for (const node of nodes) {
      for (let at: Node | null | undefined = node; at;) {
        if (at instanceof Element) ancestors.add(at);
        at = at.parentNode ?? (at instanceof ShadowRoot ? at.host : null);
      }
    }
    const doc = nodes.find(Boolean)?.ownerDocument ?? document;
    ancestors.add(doc.documentElement);
    for (const ancestor of ancestors) {
      observer.observe(ancestor, { attributes: true, attributeFilter: ['data-app-appearance', 'data-theme'] });
    }
    setAppearance(read());
    onCleanup(() => observer.disconnect());
  });
  return appearance;
}

/** A live palette for an anchored surface, including sources inside a shadow root. */
export function createAnchoredAppearance(anchor: Accessor<HTMLElement | undefined>): Accessor<Appearance | undefined> {
  return createSourceAppearance(() => [anchor()]);
}

/** Place the marker where the caller renders the surface; otherwise follow the captured opener. */
export function createPlacedAppearance(anchor?: Accessor<HTMLElement | undefined>): PlacedAppearance {
  const opener = openerElement();
  const [placed, setPlaced] = createSignal<HTMLElement>();
  let marker: HTMLElement | undefined;
  onMount(() => setPlaced(marker));
  return { marker: (el) => { marker = el; }, appearance: createSourceAppearance(() => anchor?.() ? [anchor()!] : [placed(), opener]) };
}

/** The app shell's appearance (`data-theme` on the document element), kept current while the owner lives. */
export function createAppAppearance(doc: Document = document): Accessor<Appearance> {
  const read = (): Appearance => (doc.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light');
  const [appearance, setAppearance] = createSignal(read());
  const observer = new MutationObserver(() => setAppearance(read()));
  observer.observe(doc.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  onCleanup(() => observer.disconnect());
  return appearance;
}
