/**
 * COMPOSING WHAT THE DOCUMENT REPORTED INTO THE DOCUMENT'S SOURCE.
 *
 * The frame stages edits as it goes — a host's new innerHTML at blur, an
 * element's new classes when the toolbar applies one — and the parent, which
 * holds the source, composes them here. Every commit re-applies the WHOLE
 * pending set against the CURRENT source rather than patching the last result,
 * which is what makes sequential edits compose: a text edit must never
 * re-derive the source without the format changes made since, and vice versa.
 *
 * Order is load-bearing and matches the canvas's: text first (it rewrites a
 * host's children), then formats, then layout rects. All three are attribute-
 * or subtree-local, so AST paths stay valid across the whole chain.
 *
 * Pure — the parent may hold the source but this holds nothing.
 */
import {
  applyDomEditsToJsx, applyFormatEditsToJsx, applyLayoutEditsToJsx,
  type JsxLayoutEdit,
} from '@/lib/data/story/jsx-edit';
import { parseJsx, type JsxNode } from '@/lib/jsx';
import { isEditableTextHost, resolveJsxNodeAtPath } from '@/lib/story-ui/host-classify';

/**
 * THE DOCUMENT COUNTS FROM THE BODY; THE SOURCE COUNTS FROM THE TOP.
 *
 * A served document renders `split.body` — the `<Helmet>` is hoisted out before
 * anything is stamped — so the `data-mx-ast` paths it reports index the BODY.
 * The source those paths have to be written back into still begins with the
 * Helmet. One node of difference, in the FIRST index only, and it silently
 * rewrites the wrong element: a document with any data declaration edits its
 * neighbour, while a document of pure prose works perfectly and hides it.
 */
export function helmetOffset(nodes: JsxNode[]): number {
  const first = nodes[0];
  return first && first.type === 'element' && first.tag === 'Helmet' ? 1 : 0;
}

/** Translate a path the DOCUMENT reported into a path into `source`. */
export function bodyPathToSourcePath(source: string, path: string): string {
  const parsed = parseJsx(source);
  if (!parsed.ok) return path;
  const offset = helmetOffset(parsed.nodes);
  if (!offset) return path;
  const [head, ...rest] = path.split('.');
  const index = Number(head);
  if (!Number.isInteger(index) || index < 0) return path;
  return [String(index + offset), ...rest].join('.');
}

/**
 * The inverse: translate a path into `source` to the path the DOCUMENT
 * renders it at. Null when the node has no body address — it is (or lives
 * inside) the hoisted `<Helmet>` itself.
 */
export function sourcePathToBodyPath(source: string, path: string): string | null {
  const parsed = parseJsx(source);
  if (!parsed.ok) return path;
  const offset = helmetOffset(parsed.nodes);
  if (!offset) return path;
  const [head, ...rest] = path.split('.');
  const index = Number(head);
  if (!Number.isInteger(index) || index < 0) return path;
  if (index < offset) return null;
  return [String(index - offset), ...rest].join('.');
}

/** A format edit as the toolbar reports it: each present field is the attribute's full new value. */
export interface ComposableFormatEdit {
  className?: string;
  style?: string;
}

/**
 * Everything staged but not yet folded into the source, keyed by AST path.
 * Maps rather than arrays: a second edit to the same node replaces the first,
 * which is what "the host's current content" means.
 */
export interface PendingEdits {
  text: ReadonlyMap<string, string>;
  format: ReadonlyMap<string, ComposableFormatEdit>;
  layout: ReadonlyMap<string, Omit<JsxLayoutEdit, 'astPath'>>;
}

export const NO_PENDING_EDITS: PendingEdits = { text: new Map(), format: new Map(), layout: new Map() };

export function hasPendingEdits(pending: PendingEdits): boolean {
  return pending.text.size > 0 || pending.format.size > 0 || pending.layout.size > 0;
}

/**
 * The source with every pending edit applied. Returns it unchanged when
 * nothing is pending or nothing could be applied — a stale or hostile path is
 * dropped by the write-back itself, never allowed to corrupt the body.
 */
export function composeSource(source: string, pending: PendingEdits): string {
  if (!hasPendingEdits(pending)) return source;
  /*
   * A text edit may only address a TEXT HOST, checked against the source here.
   *
   * The frame makes nothing else editable, so a well-behaved document never
   * sends anything else — but the parent is the boundary, and the write-back
   * itself will happily replace a component's children with whatever it is
   * given. A component's DOM is render chrome; writing it back would serialize
   * a chart's markup into the author's source.
   */
  const parsed = parseJsx(source);
  const offset = parsed.ok ? helmetOffset(parsed.nodes) : 0;
  /** Body-relative (what the document reported) → source-relative (what we write). */
  const at = (astPath: string) => {
    if (!offset) return astPath;
    const [head, ...rest] = astPath.split('.');
    const index = Number(head);
    return Number.isInteger(index) && index >= 0 ? [String(index + offset), ...rest].join('.') : astPath;
  };
  const addressable = (astPath: string) => {
    if (!parsed.ok) return false;
    const node = resolveJsxNodeAtPath(parsed.nodes, astPath);
    return !!node && node.type === 'element' && !node.isComponent && isEditableTextHost(node);
  };
  const withText = applyDomEditsToJsx(
    source,
    [...pending.text]
      .map(([astPath, innerHtml]) => ({ astPath: at(astPath), innerHtml }))
      .filter((e) => addressable(e.astPath)),
  ).source;
  const withFormat = applyFormatEditsToJsx(
    withText,
    [...pending.format].map(([astPath, edit]) => ({ astPath: at(astPath), ...edit })),
  );
  return applyLayoutEditsToJsx(
    withFormat,
    [...pending.layout].map(([astPath, rect]) => ({ astPath: at(astPath), ...rect })),
  );
}
