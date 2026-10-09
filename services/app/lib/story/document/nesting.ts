/**
 * The HTML parser's content model, applied to the AST before we store it.
 *
 * A document's markup is rendered twice — once to a string on the server,
 * once into a live DOM on the client (the editor, a live update) — and the two
 * are only the same tree if the STRING survives being parsed back. It does not
 * always: HTML's parser has a content model with implied end tags, so
 * `<p><div>x</div></p>` parses as an EMPTY `<p>` followed by a sibling `<div>`.
 * A client render builds the tree through DOM APIs, which enforce nothing, so
 * it produces the nesting the author wrote.
 *
 * The result is a hydration mismatch: the island cannot adopt a served tree
 * shaped differently from the one it builds, and (in the React era, error
 * #418) the client re-rendered the whole root. The reader sees the document paint once with the parser's tree
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
 * story vocabulary (lib/jsx/component-names STORY_HTML_TAGS).
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
 * story vocabulary (lib/jsx/component-names).
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
 * from here (see the module header) — except `<For>`, which is the
 * interpreter's own control element and draws a wrapper `<div>` around its
 * rows (lib/compiled-page/compiler). Inside `<svg>` that wrapper is a `<g>`,
 * which closes nothing, so there the search goes on into the row template. And
 * a button-scope element, because that is precisely where the parser stops
 * looking too.
 */
function breaksParagraph(nodes: JsxNode[], inSvg = false): boolean {
  return nodes.some((n) => {
    if (!isElement(n)) return false;
    if (n.isComponent) return n.tag === 'For' && (!inSvg || breaksParagraph(n.children, inSvg));
    const tag = n.tag.toLowerCase();
    if ((inSvg ? CLOSES_OPEN_P_IN_SVG : CLOSES_OPEN_P).has(tag)) return true;
    if (BUTTON_SCOPE.has(tag)) return false;
    return breaksParagraph(n.children, inSvg || tag === 'svg');
  });
}

/**
 * Rewrite paragraphs holding blocks and supply missing list containers, depth-first.
 *
 * The paragraph repair is structure-preserving: the element keeps its attributes, its
 * children and its position among its siblings, so nothing downstream that
 * addresses a node POSITIONALLY moves — the editor's held `<Question>`
 * selection and the edit protocol's AST paths both survive it. Only the tag
 * name changes.
 *
 * List repair retains every existing element/identity but inserts a parent around
 * invalid direct item runs. Publication assigns those new containers identities
 * after canonicalization, and editor transactions do so before persisting.
 *
 * A fixpoint: a rewritten `<div>` is not a `<p>`, and repaired items are inside
 * list containers, so a second pass finds
 * nothing. That is what lets this be part of canonical form (see
 * canonicalizeMarkup) rather than a one-off pass at publish.
 */
export function fixHtmlNesting(nodes: JsxNode[], listKind: 'ul' | 'ol' = 'ul'): JsxNode[] {
  // A subtree with nothing to repair is answered as it came (the same objects): the editor asks at every pause
  // of a report thousands of nodes long, and a copy of all of them was most of the answer.
  let changed = false;
  const out = nodes.map((node) => {
    if (!isElement(node)) return node;
    const kind = !node.isComponent && (node.tag === 'ul' || node.tag === 'ol') ? node.tag : listKind;
    let children = fixHtmlNesting(node.children, kind);
    // Legacy list commands allowed an item directly inside another item. DOM APIs
    // retain that tree, but HTML parsing closes the outer item and strands empty
    // bullet rows. Supply the missing list container; keep every authored node and
    // identity, including empty items, rather than guessing which wrappers to delete.
    if (!node.isComponent && node.tag === 'li' && children.some(child => isElement(child) && child.tag === 'li')) {
      const repaired: JsxNode[] = [];
      let run: JsxNode[] = [];
      const flush = () => {
        if (!run.length) return;
        repaired.push({ type: 'element', tag: kind, isComponent: false, attributes: [], children: run, selfClosing: false, start: 0, end: 0 });
        run = [];
      };
      for (const child of children) {
        if ((isElement(child) && child.tag === 'li') || (run.length && child.type === 'text' && !child.value.trim())) run.push(child);
        else { flush(); repaired.push(child); }
      }
      flush();
      children = repaired;
    }
    const rewrite = !node.isComponent && node.tag.toLowerCase() === 'p' && breaksParagraph(node.children);
    if (!rewrite && children === node.children) return node;
    changed = true;
    return { ...node, ...(rewrite ? { tag: 'div' } : {}), children };
  });
  return changed ? out : nodes;
}
