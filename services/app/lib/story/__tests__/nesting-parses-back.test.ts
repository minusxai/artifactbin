/**
 * The claim behind lib/story/nesting.ts, tested over the thing that actually
 * ships: a complete served document, parsed by a real HTML parser.
 *
 * This is the shape of the probe that found the bug on production. Every node
 * the interpreter renders carries `data-mx-ast="<path>"`, so its intended
 * parent is written on it — `0.1.5.0`'s parent is `0.1.5`. Parse the served
 * bytes, walk the result, and any node whose actual parent is not its named
 * one is a node the parser MOVED. React's client render will not move it, so
 * every such node is a hydration mismatch (#418), and React's response to that
 * is to throw the server tree away and re-render the root.
 *
 * Asserted on the parsed TREE rather than on the source text: the swallowed
 * markup is all still present as characters, so any `toContain` check passes
 * happily while the document is broken.
 */
import { describe, expect, it } from 'vitest';
import { JSDOM } from 'jsdom';
import { buildStoryDocument } from '@/lib/story/document';

/** Nodes whose parsed parent is not the parent their AST path names. */
function reparented(html: string): string[] {
  const { document } = new JSDOM(html).window;
  const moved: string[] = [];
  for (const el of document.querySelectorAll('[data-mx-ast]')) {
    const id = el.getAttribute('data-mx-ast')!;
    if (!id.includes('.')) continue;
    const want = id.slice(0, id.lastIndexOf('.'));
    const got = el.parentElement?.getAttribute('data-mx-ast');
    if (got !== want) moved.push(`${id} <${el.tagName.toLowerCase()}> wanted ${want}, got ${got}`);
  }
  return moved;
}

const serve = (source: string): Promise<string> =>
  buildStoryDocument({
    source, compiledCss: null, theme: null, colorMode: null, refData: {},
    title: 'nesting', runtimeSrc: '/story/entry-TESTHASH.js',
  });

/*
 * The production document, reduced: a header whose intro paragraph carries the
 * measure and the justification, holding the divs the author put inside it.
 * Unfixed, the parser strands the classes on an empty <p> and promotes all five
 * divs to <header> — eight moved nodes on the real document, and prose that
 * paints full-width and unjustified until React re-renders it.
 */
const HEADER_WITH_DIVS =
  '<div className="mx-root"><header className="mx-auto max-w-6xl">'
  + '<h1 className="text-5xl">Built something cool?</h1>'
  + '<p className="mx-auto mt-7 max-w-2xl text-justify text-muted-foreground">'
  + '<div className="text-base">For over a decade now, <a href="https://example.com"><b>Hacker News</b></a> has held a place.</div>'
  + '<div className="text-base mt-4">It also left me wondering.</div>'
  + '</p></header></div>';

describe('a served document parses back as the tree it was rendered from', () => {
  it('moves nothing, for the shape that was moving eight nodes in production', async () => {
    expect(reparented(await serve(HEADER_WITH_DIVS))).toEqual([]);
  });

  it('the probe itself detects a moved node — the guard on the guard', () => {
    /*
     * Without this, a `reparented` that silently found nothing (a renamed
     * attribute, a selector typo) would make every assertion here pass over a
     * broken document. So: the pre-fix shape, hand-written exactly as the
     * renderer used to emit it, must still come back as a moved node.
     */
    const before = '<!DOCTYPE html><html><body><header data-mx-ast="0">'
      + '<p data-mx-ast="0.1" class="max-w-2xl"><div data-mx-ast="0.1.0">text</div></p>'
      + '</header></body></html>';
    expect(reparented(before)).toEqual(['0.1.0 <div> wanted 0.1, got 0']);
  });

  it('renders the paragraph as a div, keeping the classes around its content', async () => {
    // The point of the rewrite, not just its side effect: the measure and the
    // justification still contain the text they were written for.
    const html = await serve(HEADER_WITH_DIVS);
    const { document } = new JSDOM(html).window;
    const inner = document.querySelector('[class*="text-base"]');
    expect(inner).not.toBeNull();
    const holder = inner!.parentElement!;
    expect(holder.tagName.toLowerCase()).toBe('div');
    expect(holder.className).toContain('max-w-2xl');
    expect(holder.className).toContain('text-justify');
    // …and it still holds BOTH of the divs the author put in it.
    expect(holder.querySelectorAll('[class*="text-base"]').length).toBe(2);
  });

  it('holds for every block tag a paragraph might be given', async () => {
    for (const tag of ['div', 'ul', 'table', 'figure', 'blockquote', 'section', 'h2', 'pre']) {
      const inner = tag === 'ul' ? '<ul><li>a</li></ul>'
        : tag === 'table' ? '<table><tbody><tr><td>a</td></tr></tbody></table>'
        : `<${tag}>a</${tag}>`;
      const html = await serve(`<div><p className="lead">${inner}</p></div>`);
      expect(reparented(html), tag).toEqual([]);
    }
  });

  it('holds through nesting, and leaves ordinary prose alone', async () => {
    const html = await serve(
      '<section><p>Plain <em>prose</em> with <a href="/x">a link</a>.</p>'
      + '<div><p className="a"><figure><img src="/i.png" /><figcaption>c</figcaption></figure></p></div></section>',
    );
    expect(reparented(html)).toEqual([]);
    // The paragraph that never broke is still a paragraph.
    expect(html).toContain('<p data-mx-ast');
  });
});

/**
 * The tag list in lib/story/nesting.ts is the HTML parser's own — quoted from
 * the spec, which is a thing a person can get wrong. So it is checked against
 * a real parser instead of against the quote: for every tag the story
 * vocabulary admits, put one inside a `<p>` and one inside a `<div>`, parse
 * both, and see which survives where.
 *
 * The `<div>` control is what makes the question precise. A tag that vanishes
 * from BOTH is not a paragraph problem at all — `<td>` outside a `<table>` is
 * dropped wherever it appears, which is a different fault with a different fix
 * and is deliberately not this module's business. Only a tag that survives in
 * a `<div>` and not in a `<p>` is one we must rewrite for.
 *
 * The doctype is load-bearing: without it the parser is in QUIRKS mode, where
 * `<table>` alone does not close a `<p>` — and the document we serve always
 * has one.
 */
describe('the list of tags that break a paragraph is the parser\'s, not a guess', () => {
  // One document, reused — building a fresh JSDOM per probe is what took a CI
  // worker out in nesting-vs-parser.test.ts (3.6 GB peak). The doctype is
  // load-bearing: in quirks mode `<table>` alone does not close a `<p>`.
  const DOM = new JSDOM('<!DOCTYPE html><body></body>');
  const survives = (parent: string, tag: string): boolean => {
    const doc = DOM.window.document;
    doc.body.innerHTML = `<${parent} id="host">text<${tag}></${tag}></${parent}>`;
    return doc.querySelector(`#host ${tag}`) !== null;
  };

  it('rewrites for exactly the tags a paragraph cannot hold', async () => {
    const { STORY_HTML_TAGS } = await import('@/lib/story-ui/component-names');
    const wrong: string[] = [];
    let breakers = 0;
    for (const tag of STORY_HTML_TAGS) {
      // Void tags have no closing form, and SVG's camelCase names are a
      // different parsing mode entirely.
      if (['br', 'wbr', 'img', 'input', 'source', 'col', 'track'].includes(tag)) continue;
      if (tag !== tag.toLowerCase()) continue;

      const breaksParagraph = survives('div', tag) && !survives('p', tag);
      if (breaksParagraph) breakers += 1;
      const served = await serve(`<div><p className="lead"><${tag}></${tag}></p></div>`);
      const weRewrote = !/<p[^>]*class="[^"]*lead/.test(served);
      if (breaksParagraph !== weRewrote) {
        wrong.push(`${tag}: parser closes the p=${breaksParagraph}, we rewrite=${weRewrote}`);
      }
    }
    expect(wrong).toEqual([]);
    // …and the sweep actually found some, rather than agreeing on an empty set.
    expect(breakers).toBeGreaterThan(20);
  });
});

/**
 * The served document is the ONE rendering a reader gets (the owner's frame is
 * the same bytes), so the rewrite has to hold in exactly what /raw emits: a
 * `<p>` stranded there is a paragraph the browser's parser moves out of the
 * element carrying its measure, and a document that paints full-width.
 */
describe('the served document', () => {
  it('has no node the parser moves', async () => {
    expect(reparented(await serve(HEADER_WITH_DIVS))).toEqual([]);
  });

  it('renders the text inside the element carrying its measure', async () => {
    const { document } = new JSDOM(await serve(HEADER_WITH_DIVS)).window;
    const holder = document.querySelector('[class*="text-base"]')!.parentElement!;
    expect(holder.tagName.toLowerCase()).toBe('div');
    expect(holder.className).toContain('max-w-2xl');
  });
});

/**
 * The one deliberate hole in the rule, measured rather than assumed.
 *
 * A component's rendered box is not knowable from the AST, so the rewrite
 * ignores component children of a `<p>` — which is only safe while the
 * components agents actually put there render as phrasing content. On
 * production that is exactly one component, `<Number>`, appearing 19 times
 * across two documents (`<p>up <Number data="$q" /> today</p>`). Treating
 * components as block would have rewritten all 19 paragraphs for nothing.
 *
 * So the claim "`<Number>` renders inline" is load-bearing, and it is checked
 * here against the real renderer instead of taken from reading its source.
 */
describe('a component inside a paragraph — the case the rule steps around', () => {
  it('<Number> renders as phrasing content, so leaving the <p> alone is correct', async () => {
    const html = await serve('<Helmet><Value name="q" type="table" value={[{"n":1}]} /></Helmet>'
      + '<div><p className="lede">up <Number data="$q" col="n" /> today</p></div>');
    expect(reparented(html)).toEqual([]);
    // Still a paragraph — the rewrite did not fire…
    expect(html).toMatch(/<p[^>]*class="[^"]*lede/);
    const { document } = new JSDOM(html).window;
    // …and the reason it did not have to: what the component renders is inline,
    // so the parser keeps it where React put it.
    const num = document.querySelector('[aria-label="Live number"], [aria-label="Number placeholder"]')!;
    expect(num.tagName.toLowerCase()).toBe('span');
    expect(num.closest('p')).not.toBeNull();
  });

  it('is why component children are ignored: a block one would still be a fault', async () => {
    /*
     * Stated, not hidden. `<Card>` renders a div, so a `<p>` holding one is
     * still re-parented — the rule does not claim to catch it, and no
     * production document does it. If one ever does, THIS test is where the
     * decision gets revisited, with the failure written down rather than
     * discovered in a screenshot.
     */
    const html = await serve('<div><p className="x"><Card><CardContent>c</CardContent></Card></p></div>');
    expect(reparented(html).length).toBeGreaterThan(0);
  });
});
