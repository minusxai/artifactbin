/**
 * The claim behind lib/document/nesting.ts, tested over the thing that actually
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
import { compiledDocument } from '@/lib/compiled-page/__tests__/document-helper';
import { compiledSource } from '@/test/helpers/compiled';

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
  compiledDocument({
    source, compiledCss: null, theme: null, colorMode: null, refData: {},
    title: 'nesting',
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
  it('keeps legacy direct list nesting in the same hierarchy as the editor', async () => {
    const html = await serve('<ol id="list"><li id="outer"><li id="child"><p>B</p></li><li id="empty"><p></p></li></li></ol>');
    expect(reparented(html)).toEqual([]);
    const { document } = new JSDOM(html).window;
    expect(document.querySelector('#outer > ol > #child')).not.toBeNull();
    expect(document.querySelector('#outer > ol > #empty')).not.toBeNull();
    expect(document.querySelector('li > li')).toBeNull();
  });
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
 * The tag list in lib/document/nesting.ts is the HTML parser's own — quoted from
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
    const { STORY_HTML_TAGS } = await import('@/lib/jsx/component-names');
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
 * A component inside a paragraph. What a registered component renders is a fact of the kit, so the rule
 * reads it from one declaration (lib/jsx/component-names PHRASING_COMPONENTS) instead of stepping around
 * every component: a phrasing one (`<Number>`, `<Badge>`, a `<Tooltip>` on a word) leaves the paragraph
 * alone, and anything else — a block kit component, a script component's mount, a `<For>`'s wrapper —
 * makes the `<p>` a `<div>`, the same repair `<p><div>` gets.
 */
describe('a component inside a paragraph', () => {
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

  it('<For> is not opaque: its wrapper is a <div>, so a paragraph holding one is rewritten', async () => {
    /*
     * The scrolly document behind the pi eval's #418 (run 36290939455): a
     * headline figure written as `<p className="text-5xl"><For>…</For></p>`.
     * The interpreter renders every non-table <For> into a wrapper <div>, so
     * the parser closed the paragraph and React threw the server tree away.
     */
    const html = await serve('<Helmet><Value name="fastest" type="table" value={[{"mode":"Bicycle","m":29}]} /></Helmet>'
      + '<div><p className="lede text-5xl"><For each={$fastest}>{$_row.mode} · <Number data="$fastest" col="m" /> min</For></p></div>');
    expect(reparented(html)).toEqual([]);
    const { document } = new JSDOM(html).window;
    const holder = document.querySelector('[class*="lede"]')!;
    expect(holder.tagName.toLowerCase()).toBe('div');
    // The rows' wrapper stays inside the element carrying the headline classes.
    expect(holder.querySelector(':scope > [data-mx-ast="0.0.0"]')).not.toBeNull();
  });

  it('rewrites a paragraph holding a block component, so the parser moves nothing', async () => {
    const html = await serve('<div><p className="x"><Card><CardContent>c</CardContent></Card></p></div>');
    expect(reparented(html)).toEqual([]);
    const { document } = new JSDOM(html).window;
    expect(document.querySelector('.x')!.tagName.toLowerCase()).toBe('div');
    expect(document.querySelector('.x [data-slot="card"]')).not.toBeNull();
  });

  it('keeps a Tooltip on a word inside its paragraph, every node of it where it was rendered (the blank-page report)', async () => {
    const html = await serve('<div data-design="tw"><h1 id="headline">Static headline must render</h1>'
      + '<p id="lead">Before <Tooltip><TooltipTrigger className="underline">medium</TooltipTrigger><TooltipContent>Explanation here.</TooltipContent></Tooltip> after.</p>'
      + '<p id="second">Another static paragraph that must render.</p></div>');
    const { document } = new JSDOM(html).window;
    const lead = document.getElementById('lead')!;
    // Still the author's paragraph, and the parser closed it nowhere: the trigger, the served content and the
    // text after the tooltip are all inside it, and no stray empty paragraph follows.
    expect(lead.tagName.toLowerCase()).toBe('p');
    expect(lead.querySelector('[data-slot="tooltip-trigger"]')?.textContent).toBe('medium');
    expect(lead.querySelector('[role="tooltip"]')?.textContent).toContain('Explanation here.');
    expect(lead.textContent).toMatch(/^Before medium.*after\.$/s);
    expect(document.querySelectorAll('p')).toHaveLength(2);
    expect(document.getElementById('headline')?.textContent).toBe('Static headline must render');
    expect(document.getElementById('second')?.textContent).toBe('Another static paragraph that must render.');
  });
});

/**
 * The declaration is checked against the real renderer and a real parser, two-sided, the way the tag list is above:
 * every registered component is served in a `<div>` (where nothing closes) and in a `<p>`. If its rendered markup,
 * put in a paragraph, closes it, the rule must rewrite that paragraph; if not, it must leave it alone. One document
 * serves every case. Components that need a parent are served inside the smallest one that gives them their context.
 */
const SWEEP_HELMET = '<Helmet><Value name="q" type="table" value={[{"n":1,"label":"a"}]} /><Value name="s" type="string" default="a" />'
  + '<Value name="num" type="number" default={1} /><Value name="flag" type="boolean" default={false} /><Value name="day" type="date" default="2026-01-01" /><Value name="on" type="boolean" default={true} /></Helmet>';
const SWEEP: Record<string, string> = {
  Badge: '<Badge>b</Badge>',
  Icon: '<Icon name="check" />',
  Number: '<Number data="$q" col="n" />',
  Button: '<Button>go</Button>',
  RunButton: '<Button set={{"s":"b"}}>set</Button>',
  Tooltip: '<TooltipProvider><Tooltip><TooltipTrigger>t</TooltipTrigger><TooltipContent>tip</TooltipContent></Tooltip></TooltipProvider>',
  TooltipTrigger: '<Tooltip><TooltipTrigger>t</TooltipTrigger></Tooltip>',
  Avatar: '<Avatar><AvatarImage src="https://example.com/a.png" alt="a" /><AvatarFallback>AB</AvatarFallback><AvatarBadge /></Avatar>',
  AvatarGroup: '<AvatarGroup><Avatar><AvatarFallback>A</AvatarFallback></Avatar><AvatarGroupCount>+1</AvatarGroupCount></AvatarGroup>',
  User: '<User userId="$_me.id" fallback="a guest" />',
  UserImage: '<UserImage userId="$_me.id" fallback="no picture" />',
  UserHandle: '<UserHandle userId="$_me.id" fallback="no handle" />',
  SignIn: '<SignIn>Sign in</SignIn>',
  Alert: '<Alert><AlertTitle>t</AlertTitle><AlertDescription>d</AlertDescription></Alert>',
  AlertTitle: '<AlertTitle>t</AlertTitle>',
  AlertDescription: '<AlertDescription>d</AlertDescription>',
  Progress: '<Progress value={30} />',
  Separator: '<Separator />',
  Skeleton: '<Skeleton className="h-4 w-8" />',
  Card: '<Card><CardHeader><CardTitle>t</CardTitle><CardDescription>d</CardDescription><CardAction>a</CardAction></CardHeader><CardContent>c</CardContent><CardFooter>f</CardFooter></Card>',
  CardTitle: '<CardTitle>t</CardTitle>',
  Table: '<Table><TableCaption>c</TableCaption><TableHeader><TableRow><TableHead>h</TableHead></TableRow></TableHeader><TableBody><TableRow><TableCell>1</TableCell></TableRow></TableBody><TableFooter><TableRow><TableCell>f</TableCell></TableRow></TableFooter></Table>',
  Breadcrumb: '<Breadcrumb><BreadcrumbList><BreadcrumbItem><BreadcrumbLink href="#a">a</BreadcrumbLink></BreadcrumbItem><BreadcrumbSeparator /><BreadcrumbItem><BreadcrumbEllipsis /></BreadcrumbItem><BreadcrumbItem><BreadcrumbPage>p</BreadcrumbPage></BreadcrumbItem></BreadcrumbList></Breadcrumb>',
  Tabs: '<Tabs defaultValue="one"><TabsList><TabsTrigger value="one">One</TabsTrigger></TabsList><TabsContent value="one">pane</TabsContent></Tabs>',
  Accordion: '<Accordion type="single" collapsible><AccordionItem value="a"><AccordionTrigger>A</AccordionTrigger><AccordionContent>open</AccordionContent></AccordionItem></Accordion>',
  Collapsible: '<Collapsible><CollapsibleTrigger>more</CollapsibleTrigger><CollapsibleContent>details</CollapsibleContent></Collapsible>',
  Popover: '<Popover><PopoverAnchor /><PopoverTrigger>open</PopoverTrigger><PopoverContent><PopoverHeader><PopoverTitle>t</PopoverTitle><PopoverDescription>d</PopoverDescription></PopoverHeader></PopoverContent></Popover>',
  PopoverTrigger: '<Popover><PopoverTrigger>open</PopoverTrigger></Popover>',
  Dialog: '<Dialog><DialogTrigger>open</DialogTrigger><DialogContent aria-label="d">body<DialogClose>close</DialogClose></DialogContent></Dialog>',
  DialogTrigger: '<Dialog><DialogTrigger>open</DialogTrigger></Dialog>',
  Input: '<Input label="Title" value="$s" />',
  Textarea: '<Textarea label="Note" value="$s" rows={2} />',
  Select: '<Select label="Pick" value="$s" options={["a","b"]} />',
  Segmented: '<Segmented label="Seg" value="$s" options={["a","b"]} />',
  Slider: '<Slider label="Min" value="$num" min={0} max={10} />',
  Switch: '<Switch label="On" checked="$flag" />',
  DatePicker: '<DatePicker label="Since" value="$day" />',
  FileUpload: '<FileUpload dataset="q" value="$s" busy="$flag" label="Files" />',
  Question: '<Question title="Chart" data="$q" viz={{"kind":"vega-lite","spec":{"mark":"bar","encoding":{"x":{"field":"label","type":"nominal"},"y":{"field":"n","type":"quantitative"}}}}} />',
  DataTable: '<DataTable data="$q"><Column col="n" title="N" /></DataTable>',
  Files: '<Files data="$q" />',
  Mermaid: '<Mermaid code="flowchart LR; A --> B" />',
  DeckGL: '<DeckGL data="$q" basemap="none" layers={[]} />',
  Isometric: '<Isometric parts={[]} width={100} height={80} />',
  File: '<File src="https://example.com/a.pdf" />',
  Markdown: '<Markdown>{`**bold**`}</Markdown>',
  Grid: '<Grid><GridItem x={0} y={0} w={4} h={1}>cell</GridItem></Grid>',
  For: '<For each={$q}>{$_row.label}</For>',
  ScriptComponent: '<Sparkline points="$q">fallback</Sparkline>',
  // A condition draws no box of its own: what it shows decides (served true here, so the parser sees it).
  Condition: '{$on && <div>shown</div>}',
  InlineCondition: '{$on && <b>shown</b>}',
};

/** A deck makes the whole document a deck, so its case is served on its own. */
const SWEEP_ALONE: Record<string, string> = {
  SlideDeck: '<SlideDeck><Slide title="One">s</Slide></SlideDeck>',
};

describe('which components close a paragraph is the renderer\'s answer, not a guess', () => {
  const scratch = new JSDOM('<!DOCTYPE html><body></body>').window.document;
  const count = (parent: string, inner: string): number => {
    scratch.body.innerHTML = `<${parent} id="host">${inner}</${parent}>`;
    return scratch.querySelectorAll('#host *').length;
  };
  /** Per case: does the parser close a paragraph around its rendered markup, and did the rule rewrite it? */
  const verdicts = async (cases: Array<[string, string]>) => {
    const body = cases.map(([, markup], i) => `<section id="case-${i}"><div id="probe-${i}">x${markup}y</div><p id="lead-${i}">x${markup}y</p></section>`).join('');
    const source = `${SWEEP_HELMET}<div>${body}</div>`;
    // Served as a reader gets it, with the declared values in force (the condition shows its branch).
    const html = await compiledDocument({
      source, compiledCss: null, theme: null, colorMode: null, refData: {}, title: 'sweep',
      dataflow: { flow: await compiledSource(source), state: { values: { on: true }, tables: {}, errors: {} } },
    });
    const served = new JSDOM(html).window.document;
    return cases.map(([name], i) => {
      const inner = served.getElementById(`probe-${i}`)!.innerHTML;
      return { name, closes: count('p', inner) !== count('div', inner), rewrote: served.getElementById(`lead-${i}`)!.tagName.toLowerCase() !== 'p' };
    });
  };

  it('rewrites for exactly the components whose rendered markup a paragraph cannot hold', async () => {
    const all = [
      ...await verdicts(Object.entries(SWEEP)),
      ...(await Promise.all(Object.entries(SWEEP_ALONE).map((entry) => verdicts([entry])))).flat(),
    ];
    const wrong = all.filter((v) => v.closes !== v.rewrote).map((v) => `${v.name}: the parser closes the p=${v.closes}, we rewrite=${v.rewrote}`);
    expect(wrong).toEqual([]);
    // Both sides of the rule are exercised: a sweep that agreed on "never" or "always" proves nothing.
    expect(all.filter((v) => v.closes).length).toBeGreaterThan(10);
    expect(all.filter((v) => !v.closes).length).toBeGreaterThan(5);
  });

  it('serves every registered component in the sweep', async () => {
    const { STORY_UI_COMPONENT_NAME_LIST, PHRASING_COMPONENTS } = await import('@/lib/jsx/component-names');
    const swept = [...Object.values(SWEEP), ...Object.values(SWEEP_ALONE)].join('');
    const missing = STORY_UI_COMPONENT_NAME_LIST.filter((tag) => tag !== 'Column' && !new RegExp(`<${tag}[\\s/>]`).test(swept));
    expect(missing).toEqual([]);
    expect([...PHRASING_COMPONENTS].filter((tag) => !new RegExp(`<${tag}[\\s/>]`).test(swept))).toEqual([]);
  });
});

/**
 * `<For>` inside `<svg>`. Its wrapper is a `<div>` everywhere else, and inside
 * SVG that is foreign content the parser breaks OUT of: the `<div>` closes the
 * `<svg>`, and the rows it held become HTML-namespace elements that draw
 * nothing — while React's client tree keeps them inside the SVG. #418 again, so
 * in SVG the wrapper is a `<g>`, which groups the shapes and parses back as
 * written.
 */
describe('a <For> of shapes inside <svg>', () => {
  const SVG_NS = 'http://www.w3.org/2000/svg';
  // The rows arrive as the query's answer, the way a served document gets them:
  // a declaration alone serves the template with nothing to repeat.
  const bars = async (rows: Record<string, unknown>[]): Promise<string> => {
    const columns = [{ name: 'k', type: 'string' as const }, { name: 'x', type: 'number' as const }, { name: 'h', type: 'number' as const }];
    const source = `<Helmet><Value name="bars" type="table" value={[]} columns={${JSON.stringify(columns)}} /></Helmet>`
      + '<div><svg viewBox="0 0 30 10"><For id="bars" each={$bars} keyBy="k" className="text-primary">'
      + '<rect x="$_row.x" y="0" width="8" height="$_row.h" fill="currentColor" /></For></svg></div>';
    return compiledDocument({
      source, compiledCss: null, theme: null, colorMode: null, refData: {},
      title: 'bars',
      dataflow: { flow: await compiledSource(source), state: { values: {}, tables: { bars: { rows, columns } }, errors: {} } },
    });
  };

  it('parses back as the tree it was rendered from, every bar an SVG element inside the svg', async () => {
    const html = await bars([{ k: 'a', x: 0, h: 4 }, { k: 'b', x: 10, h: 7 }, { k: 'c', x: 20, h: 2 }]);
    expect(reparented(html)).toEqual([]);
    const { document } = new JSDOM(html).window;
    const rects = [...document.querySelectorAll('rect')];
    expect(rects.map((r) => r.getAttribute('height'))).toEqual(['4', '7', '2']);
    for (const rect of rects) {
      expect(rect.namespaceURI).toBe(SVG_NS);
      expect(rect.closest('svg')).not.toBeNull();
    }
    const group = rects[0].parentElement!;
    expect(group.tagName).toBe('g');
    expect(group.id).toBe('bars');
    expect(group.getAttribute('class')).toContain('text-primary');
  });

  it('keeps a row-data error inside the svg too', async () => {
    // Duplicate keys are a property of the rows, not the markup, so no publish
    // check can catch them: the refusal the interpreter draws must itself parse back.
    const html = await bars([{ k: 'a', x: 0, h: 4 }, { k: 'a', x: 10, h: 7 }]);
    expect(reparented(html)).toEqual([]);
    const { document } = new JSDOM(html).window;
    const alert = document.querySelector('[role="alert"]')!;
    expect(alert.textContent).toContain('duplicate');
    expect(alert.namespaceURI).toBe(SVG_NS);
  });
});
