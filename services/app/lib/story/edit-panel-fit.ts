/**
 * DOES THE EDIT PANEL FIT IN THE DOCUMENT'S OWN MARGIN?
 *
 * Asked ONCE, when edit mode opens on a wide window (components/ArtifactSurface).
 * Yes: the panel sits over empty margin and the document does not move at all.
 * No: the page reserves the panel's width and the document narrows once, on
 * entry. Either answer then holds for the whole session — selecting, switching
 * tabs and opening comments never move the document.
 *
 * "Empty" is measured, not assumed, because a document's column is the
 * author's markup (a prose column, a plan's 1120px drawing area, a full-bleed
 * chart). What counts is INK: text, media, form controls and a boxed element's
 * own background or border. A band that spans (almost) the whole window paints
 * only the page's ground, so its box is not ink — the text and charts inside it
 * still are. Covering a chart is the failure the reserve exists to prevent
 * (it used to overlay and covered the chart it edited), so any doubt answers
 * "does not fit".
 */

/** Space kept between the document's ink and the panel's edge. */
export const EDIT_PANEL_GUTTER = 16;

/** Elements past this many are not walked; the answer is then "does not fit". */
const WALK_LIMIT = 6000;

const MEDIA = new Set(['img', 'svg', 'canvas', 'video', 'iframe', 'picture', 'object', 'embed', 'table', 'input', 'textarea', 'select', 'button', 'hr']);
/** Elements whose inside is drawn by the element itself: measured as one box, not walked into. */
const OPAQUE = new Set(['svg', 'canvas', 'video', 'iframe', 'picture', 'object', 'embed']);

const transparent = (color: string) => !color || color === 'transparent' || /rgba\([^)]*,\s*0\)$/.test(color);

function paintsBox(el: Element): boolean {
  const style = el.ownerDocument.defaultView?.getComputedStyle(el);
  if (!style) return false;
  if (!transparent(style.backgroundColor) || (style.backgroundImage && style.backgroundImage !== 'none')) return true;
  if (style.boxShadow && style.boxShadow !== 'none') return true;
  return ['Top', 'Right', 'Bottom', 'Left'].some((side) =>
    parseFloat(style.getPropertyValue(`border-${side.toLowerCase()}-width`)) > 0
    && style.getPropertyValue(`border-${side.toLowerCase()}-style`) !== 'none'
    && !transparent(style.getPropertyValue(`border-${side.toLowerCase()}-color`)));
}

function hasOwnText(el: Element): boolean {
  for (const child of el.childNodes) if (child.nodeType === 3 && child.textContent?.trim()) return true;
  return false;
}

/**
 * The right edge of the rightmost ink under `root`, in viewport pixels; 0 when
 * nothing paints, Infinity when the document is too large to walk.
 */
export function documentInkRight(root: Element, viewportWidth: number): number {
  let right = 0;
  let walked = 0;
  const stack: Element[] = [...root.children].reverse();
  while (stack.length) {
    const el = stack.pop()!;
    if (++walked > WALK_LIMIT) return Infinity;
    const rect = el.getBoundingClientRect();
    const tag = el.tagName.toLowerCase();
    const drawn = rect.width > 0 && rect.height > 0;
    if (drawn && rect.right > right) {
      const band = rect.width >= viewportWidth * 0.95;
      if (MEDIA.has(tag) || hasOwnText(el) || (!band && paintsBox(el))) right = rect.right;
    }
    // A display:none subtree draws nothing; an element with a zero box can
    // still hold overflowing or positioned children, so only `none` stops the walk.
    if (OPAQUE.has(tag)) continue;
    if (!drawn && el.ownerDocument.defaultView?.getComputedStyle(el).display === 'none') continue;
    for (let i = el.children.length - 1; i >= 0; i--) stack.push(el.children[i]!);
  }
  return right;
}

/** True when a panel `panelWidth` wide fits right of the document's ink without covering it. */
export function panelFitsInMargin(root: Element, clientWidth: number, panelWidth: number): boolean {
  return clientWidth - documentInkRight(root, clientWidth) >= panelWidth + EDIT_PANEL_GUTTER;
}
