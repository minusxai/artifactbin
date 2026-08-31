/**
 * `fixHtmlNesting` — the AST half of "stored markup must survive being parsed
 * back". See lib/story/nesting.ts for the failure it prevents; the proof that
 * it actually prevents it, over a real served document and a real HTML parser,
 * is nesting-parses-back.test.ts.
 *
 * These pin the RULE: which children make a `<p>` a `<div>`, that everything
 * else about the element is preserved, and that the transform is a fixpoint —
 * canonical form is re-derived on every edit, so a rule that kept changing its
 * own output would make every write diff against a different base.
 */
import { describe, expect, it } from 'vitest';
import { parseJsx, serializeJsx, type JsxNode } from '@/lib/jsx';
import { fixHtmlNesting } from '@/lib/story/nesting';
import { canonicalizeMarkup } from '@/lib/story/jsx-tier';

const fix = (src: string): string => {
  const parsed = parseJsx(src);
  if (!parsed.ok) throw new Error(parsed.error);
  return serializeJsx(fixHtmlNesting(parsed.nodes));
};

describe('a paragraph holding block content becomes a div', () => {
  it('rewrites the tag and nothing else', () => {
    const out = fix('<p className="mx-auto max-w-2xl text-justify"><div className="text-base">Hi</div></p>');
    expect(out).toBe('<div className="mx-auto max-w-2xl text-justify"><div className="text-base">Hi</div></div>');
  });

  it('fires on every tag whose start tag closes an open p', () => {
    // The parser's own list, restricted to the story vocabulary. Each of these
    // strands the paragraph's classes on an empty element if left alone.
    for (const tag of ['div', 'p', 'ul', 'ol', 'li', 'dl', 'dt', 'dd', 'table', 'blockquote',
      'pre', 'figure', 'figcaption', 'section', 'article', 'aside', 'header', 'footer',
      'main', 'nav', 'address', 'details', 'summary', 'hr', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6']) {
      const out = fix(`<p id="x"><${tag} /></p>`);
      expect(out.startsWith('<div id="x">'), tag).toBe(true);
    }
  });

  it('leaves a paragraph of phrasing content alone', () => {
    for (const inner of ['<span>a</span>', '<a href="/x">a</a>', '<strong>a</strong>', '<em>a</em>',
      '<code>a</code>', '<img src="/a.png" />', '<br />', '<small>a</small>', '<sup>1</sup>',
      '<time>now</time>', '<mark>a</mark>', '<button>go</button>', '<input />', '<label>a</label>']) {
      const out = fix(`<p id="x">${inner}</p>`);
      expect(out.startsWith('<p id="x">'), inner).toBe(true);
    }
  });

  it('leaves a paragraph of plain text alone', () => {
    expect(fix('<p>Just words.</p>')).toBe('<p>Just words.</p>');
  });

  it('rewrites for a block DESCENDANT, not only a block child', () => {
    /*
     * This is the case the rule got wrong first time, and the comment that used
     * to sit here — "only the p's OWN children decide" — was the wrong belief
     * that caused it. An inline wrapper creates no scope, so the parser closes
     * the paragraph just the same: it is looking at its stack of open elements,
     * not at one level of nesting. nesting-vs-parser.test.ts sweeps this
     * exhaustively; these are the shapes worth naming.
     */
    for (const inner of ['<span><div>a</div></span>', '<a href="/x"><ul><li>a</li></ul></a>',
      '<em><strong><figure>a</figure></strong></em>', '<span><span><table><tbody><tr><td>a</td></tr></tbody></table></span></span>']) {
      expect(fix(`<p id="x">${inner}</p>`).startsWith('<div id="x">'), inner).toBe(true);
    }
  });

  it('stops at a button, where the parser stops too', () => {
    // `button` creates button scope, so a block inside one does NOT close the
    // paragraph — and rewriting there would be a change for nothing.
    expect(fix('<p id="x"><button><div>a</div></button></p>').startsWith('<p id="x">')).toBe(true);
    expect(fix('<p id="x"><span><button><ul><li>a</li></ul></button></span></p>').startsWith('<p id="x">')).toBe(true);
  });

  it('knows that inside <svg> only the breakout tags close a paragraph', () => {
    // Foreign content: `figure` there is an unknown SVG element, `div` breaks
    // back out to HTML and takes the paragraph with it.
    expect(fix('<p id="x"><svg><figure>a</figure></svg></p>').startsWith('<p id="x">')).toBe(true);
    expect(fix('<p id="x"><svg><div>a</div></svg></p>').startsWith('<div id="x">')).toBe(true);
  });

  it('still leaves a paragraph of nested INLINE content alone', () => {
    expect(fix('<p id="x"><span><em>a</em></span></p>').startsWith('<p id="x">')).toBe(true);
  });

  it('rewrites nested paragraphs at every depth', () => {
    const out = fix('<section><div><p><figure /></p></div></section>');
    expect(out).toBe('<section><div><div><figure /></div></div></section>');
  });

  it('rewrites a paragraph whose block child sits among text and inline siblings', () => {
    const out = fix('<p>lead <em>in</em> <div>block</div> tail</p>');
    expect(out).toBe('<div>lead <em>in</em> <div>block</div> tail</div>');
  });
});

describe('what it must not touch', () => {
  it('never rewrites a component, whatever its name', () => {
    // `<P>` is not `<p>`: a capitalized tag is a component, and the parser has
    // no content model for one — its RENDERED output is what the browser sees.
    expect(fix('<Card><div>x</div></Card>')).toBe('<Card><div>x</div></Card>');
  });

  it('leaves a component child of a paragraph alone', () => {
    // A component's rendered box is not knowable from the AST, and `<Number>`
    // is deliberately inline. Rewriting here would change the typography of
    // every paragraph carrying an inline metric.
    expect(fix('<p>up <Number data="$q" /> today</p>')).toBe('<p>up <Number data="$q" /> today</p>');
  });

  it('keeps attributes, expression children and self-closing form intact', () => {
    const src = '<p data-x={{"a":1}} className="c"><div>{{"b":2}}</div></p>';
    expect(fix(src)).toBe('<div data-x={{"a":1}} className="c"><div>{{"b":2}}</div></div>');
  });
});

describe('it is a fixpoint', () => {
  it('a second pass changes nothing', () => {
    const once = fix('<p className="c"><div>a</div><ul><li>b</li></ul></p>');
    expect(fix(once)).toBe(once);
  });

  it('canonical form is stable under it', () => {
    const once = canonicalizeMarkup('<p className="c"><div>a</div></p>');
    expect(canonicalizeMarkup(once)).toBe(once);
  });
});

describe('canonicalizeMarkup applies it', () => {
  it('stores the fixed form, so every write and every read agree', () => {
    expect(canonicalizeMarkup('<p className="c"><div>a</div></p>'))
      .toBe('<div className="c"><div>a</div></div>');
  });

  it('still returns unparseable source untouched', () => {
    expect(canonicalizeMarkup('<p><div>')).toBe('<p><div>');
  });

  it('does not disturb a document that never had the fault', () => {
    const src = '<div className="wrap"><h1>T</h1><p>Words and <em>emphasis</em>.</p></div>';
    expect(canonicalizeMarkup(src)).toBe(src);
  });
});

describe('the invariants other code rests on', () => {
  /**
   * AST paths are POSITIONAL. The editor holds a `<Question>` selection as one
   * (components/ArtifactEditor → VizEditorPanel), `updateQuestionChartInJsx`
   * writes back through one, and the interpreter stamps them as `data-mx-ast`.
   * A transform that inserted, removed or reordered a node would silently
   * repoint every held path at a DIFFERENT element, which no tag guard
   * downstream would question. Only the tag NAME may change.
   */
  const paths = (nodes: JsxNode[], prefix = ''): string[] =>
    nodes.flatMap((n, i) => {
      const id = prefix ? `${prefix}.${i}` : `${i}`;
      return n.type === 'element' ? [id, ...paths(n.children, id)] : [id];
    });

  it('changes no node\'s position — every AST path survives', () => {
    const src = '<div><p className="a"><div>x</div><span>y</span></p><Question data="$q" />'
      + '<section><p><ul><li>1</li><li>2</li></ul></p></section></div>';
    const parsed = parseJsx(src);
    if (!parsed.ok) throw new Error(parsed.error);
    expect(paths(fixHtmlNesting(parsed.nodes))).toEqual(paths(parsed.nodes));
  });

  it('changes nothing but tag names', () => {
    const src = '<div><p className="a"><div>x</div></p></div>';
    const parsed = parseJsx(src);
    if (!parsed.ok) throw new Error(parsed.error);
    const strip = (nodes: JsxNode[]): unknown =>
      nodes.map((n) => (n.type === 'element'
        ? { attrs: n.attributes.map((a) => a.name), selfClosing: n.selfClosing, children: strip(n.children) }
        : n.type));
    expect(strip(fixHtmlNesting(parsed.nodes))).toEqual(strip(parsed.nodes));
  });

  it('leaves a self-closing paragraph alone — it has no children to break it', () => {
    expect(fix('<div><p /></div>')).toBe('<div><p /></div>');
  });

  it('does not reach inside a Helmet', () => {
    // It runs ABOVE the Helmet split in buildStoryDocument, so it sees the
    // whole document. Helmet's grammar has no paragraphs, but its <style> and
    // <script> hold arbitrary TEXT that must come through untouched.
    const src = '<Helmet><style>{`p div { color: red }`}</style>'
      + '<Query name="q">{`select 1`}</Query></Helmet><p><div>x</div></p>';
    const out = fix(src);
    expect(out).toContain('<style>{`p div { color: red }`}</style>');
    expect(out).toContain('<Query name="q">{`select 1`}</Query>');
    expect(out).toContain('<div><div>x</div></div>');
  });
});
