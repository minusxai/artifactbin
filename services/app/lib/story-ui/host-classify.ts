/**
 * Classifying a node from the SOURCE: is it a text host, where is it, what is
 * salient about its classes.
 *
 * A leaf module on purpose. These three answers are needed in two very
 * different places — the write-back path, which composes edits into source, and
 * the in-frame editor, which only has to decide what is editable and what the
 * breadcrumb should say. They used to live beside the write-back, so asking the
 * cheap question dragged the whole AST-editing machinery (and the validator,
 * and the component tables) into the document's edit chunk: 75 KB gzipped to
 * ask "is this a paragraph".
 *
 * Nothing here reaches for a DOM, and nothing imports upward. `lib/data/story`
 * re-exports these so no caller has to learn a second name for them.
 */
import type { JsxElement, JsxNode } from '@/lib/jsx';
import { STORY_SVG_TAGS } from '@/lib/story-ui/component-names';
import { immutableSet } from '@/lib/utils/immutable-collections';

/**
 * Components that may live INSIDE editable prose: they render inline, and are
 * spliced back verbatim on commit (locked islands while editing).
 */
export const TEXT_HOST_INLINE_EMBEDS = immutableSet(['Number', 'Icon']);

const SVG_TAGS_LOWER = immutableSet<string>(STORY_SVG_TAGS.map((t) => t.toLowerCase()));

function hasLockingComponentDescendant(node: JsxElement): boolean {
  return node.children.some((c) => c.type === 'element'
    && ((c.isComponent && !TEXT_HOST_INLINE_EMBEDS.has(c.tag)) || hasLockingComponentDescendant(c)));
}

/**
 * A text host is an HTML element with real text of its own whose component
 * descendants, if any, are all inline embeds. Any other component keeps the
 * host locked — its chrome is render output, and an edit could not be written
 * back. `<style>` is text-shaped but is CSS, not prose. SVG is DRAWING:
 * contenteditable inside an `<svg>` subtree is undefined browser behaviour, so
 * the whole subset stays atomic.
 */
export function isEditableTextHost(node: JsxElement): boolean {
  if (node.isComponent || node.tag.toLowerCase() === 'style') return false;
  if (SVG_TAGS_LOWER.has(node.tag.toLowerCase())) return false;
  const hasText = node.children.some((c) => c.type === 'text' && c.value.trim().length > 0);
  return hasText && !hasLockingComponentDescendant(node);
}

/** Resolve an interpreter AST path (`data-mx-ast`). Mirrors the interpreter's indexing: ALL JsxNodes count. */
export function resolveJsxNodeAtPath(roots: JsxNode[], path: string): JsxNode | null {
  const parts = path.split('.').map(Number);
  if (parts.length === 0 || parts.some((n) => !Number.isInteger(n) || n < 0)) return null;
  let list = roots;
  let node: JsxNode | null = null;
  for (const idx of parts) {
    node = list[idx] ?? null;
    if (!node) return null;
    list = node.type === 'element' ? node.children : [];
  }
  return node;
}

const classTokens = (className: string): string[] => className.split(/\s+/).filter(Boolean);

/**
 * The most decision-relevant class for a selection breadcrumb: the width
 * constraint first (exactly what "why isn't this full width" needs to see),
 * then the layout role, then a background. Empty when nothing is salient.
 */
export function crumbHint(className: string): string {
  const ts = classTokens(className);
  return ts.find((t) => t.startsWith('max-w-'))
    ?? (ts.includes('grid') ? 'grid' : undefined)
    ?? (ts.includes('flex') ? 'flex' : undefined)
    ?? ts.find((t) => t.startsWith('bg-'))
    ?? '';
}
