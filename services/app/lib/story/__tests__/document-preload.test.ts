/**
 * What a document asks for BEFORE it has parsed the runtime.
 *
 * The chain this removes, measured against production over a 235 ms link: the
 * document arrives, and only then is the runtime discovered; only once the
 * runtime has downloaded and parsed is its lazy chart chunk discovered. Three
 * requests, each waiting on the last, the chart chunk starting at ~2.9 s and
 * taking another 3.7 s cold — which is the whole of "loading chart…".
 *
 * The document already knows both URLs at render time (lib/story/runtime-asset
 * reads them from the build's manifest), so it names them in its own head and
 * the browser fetches them alongside everything else.
 *
 * The precision matters in both directions. `crossorigin` must match the
 * script's, or the preload is a second request rather than the same one — this
 * frame has an OPAQUE origin, so its module fetches are cross-origin. And the
 * chart chunk must be asked for ONLY by documents that draw a chart, or code
 * splitting stops meaning anything and every prose document pays ~830 KB.
 */
import { describe, expect, it } from 'vitest';
import { buildStoryDocument, type StoryDocumentInput } from '@/lib/story/document';

const RUNTIME = '/story/entry-TESTHASH.js';
const CHART = '/story/chunks/VegaChart-TESTHASH.js';

const doc = (over: Partial<StoryDocumentInput> = {}): Promise<string> =>
  buildStoryDocument({
    source: '<h1>Hello</h1><Card><CardContent>inside</CardContent></Card>',
    compiledCss: null, theme: null, colorMode: null, refData: {},
    title: 'T', runtimeSrc: RUNTIME, lazyChunks: [CHART],
    ...over,
  });

const head = (html: string): string => html.slice(0, html.indexOf('</head>'));
const preloads = (html: string): string[] =>
  [...head(html).matchAll(/<link rel="modulepreload" href="([^"]+)" crossorigin>/g)].map((m) => m[1]);

const CHART_Q = '<Question data="$q" viz={{"kind":"vega-lite","spec":{"mark":"bar"}}} />';

describe('the runtime is preloaded', () => {
  it('is asked for in the head, crossorigin, exactly once', async () => {
    const html = await doc();
    expect(preloads(html)).toEqual([RUNTIME]);
    // The same URL the script tag uses, or the browser makes two requests.
    expect(html).toContain(`<script type="module" src="${RUNTIME}" crossorigin></script>`);
  });

  it('comes after the fonts, which block the text a reader is waiting on', async () => {
    const h = await doc({ theme: 'modernist' });
    expect(h.indexOf('as="font"')).toBeLessThan(h.indexOf('rel="modulepreload"'));
  });

  it('is omitted when the document does not hydrate', async () => {
    // Prose with no components and no data has no runtime — preloading one
    // would download a megabyte nothing will ever execute.
    expect(preloads(await doc({ source: '<h1>Just words</h1>' }))).toEqual([]);
  });

  it('is omitted when there is no runtime to point at', async () => {
    expect(preloads(await doc({ runtimeSrc: null }))).toEqual([]);
  });
});

describe('the chart chunk is preloaded only by documents that draw one', () => {
  it('is asked for by a vega-lite question', async () => {
    expect(preloads(await doc({ source: CHART_Q }))).toEqual([RUNTIME, CHART]);
  });

  it('is asked for by vega and recipe questions too', async () => {
    for (const kind of ['vega', 'recipe']) {
      const src = `<Question data="$q" viz={{"kind":"${kind}"}} />`;
      expect(preloads(await doc({ source: src })), kind).toContain(CHART);
    }
  });

  it('is NOT asked for by a question that renders as a table or a single value', async () => {
    // Those branches never reach the lazy import — see QuestionEmbed.
    for (const kind of ['table', 'single_value']) {
      const src = `<Question data="$q" viz={{"kind":"${kind}"}} />`;
      expect(preloads(await doc({ source: src })), kind).toEqual([RUNTIME]);
    }
  });

  it('is NOT asked for by a question with no viz at all — that renders as a table', async () => {
    expect(preloads(await doc({ source: '<Question data="$q" />' }))).toEqual([RUNTIME]);
  });

  it('is NOT asked for by DataTable, Number, or the rest of the kit', async () => {
    for (const src of ['<DataTable data="$q" />', '<Number data="$q" col="n" />', '<Card><CardContent>x</CardContent></Card>']) {
      expect(preloads(await doc({ source: src })), src).toEqual([RUNTIME]);
    }
  });

  it('finds a chart nested anywhere in the document', async () => {
    const src = `<div><section><Card><CardContent>${CHART_Q}</CardContent></Card></section></div>`;
    expect(preloads(await doc({ source: src }))).toContain(CHART);
  });

  it('is omitted when the build reports no lazy chunks', async () => {
    expect(preloads(await doc({ source: CHART_Q, lazyChunks: [] }))).toEqual([RUNTIME]);
    expect(preloads(await doc({ source: CHART_Q, lazyChunks: null }))).toEqual([RUNTIME]);
  });

  it('is omitted when the document does not hydrate at all', async () => {
    expect(preloads(await doc({ source: CHART_Q, runtimeSrc: null }))).toEqual([]);
  });
});

describe('the chart walk, at its edges', () => {
  it('finds a chart inside a slide deck', async () => {
    const src = `<SlideDeck><Slide><h1>One</h1></Slide><Slide>${CHART_Q}</Slide></SlideDeck>`;
    expect(preloads(await doc({ source: src }))).toContain(CHART);
  });

  it('ignores a viz whose value is not a static object', async () => {
    // `viz={someExpr}` never publishes, and an array is not a viz — neither
    // may be read as `{kind}` or the walk throws on a served document.
    for (const src of ['<Question data="$q" viz={[1,2]} />', '<Question data="$q" viz="chart" />']) {
      expect(preloads(await doc({ source: src })), src).toEqual([RUNTIME]);
    }
  });

  it('preloads once even when a document draws many charts', async () => {
    const src = `<div>${CHART_Q}${CHART_Q}${CHART_Q}</div>`;
    expect(preloads(await doc({ source: src }))).toEqual([RUNTIME, CHART]);
  });

  it('still preloads for a chrome-less render — the exporter loads the same chunk', async () => {
    expect(preloads(await doc({ source: CHART_Q, chrome: false }))).toEqual([RUNTIME, CHART]);
  });

  it('a data-declaring document with no components still preloads the runtime', async () => {
    /*
     * `<Value>`-bound native controls are live only with the store behind them,
     * so such a document hydrates with no component in the body at all — and
     * the runtime it needs must be preloaded like any other. The dataflow is an
     * INPUT (the route resolves it per row), which is what `hydrates` reads.
     */
    const src = '<Helmet><Value name="n" type="number" default={1} /></Helmet><input value="$n" />';
    const dataflow = {
      flow: { values: [{ kind: 'scalar' as const, name: 'n', type: 'number' as const, default: 1, start: 0, end: 0 }], queries: [] },
      state: { values: { n: 1 }, tables: {}, errors: {} },
    };
    expect(preloads(await doc({ source: src, dataflow }))).toEqual([RUNTIME]);
    // …and it is not a chart, so the chart chunk stays out of it.
    expect(preloads(await doc({ source: src, dataflow }))).not.toContain(CHART);
  });
});

/*
 * SPIKE S4 (B1 — the mobile bar stays put while the page is loading, risk R2).
 *
 * The anchor module is the one script EVERY document ships, and it owns the
 * reader's own chrome: the scroll relay that hides and shows the phone bar, the
 * outline's clicks, the scroll-marked tables. It was emitted LAST and was not
 * preloaded, and a module script without `async` executes IN ORDER with the
 * module scripts before it — so on a chart document it waited for the entire
 * runtime to download and evaluate before the bar would answer a scroll at all.
 *
 * `async` frees it from that queue and `modulepreload` starts its ~8 KB with
 * the styles instead of after them. Unconditional, unlike the runtime's:
 * keeping the reader's place is not a feature of documents that happen to
 * hydrate, so the document that gains most is the prose one that ships nothing
 * else.
 */
const ANCHOR = '/story/anchor-TESTHASH.js';

describe('the anchor module — every document ships it (spike S4)', () => {
  it('is preloaded, and FIRST: the reader chrome must not queue behind a megabyte', async () => {
    const html = await doc({ anchorSrc: ANCHOR });
    expect(preloads(html)).toEqual([ANCHOR, RUNTIME]);
  });

  it('is preloaded by a document that hydrates nothing at all', async () => {
    expect(preloads(await doc({ source: '<h1>Just words</h1>', anchorSrc: ANCHOR }))).toEqual([ANCHOR]);
  });

  it('is async, so it does not execute in the runtime entry\'s queue', async () => {
    const html = await doc({ source: CHART_Q, anchorSrc: ANCHOR });
    expect(html).toContain(`<script type="module" src="${ANCHOR}" crossorigin async></script>`);
    // The runtime entry is NOT async: it is code-split and its own lazy imports
    // are ordered against it, and nothing waits behind it that a reader feels.
    expect(html).toContain(`<script type="module" src="${RUNTIME}" crossorigin></script>`);
  });

  it('is still emitted after the island, so the tag it needs is already parsed', async () => {
    const html = await doc({ source: CHART_Q, anchorSrc: ANCHOR });
    expect(html.indexOf('application/json')).toBeLessThan(html.indexOf(`src="${ANCHOR}"`));
  });

  it('preloads nothing extra when there is no anchor module to point at', async () => {
    expect(preloads(await doc({ anchorSrc: null }))).toEqual([RUNTIME]);
  });
});
