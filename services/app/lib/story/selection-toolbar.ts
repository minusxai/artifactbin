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
 *    lib/data/story/typography) is for plain tags only. A component's classes
 *    are render output, not the author's to edit.
 *  - `text` (size/weight/style steppers) is for tags whose typography is
 *    their OWN text rather than a container's.
 *  - `link` needs the live Range only a focused text host holds; the parent
 *    has no Selection to wrap.
 *  - `image` is a plain `<img>`: it takes replace and alt text instead of the
 *    text vocabulary (no size, weight, colour or link — it has no text), and
 *    keeps the layout half of `format` (alignment, spacing).
 *
 * Components with richer editing (a <Question>'s chart, a <Number>) keep
 * their own inspector panels — those open BESIDE this toolbar, they do not
 * replace it.
 */
import type { StoryEditSelection } from '@/lib/story-runtime/contract';

/** The controls every selection gets, whatever it is. Rendered unguarded. */
export const ALWAYS_OFFERED = ['name', 'comment', 'delete'] as const;

/** Tags whose typography controls apply to their own text rather than a container's. */
const TEXT_TAGS = ['p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'li', 'blockquote', 'span', 'a', 'td', 'th'];

interface SelectionToolbarPlan {
  /** Font size / weight / italic / underline steppers. */
  text: boolean;
  /** The class algebra: alignment and the spacing/width row. */
  format: boolean;
  /** Text colour — a text tool, so not for a block selection. */
  color: boolean;
  /** Insert/remove link — needs the live Range a focused text host holds. */
  link: boolean;
  /** Replace the picture and edit its alt text — a plain `<img>`. */
  image: boolean;
}

export function selectionToolbarPlan(
  selection: Pick<StoryEditSelection, 'kind' | 'tag' | 'mode'>,
): SelectionToolbarPlan {
  if (selection.kind === 'embed') return { text: false, format: false, color: false, link: false, image: false };
  // An image is never text, in either mode: replace and alt text instead, plus layout.
  if (selection.tag.toLowerCase() === 'img') return { text: false, format: true, color: false, link: false, image: true };
  // A BLOCK selection has no caret: text tools would act on nothing the user can see.
  if (selection.mode === 'block') return { text: false, format: true, color: false, link: false, image: false };
  return {
    text: selection.kind === 'text' || TEXT_TAGS.includes(selection.tag.toLowerCase()),
    format: true,
    color: true,
    link: selection.kind === 'text',
    image: false,
  };
}
