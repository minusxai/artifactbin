/**
 * The HTML parser's content model, applied to the AST before we store it.
 *
 * A document's markup is React-rendered twice — once to a string on the server,
 * once into a live DOM on the client — and the two are only the same tree if
 * the STRING survives being parsed back. It does not always: HTML's parser has
 * a content model with implied end tags, so `<p><div>x</div></p>` parses as an
 * EMPTY `<p>` followed by a sibling `<div>`. React's client render has no such
 * rule (it builds the tree through DOM APIs, which enforce nothing), so it
 * produces the nesting the author wrote.
 *
 * The result is a hydration mismatch — React error #418 — and React's answer to
 * that is to discard the whole server tree and re-render the root on the
 * client. The reader sees the document paint once with the parser's tree
 * (the `<p>`'s classes stranded on an empty element, its children promoted to
 * the grandparent and wearing none of them) and then repaint with the author's.
 * Measured on production: two of three public documents carried at least one
 * such node, one of them eight, and the repaint is plainly visible.
 *
 * So the fix is upstream of both renders: never store markup whose serialized
 * form parses back differently. A `<p>` that holds block content is rewritten
 * to a `<div>` — the element the author meant, since they hung layout classes
 * (`max-w-2xl`, `text-justify`) on it and expected them to contain the group.
 * `<p>` and `<div>` are both block boxes; what changes is the UA margin, which
 * every document's compiled sheet has already reset via preflight.
 *
 * Rewriting rather than REJECTING is deliberate. The authors here are agents,
 * `<p><div>` is something a language model emits constantly, and a hard reject
 * would turn an invisible cosmetic fault into a publish failure for markup that
 * every browser already renders — just not the way the author wrote it.
 *
 * Scope: the tags below, which is the parser's exact list for this one case
 * intersected with our tag allowlist. It is deliberately not "everything that
 * is not phrasing content" — over-rewriting a `<p>` that never needed it would
 * change a document's typography for nothing.
 */
import type { JsxElement, JsxNode } from '@/lib/jsx';

/**
 * Tags whose START tag closes an open `<p>` (HTML Standard, "in body"
 * insertion mode: each of these begins with "if the stack of open elements has
 * a p element in button scope, then close a p element"), restricted to the
 * story vocabulary (lib/story-ui/component-names STORY_HTML_TAGS).
 *
 * `li`/`dt`/`dd` are here for the same reason even though they are list
 * internals: their start tags close a p too.
 */
const CLOSES_OPEN_P: ReadonlySet<string> = new Set([
  'address', 'article', 'aside', 'blockquote', 'details', 'dialog', 'div', 'dl',
  'dd', 'dt', 'fieldset', 'figcaption', 'figure', 'footer', 'header', 'hr',
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'li', 'main', 'nav', 'ol', 'p', 'pre',
  'section', 'summary', 'table', 'ul',
]);

/**
 * Elements that create BUTTON SCOPE (HTML Standard: the special scope list plus
 * `button`). The parser's rule is "close a p element IF the stack of open
 * elements has a p in button scope" — so one of these between the paragraph and
 * the block tag stops the paragraph being closed, and the nesting is fine.
 *
 * `table`/`td`/`th`/`caption` are here for completeness; `table` is in
 * CLOSES_OPEN_P and is tested first, and the others cannot appear outside one.
 */
const BUTTON_SCOPE: ReadonlySet<string> = new Set([
  'button', 'template', 'table', 'td', 'th', 'caption', 'object', 'marquee', 'applet',
]);

/**
 * Inside `<svg>` the parser is in FOREIGN CONTENT, where a tag is an SVG
 * element unless it is on the standard's breakout list. So `<svg><div>` still
 * closes an open paragraph — the div breaks out and is reprocessed as HTML —
 * while `<svg><figure>` does not: `figure` is not on that list, and there it is
 * simply an unknown SVG element.
 *
 * This is the breakout list intersected with CLOSES_OPEN_P (everything else on
 * it — `b`, `br`, `code`, `em`, `img`, `span`, … — never closes a paragraph
 * anyway). `<foreignObject>`, which would switch back to HTML, is not in the
 * story vocabulary (lib/story-ui/component-names).
 */
const CLOSES_OPEN_P_IN_SVG: ReadonlySet<string> = new Set([
  'blockquote', 'dd', 'div', 'dl', 'dt', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'hr', 'li', 'ol', 'p', 'pre', 'table', 'ul',
]);

const isElement = (n: JsxNode): n is JsxElement => n.type === 'element';

/**
 * Does anything in this `<p>` close it?
 *
 * The search is over DESCENDANTS, not just children — this is the part that was
 * wrong first time round and that a sweep of 252 nesting shapes caught, 224 of
 * them failing. Inline elements create no scope, so `<p><span><div>…` closes the
 * paragraph exactly as `<p><div>…` does; the parser is looking at its stack of
 * open elements, not at one level of nesting.
 *
 * It stops at two things. A component, because what it renders is unknowable
 * from here (see the module header). And a button-scope element, because that is
 * precisely where the parser stops looking too.
 */
function breaksParagraph(nodes: JsxNode[], inSvg = false): boolean {
  return nodes.some((n) => {
    if (!isElement(n) || n.isComponent) return false;
    const tag = n.tag.toLowerCase();
    if ((inSvg ? CLOSES_OPEN_P_IN_SVG : CLOSES_OPEN_P).has(tag)) return true;
    if (BUTTON_SCOPE.has(tag)) return false;
    return breaksParagraph(n.children, inSvg || tag === 'svg');
  });
}

/**
 * Rewrite every `<p>` that holds block content into a `<div>`, depth-first.
 *
 * Structure-preserving by construction: the element keeps its attributes, its
 * children and its position among its siblings, so nothing downstream that
 * addresses a node POSITIONALLY moves — the editor's held `<Question>`
 * selection and the edit protocol's AST paths both survive it. Only the tag
 * name changes.
 *
 * A fixpoint: a rewritten `<div>` is not a `<p>`, so a second pass finds
 * nothing. That is what lets this be part of canonical form (see
 * canonicalizeMarkup) rather than a one-off pass at publish.
 */
export function fixHtmlNesting(nodes: JsxNode[]): JsxNode[] {
  return nodes.map((node) => {
    if (!isElement(node)) return node;
    const children = fixHtmlNesting(node.children);
    const rewrite = !node.isComponent && node.tag.toLowerCase() === 'p' && breaksParagraph(node.children);
    return { ...node, ...(rewrite ? { tag: 'div' } : {}), children };
  });
}
