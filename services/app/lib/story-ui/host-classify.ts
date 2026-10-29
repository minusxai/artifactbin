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
 * Nothing here reaches for a DOM, and nothing imports upward. `lib/story-design`
 * re-exports these so no caller has to learn a second name for them.
 */
import type { JsxAttribute, JsxElement, JsxNode } from '@/lib/jsx';
import { kitTextAcceptsLinks, kitTextElement, STORY_SVG_TAGS } from '@/lib/jsx/component-names';
import { immutableSet } from '@/lib/jsx/immutable-set';

/**
 * Components that sit INSIDE a line of text: the reader draws them inline. A text holding one is still text —
 * its marks are part of it — but only a static one keeps it editable.
 */
const TEXT_EMBEDS = immutableSet(['Cell', 'Icon']);
/**
 * The embeds a plain HTML host's edit keeps: drawn from static props alone, they are a locked island while editing and
 * spliced back verbatim from the source by their stamp on commit. A `<Cell>` reads data: it locks its text instead.
 */
const SPLICED_EMBEDS = immutableSet(['Icon']);

/** Whether `node`, stamped inside an edited plain HTML host, is spliced back from the source. */
export const isSplicedEmbed = (node: JsxNode | null): boolean =>
  node?.type === 'element' && node.isComponent && SPLICED_EMBEDS.has(node.tag);

const SVG_TAGS_LOWER = immutableSet<string>(STORY_SVG_TAGS.map((t) => t.toLowerCase()));

/** A component in `node` that draws its own content: anything but an inline embed or a condition's branches. */
function hasBlockingComponentDescendant(node: JsxElement): boolean {
  return node.children.some((c) => c.type === 'element'
    && ((c.isComponent && !c.control && !TEXT_EMBEDS.has(c.tag)) || hasBlockingComponentDescendant(c)));
}

/** Whether `node` takes a caret: `textHost` says it is text to type in. */
export function isEditableTextHost(node: JsxElement): boolean {
  return textHost(node).editable;
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
const ROW_TEXT = /\{\s*\$_row\./;
const valueLock = (value: JsxAttribute['value']): TextLock | null => {
  if (!value.static) return DATA_REF.test(value.source) ? 'data' : 'computed';
  return typeof value.json === 'string' && /^\s*\$[A-Za-z_]/.test(value.json) ? 'data' : null;
};
/** The strongest of two locks: data over computed over component. */
const stronger = (a: TextLock | null, b: TextLock | null): TextLock | null =>
  a === 'data' || b === 'data' ? 'data' : a === 'computed' || b === 'computed' ? 'computed' : a ?? b;

/** The lock a subtree carries: what binds data or computes anything in it. */
function subtreeLock(node: JsxNode): TextLock | null {
  // A row template's text substitutes `{$_row.…}` in place (the compiler's `rt.sub`).
  if (node.type === 'text') return ROW_TEXT.test(node.value) ? 'data' : null;
  if (node.type === 'expression') return valueLock(node.value);
  // A <Cell> (once <Number>) is text the reader reads, formatted from its data, whatever its props say.
  if (node.isComponent && node.tag === 'Cell') return 'data';
  let lock: TextLock | null = node.control ? 'computed' : null;
  for (const attr of node.attributes) lock = stronger(lock, valueLock(attr.value));
  for (const child of node.children) lock = stronger(lock, subtreeLock(child));
  return lock;
}

/**
 * What a node's text is to the editor: text to type in (`editable`); text that takes no caret, and why (`lock`); or
 * not text at all (`lock: null`) — a container, a drawing, a component's own content — whose parts are decided one by one.
 */
export type TextHost = { editable: true } | { editable: false; lock: TextLock | null };
const EDITABLE: TextHost = { editable: true };
const NOT_TEXT: TextHost = { editable: false, lock: null };

/**
 * A kit text component (`KIT_TEXT_ELEMENTS`) is a text host when what it renders is the author's text and
 * nothing else: every attribute static, and its children text, static string or number literals and the inline
 * marks its element accepts (static, recursively). Text that comes from data or is computed, a component inside
 * (a `<Cell>`, a `<Badge>`) or a block inside keeps it locked; `lock` says why, when the reason is the text
 * itself (a block or a component of its own is a container, not a locked text). Any other component is never a
 * text host: it draws its own content.
 */
export function kitTextHost(node: JsxElement): TextHost {
  if (!node.isComponent || !kitTextElement(node.tag)) return NOT_TEXT;
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
    if (child.isComponent) { embeds = true; return TEXT_EMBEDS.has(child.tag); }
    return kitTextMarkAllowed(node.tag, child.tag) && phrasing(child.children);
  });
  if (!phrasing(node.children)) return NOT_TEXT;
  // Text-shaped: what binds data or computes anything in it locks it, and says which.
  const lock = subtreeLock(node);
  if (lock) return { editable: false, lock };
  return hasText && !embeds ? EDITABLE : NOT_TEXT;
}

const literalText = (json: unknown): boolean => (typeof json === 'string' || typeof json === 'number') && String(json).trim().length > 0;

/**
 * A plain HTML element is text when it shows text of its own — a word, a static literal, or an expression or a
 * condition whose value the reader writes in its place — and every component in it is an inline embed. Its marks
 * and any other elements inside are part of that text. It takes a caret only when nothing in its children binds data
 * or computes anything: the reader writes an expression's VALUE into the line with nothing around it, so typing
 * beside one and saving would write the value over the binding (or drop it). (In a prose block the editor instead carries a
 * plain read, `{$x}` or `{$q.col}`, as one uneditable chip: lib/editor-engine/model.ts.) Its own attributes stay where they are
 * on a text edit (only the children are written), so they never lock it. `<style>` is CSS, not prose; SVG is drawing:
 * contenteditable inside an `<svg>` subtree is undefined browser behaviour, so the whole subset stays atomic.
 */
function htmlTextHost(node: JsxElement): TextHost {
  const lower = node.tag.toLowerCase();
  if (lower === 'style' || SVG_TAGS_LOWER.has(lower)) return NOT_TEXT;
  let hasText = false, shown = false;
  for (const child of node.children) {
    if (child.type === 'text') hasText ||= child.value.trim().length > 0;
    else if (child.type === 'expression') {
      if (child.value.static) hasText ||= literalText(child.value.json);
      else shown = true;
    } else if (child.control) shown = true;
  }
  if (!hasText && !shown) return NOT_TEXT;
  // Another component's chrome is render output: it makes this a container, its parts decided one by one.
  if (hasBlockingComponentDescendant(node)) return NOT_TEXT;
  let lock: TextLock | null = null;
  for (const child of node.children) lock = stronger(lock, subtreeLock(child));
  if (lock) return { editable: false, lock };
  return hasText ? EDITABLE : NOT_TEXT;
}

/**
 * THE text-host rule, one for kit text components (`kitTextHost`) and plain HTML (`htmlTextHost`): a node takes a
 * caret only when its text is the author's — text, static literals, marks (and, in plain HTML, static inline embeds)
 * — and an expression, a data component or a condition in it locks it with the reason. Any other component draws its
 * own content and is never a text host.
 */
export function textHost(node: JsxElement): TextHost {
  return node.isComponent ? kitTextHost(node) : htmlTextHost(node);
}

/** Whether `host` is text, editable or locked: its marks are part of it, never hosts or selections of their own. */
export const isText = (host: TextHost): boolean => host.editable || host.lock !== null;

/**
 * The path of the text the node at `path` is part of: its outermost ancestor that is text (a mark in a paragraph is
 * the paragraph, a link in a card title is the title), or `path` itself.
 */
export function textOwnerPath(roots: JsxNode[], path: string): string {
  const parts = path.split('.');
  let list = roots;
  for (let depth = 0; depth < parts.length - 1; depth++) {
    const node = list[Number(parts[depth])];
    if (!node || node.type !== 'element') return path;
    if (isText(textHost(node))) return parts.slice(0, depth + 1).join('.');
    list = node.children;
  }
  return path;
}

/**
 * Why `node`'s text takes no caret, when it shows text the author might try to type into; null when it is a
 * text host, holds no text of its own, or is a container whose parts are edited one by one.
 */
export function textLockOf(node: JsxNode | null): TextLock | null {
  if (!node || node.type !== 'element') return null;
  const host = textHost(node);
  if (host.editable) return null;
  if (host.lock) return host.lock;
  if (node.isComponent && !kitTextElement(node.tag)) {
    // A <Cell> is text the reader reads, formatted from its data.
    if (node.tag === 'Cell') return 'data';
    const showsText = node.children.some((c) => (c.type === 'text' && c.value.trim().length > 0) || c.type === 'expression');
    return showsText ? stronger(subtreeLock({ ...node, attributes: [] }), 'component') : null;
  }
  return null;
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
