/**
 * WHAT THE SELECTION TOOLBAR OFFERS, BY WHAT IS SELECTED — the one mapping.
 *
 * Every element in a document is clickable, and every click lands somewhere
 * useful: the toolbar renders for EVERY selection, and three of its controls
 * are UNCONDITIONAL — the breadcrumb naming the element, the comment door,
 * and delete (ALWAYS_OFFERED; the toolbar renders them unguarded, so a rule
 * about them belongs here, not in a render branch). Selecting a <GridItem>
 * tile used to land in silence: an outline, no controls, nothing to do with
 * what was just selected.
 *
 * What VARIES is the format vocabulary, and it varies here and nowhere else:
 *  - `format` (alignment, color, spacing, width — the class algebra of
 *    lib/data/story/typography) is for plain tags only. A component's classes
 *    are render output, not the author's to edit.
 *  - `text` (size/weight/style steppers) is for tags whose typography is
 *    their OWN text rather than a container's.
 *  - `link` needs the live Range only a focused text host holds; the parent
 *    has no Selection to wrap.
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

export interface SelectionToolbarPlan {
  /** Font size / weight / italic / underline steppers. */
  text: boolean;
  /** The class algebra: alignment, text color, the spacing/width row. */
  format: boolean;
  /** Insert/remove link — needs the live Range a focused text host holds. */
  link: boolean;
}

export function selectionToolbarPlan(selection: Pick<StoryEditSelection, 'kind' | 'tag'>): SelectionToolbarPlan {
  if (selection.kind === 'embed') return { text: false, format: false, link: false };
  return {
    text: selection.kind === 'text' || TEXT_TAGS.includes(selection.tag.toLowerCase()),
    format: true,
    link: selection.kind === 'text',
  };
}
