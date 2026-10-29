/**
 * WHAT THE SELECTION TOOLBAR OFFERS, BY WHAT IS SELECTED — the one mapping.
 *
 * Every element in a document is clickable, and every click lands somewhere
 * useful: the toolbar renders for EVERY selection, and three of its controls
 * are UNCONDITIONAL — the breadcrumb naming the element, the comment door,
 * and delete (ALWAYS_OFFERED; the toolbar renders them unguarded, so a rule
 * about them belongs here, not in a render branch). Nothing selectable lands
 * in silence — an outline with no controls beside it says nothing about what
 * was just selected.
 *
 * What VARIES is the format vocabulary, and it varies here and nowhere else:
 *  - `format` (alignment, color, spacing, width — the class algebra of
 *    lib/story-design/typography) is for plain tags only. A component's classes
 *    are render output, not the author's to edit.
 *  - `text` (weight/style) is for tags whose typography is their OWN text
 *    rather than a container's; `size` too, where that is a class — never on
 *    a kit text component (CardTitle, TableCell), whose classes are the kit's:
 *    it takes marks, and links unless it is a link itself.
 *  - `link` needs the live Range only a focused text host holds; the parent
 *    has no Selection to wrap.
 *  - `image` is a plain `<img>`: it takes replace and alt text instead of the
 *    text vocabulary (no size, weight, colour or link — it has no text), and
 *    keeps the layout half of `format` (alignment, spacing).
 *
 * Components with richer editing (a <Chart>'s chart, a <Cell>) keep
 * their own inspector panels — those open BESIDE this toolbar, they do not
 * replace it.
 */
import type { StoryEditSelection } from '@/lib/edit-protocol';
import { kitTextAcceptsLinks, kitTextElement } from '@/lib/jsx/component-names';

/** The controls every selection gets, whatever it is. Rendered unguarded. */
export const ALWAYS_OFFERED = ['name', 'comment', 'delete'] as const;

/** Tags whose typography controls apply to their own text rather than a container's. */
const TEXT_TAGS = ['p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'li', 'blockquote', 'span', 'a', 'td', 'th'];

interface SelectionToolbarPlan {
  /** Weight / italic / underline. */
  text: boolean;
  /** Font size steppers — a class, so only where the class algebra applies. */
  size: boolean;
  /** The class algebra: alignment and the spacing/width row. */
  format: boolean;
  /** Text colour — a text tool, so not for a block selection. */
  color: boolean;
  /** Insert/remove link — needs the live Range a focused text host holds. */
  link: boolean;
  /** Replace the picture and edit its alt text — a plain `<img>`. */
  image: boolean;
}

const NONE: SelectionToolbarPlan = { text: false, size: false, format: false, color: false, link: false, image: false };

export function selectionToolbarPlan(
  selection: Pick<StoryEditSelection, 'kind' | 'tag' | 'mode'>,
): SelectionToolbarPlan {
  if (selection.tag === 'Markdown') return { ...NONE, text: selection.mode !== 'block', format: selection.mode === 'block', link: selection.mode !== 'block' };
  if (selection.kind === 'embed') return NONE;
  // A kit text component (lib/jsx/component-names KIT_TEXT_ELEMENTS): its text takes the marks its element accepts,
  // typed in; its classes are the kit's, so no size, colour or layout.
  if (kitTextElement(selection.tag))
    return selection.kind === 'text' && selection.mode !== 'block' ? { ...NONE, text: true, link: kitTextAcceptsLinks(selection.tag) } : NONE;
  // An image is never text, in either mode: replace and alt text instead, plus layout.
  if (selection.tag.toLowerCase() === 'img') return { ...NONE, format: true, image: true };
  // A BLOCK selection has no caret: text tools would act on nothing the user can see.
  if (selection.mode === 'block') return { ...NONE, format: true };
  const text = selection.kind === 'text' || TEXT_TAGS.includes(selection.tag.toLowerCase());
  return { text, size: text, format: true, color: true, link: selection.kind === 'text', image: false };
}
