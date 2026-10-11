/**
 * WHICH APPEARANCE A PORTALLED SURFACE TAKES. A Select's listbox, a Menu, a Tooltip or a Dialog renders in the
 * trusted portal or <body>, outside the element it was opened from — so an editor that sets its own
 * `data-app-appearance` on a wrapper (editor/InPlaceEditor, editor/EditEntryChrome) would otherwise get panels
 * in the page's palette. The surface reads the appearance where it was opened (its anchor, where the caller
 * rendered it, or the focused opener) and stamps it on its own root; the palette in app/globals.css follows the
 * attribute. Nothing is stamped when nothing sets an appearance, so the page's own palette applies.
 */
import { createSignal, onMount, type Accessor } from 'solid-js';

export type Appearance = 'light' | 'dark';

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

/** The appearance of whatever has focus now — the control that is opening a dialog or a sheet. */
const openerAppearance = (): Appearance | undefined => {
  if (typeof document === 'undefined') return undefined;
  let active: Element | null = document.activeElement;
  while (active?.shadowRoot?.activeElement) active = active.shadowRoot.activeElement;
  return appearanceOf(active && active !== document.body ? active : document.body);
};

/**
 * For a surface with no anchor (a Dialog, a Drawer, a FloatingPanel): put `marker` on a hidden element where the
 * caller rendered it; `appearance` is the appearance there once mounted, else the opener's.
 */
export function createPlacedAppearance(): { marker: (el: HTMLElement) => void; appearance: Accessor<Appearance | undefined> } {
  const opener = openerAppearance();
  const [appearance, setAppearance] = createSignal(opener);
  let placed: HTMLElement | undefined;
  onMount(() => setAppearance(appearanceOf(placed, false) ?? opener));
  return { marker: (el) => { placed = el; }, appearance };
}
