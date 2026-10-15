/**
 * Classifying a node from the SOURCE: is it a text host, where is it, what is
 * salient about its classes.
 *
 * A leaf module on purpose. These three answers are needed in two very
 * different places — the write-back path, which composes edits into source, and
 * the in-frame editor, which only has to decide what is editable and what the
 * breadcrumb should say. Keeping them here is what stops the cheap question
 * from dragging the whole AST-editing machinery — the validator and the
 * component tables with it — into the document's edit chunk.
 *
 * Nothing here reaches for a DOM, and nothing imports upward. `lib/data/story`
 * re-exports these so no caller has to learn a second name for them.
 */
import type { JsxAttribute, JsxElement, JsxNode } from '@/lib/jsx';
import { kitTextAcceptsLinks, kitTextElement, STORY_SVG_TAGS } from '@/lib/jsx/component-names';
import { immutableSet } from '@/lib/jsx/immutable-set';

/**
 * Components that may live INSIDE editable prose: they render inline, and are
 * spliced back verbatim on commit (locked islands while editing).
 */
const TEXT_HOST_INLINE_EMBEDS = immutableSet(['Cell', 'Icon']);

const SVG_TAGS_LOWER = immutableSet<string>(STORY_SVG_TAGS.map((t) => t.toLowerCase()));

function hasLockingComponentDescendant(node: JsxElement): boolean {
  return node.children.some((c) => c.type === 'element'
    && ((c.isComponent && !TEXT_HOST_INLINE_EMBEDS.has(c.tag)) || hasLockingComponentDescendant(c)));
}

/**
 * A text host is where the caret goes and what the write-back may replace the children of. Two kinds:
 *
 * - an HTML element with real text of its own whose component descendants, if any, are all inline embeds.
 *   Any other component keeps the host locked — its chrome is render output, and an edit could not be
 *   written back. `<style>` is text-shaped but is CSS, not prose. SVG is DRAWING: contenteditable inside an
 *   `<svg>` subtree is undefined browser behaviour, so the whole subset stays atomic.
 * - a kit text component (`KIT_TEXT_ELEMENTS`) whose children are plain text: `kitTextHost`.
 */
export function isEditableTextHost(node: JsxElement): boolean {
  if (node.isComponent) return kitTextHost(node).editable;
  if (node.tag.toLowerCase() === 'style') return false;
  if (SVG_TAGS_LOWER.has(node.tag.toLowerCase())) return false;
  const hasText = node.children.some((c) => c.type === 'text' && c.value.trim().length > 0);
  return hasText && !hasLockingComponentDescendant(node);
}

/**
 * Why text the reader sees takes no caret: it `data` — comes from a query, a value or a data component, so it
 * changes with the data; it is `computed` — a condition or an expression decides it; or the `component` draws it
 * (a control's label, a component's own content).
 */
export type TextLock = 'data' | 'computed' | 'component';

/** What each lock tells the author, beside the selection. */
export const TEXT_LOCK_REASONS: Readonly<Record<TextLock, string>> = {
  data: 'Text comes from data',
  computed: 'Text is computed',
  component: 'Text is drawn by the component',
};

/**
 * The phrasing marks a kit text component's text may carry: the prose editor's inline vocabulary and a line
 * break — never a block, never a component. Links only where the component's element is not a link itself.
 */
const KIT_TEXT_MARKS = immutableSet(['strong', 'b', 'em', 'i', 'u', 's', 'del', 'code', 'span', 'small', 'sup', 'sub', 'mark', 'kbd', 'br', 'a']);

/** Whether the text of kit text component `hostTag` may carry the HTML element `tag`. */
export function kitTextMarkAllowed(hostTag: string, tag: string): boolean {
  const lower = tag.toLowerCase();
  return KIT_TEXT_MARKS.has(lower) && (lower !== 'a' || kitTextAcceptsLinks(hostTag));
}

/** A data reference in an expression or a static attribute: `$query…`, `$value`, `$_row…`. */
const DATA_REF = /\$[A-Za-z_]/;
const valueLock = (value: JsxAttribute['value']): TextLock | null => {
  if (!value.static) return DATA_REF.test(value.source) ? 'data' : 'computed';
  return typeof value.json === 'string' && /^\s*\$[A-Za-z_]/.test(value.json) ? 'data' : null;
};
/** The strongest of two locks: data over computed over component. */
const stronger = (a: TextLock | null, b: TextLock | null): TextLock | null =>
  a === 'data' || b === 'data' ? 'data' : a === 'computed' || b === 'computed' ? 'computed' : a ?? b;

/** The lock a subtree carries: what binds data or computes anything in it. */
function subtreeLock(node: JsxNode): TextLock | null {
  if (node.type === 'text') return null;
  if (node.type === 'expression') return valueLock(node.value);
  let lock: TextLock | null = node.control ? 'computed' : null;
  for (const attr of node.attributes) lock = stronger(lock, valueLock(attr.value));
  for (const child of node.children) lock = stronger(lock, subtreeLock(child));
  return lock;
}

type KitTextHost = { editable: true } | { editable: false; lock: TextLock | null };

/**
 * A kit text component (`KIT_TEXT_ELEMENTS`) is a text host when what it renders is the author's text and
 * nothing else: every attribute static, and its children text, static string or number literals and the inline
 * marks its element accepts (static, recursively). Text that comes from data or is computed, a component inside
 * (a `<Cell>`, a `<Badge>`) or a block inside keeps it locked; `lock` says why, when the reason is the text
 * itself (a block or a component of its own is a container, not a locked text). Any other component is never a
 * text host: it draws its own content.
 */
export function kitTextHost(node: JsxElement): KitTextHost {
  if (!node.isComponent || !kitTextElement(node.tag)) return { editable: false, lock: null };
  // The shape first, from the children alone: a block or a component that is not an inline embed makes it a
  // container, decided without walking what it holds (a card's table of thousands of cells).
  let hasText = false, embeds = false;
  const phrasing = (children: JsxNode[]): boolean => children.every((child) => {
    if (child.type === 'text') { hasText ||= child.value.trim().length > 0; return true; }
    if (child.type === 'expression') {
      const json = child.value.static ? child.value.json : undefined;
      hasText ||= (typeof json === 'string' || typeof json === 'number') && String(json).trim().length > 0;
      return true;
    }
    if (child.control) return true;
    if (child.isComponent) { embeds = true; return TEXT_HOST_INLINE_EMBEDS.has(child.tag); }
    return kitTextMarkAllowed(node.tag, child.tag) && phrasing(child.children);
  });
  if (!phrasing(node.children)) return { editable: false, lock: null };
  // Text-shaped: what binds data or computes anything in it locks it, and says which.
  const lock = subtreeLock(node);
  if (lock) return { editable: false, lock };
  return hasText && !embeds ? { editable: true } : { editable: false, lock: null };
}

/**
 * Why `node`'s text takes no caret, when it shows text the author might try to type into; null when it is a
 * text host, holds no text of its own, or is a container whose parts are edited one by one.
 */
export function textLockOf(node: JsxNode | null): TextLock | null {
  if (!node || node.type !== 'element' || isEditableTextHost(node)) return null;
  if (node.isComponent) {
    if (kitTextElement(node.tag)) {
      const host = kitTextHost(node);
      return host.editable ? null : host.lock;
    }
    // A <Cell> is text the reader reads, formatted from its data.
    if (node.tag === 'Cell') return 'data';
    const showsText = node.children.some((c) => (c.type === 'text' && c.value.trim().length > 0) || c.type === 'expression');
    return showsText ? stronger(subtreeLock({ ...node, attributes: [] }), 'component') : null;
  }
  // Plain HTML: a computed text child is its lock (a host with text of its own is editable already).
  const own = node.children.reduce<TextLock | null>((lock, c) => c.type === 'expression' ? stronger(lock, valueLock(c.value)) : lock, null);
  return own ?? (node.control ? 'computed' : null);
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
