/**
 * Product-side truth for a run, read from what the product SERVES (the driver
 * never holds the agent's token — the start link handed it to the agent).
 */
import { describe, it, expect } from 'vitest';
import { artifactIdFromText, dataflowRows, productMetrics, titleOf, usesIframe } from '../lib/score/product';

const served = (html: string, status = 200) => ({ status, html });

describe('titleOf', () => {
  it('reads the document <title>, decoded', () => {
    expect(titleOf('<html><head><title>Coffee &amp; cups — Q2</title></head></html>')).toBe('Coffee & cups — Q2');
    expect(titleOf('<html><head></head></html>')).toBeNull();
  });
  /**
   * CodeQL js/double-escaping (high): unescaping `&amp;` before the others turns
   * `&amp;lt;` into `&lt;` into `<` — text the author wrote as literal markup
   * comes back as markup. A meta-character must be unescaped LAST, or, as here,
   * everything must be unescaped in one pass so a decoded `&` is never re-read.
   */
  const title = (raw: string) => titleOf(`<title>${raw}</title>`);

  it('does not double-unescape an escaped ampersand', () => {
    expect(title('&amp;lt;script&amp;gt;')).toBe('&lt;script&gt;');
    expect(title('Tom &amp;amp; Jerry')).toBe('Tom &amp; Jerry');
  });

  it('decodes the named entities the product emits', () => {
    expect(title('Coffee &amp; cups')).toBe('Coffee & cups');
    expect(title('&lt;b&gt; &quot;q&quot; &#39;a&#39;')).toBe('<b> "q" \'a\'');
  });

  it('decodes numeric and hex references, and leaves an unknown entity alone', () => {
    expect(title('&#8212;dash &#x2014;dash')).toBe('—dash —dash');
    expect(title('50&nbsp;% &notanentity;')).toBe('50\u00a0% &notanentity;');
  });
});

describe('productMetrics', () => {
  it('published needs a served document with content that is no longer the start document', () => {
    const m = productMetrics({ served: served('<html><head><title>Hi</title></head><body><main><h1>Hi</h1><p>x</p></main></body></html>'), baseline: served('<html><body><h1>Untitled</h1></body></html>') });
    expect(m.published).toBe(true);
    expect(m.hasTitle).toBe(true);
    expect(m.title).toBe('Hi');
  });
  it('an untouched start document is not published even though it serves', () => {
    expect(productMetrics({ served: served('<html><head><title></title></head><body></body></html>'), baseline: null }).published).toBe(false);
  });
  it('a 404 is not published and has no title', () => {
    const m = productMetrics({ served: served('', 404), baseline: null });
    expect(m.published).toBe(false);
    expect(m.hasTitle).toBe(false);
    expect(m.title).toBeNull();
  });
  it('a title that is only the product default or whitespace does not count', () => {
    expect(productMetrics({ served: served('<title>  </title><body><p>x</p></body>'), baseline: null }).hasTitle).toBe(false);
    expect(productMetrics({ served: served('<title>Untitled</title><body><p>x</p></body>'), baseline: null }).hasTitle).toBe(false);
  });
  const START = served('<html><head><title>artifact</title></head><body><div id="mx-story-root"><h1>Untitled</h1><p>Waiting for your agent…</p></div></body></html>');
  const WRITTEN = served('<html><head><title>Release notes — v2.4</title></head><body><h1>v2.4</h1><p>Shipped.</p></body></html>');

  it('is TRUE for a document that changed, even when the driver observed no HTTP traffic at all', () => {
    // Codex reached artifactbin.dev through OpenAI's own server-side browsing tool, so the local
    // proxy recorded nothing. Whether we could watch the call is not evidence about the document.
    expect(productMetrics({ served: WRITTEN, baseline: START }).published).toBe(true);
  });

  it('is FALSE when the served document is still the start document — which HAS content of its own', () => {
    expect(productMetrics({ served: START, baseline: START }).published).toBe(false);
  });

  it('is FALSE when the document does not serve', () => {
    expect(productMetrics({ served: served('', 404), baseline: START }).published).toBe(false);
  });

  it('falls back to "has real content" when there is no baseline to compare against', () => {
    expect(productMetrics({ served: WRITTEN, baseline: null }).published).toBe(true);
    expect(productMetrics({ served: served('<html><body></body></html>'), baseline: null }).published).toBe(false);
  });
});

describe('dataflowRows', () => {
  /**
   * The island shape below is copied from a REAL served document (a dataset + a
   * `<Query>` over it). An earlier fixture guessed `dataflow.tables` instead of
   * `dataflow.state.tables`; the test passed and the function returned 0 for two
   * documents whose queries had run perfectly. A fixture for a shape the product
   * owns has to come from the product.
   */
  const island = (dataflow: unknown) =>
    `<html><body><script type="application/json" id="mx-story-data">${JSON.stringify({ nodes: [], refData: {}, dataflow, colorMode: 'light', chrome: true })}</script></body></html>`;

  const REAL = {
    flow: { values: [], queries: [{ name: 'sales', sql: 'select month, revenue from ref_VzgxeW order by month', params: [], refs: ['VzgxeW'], start: 28, end: 112 }] },
    state: {
      values: {},
      tables: { sales: { rows: [{ month: '2026-01', revenue: 10 }, { month: '2026-02', revenue: 20 }], columns: [{ name: 'month', type: 'string' }, { name: 'revenue', type: 'number' }] } },
      errors: {},
    },
  };

  it('counts the rows the SERVER produced, from `dataflow.state.tables`', () => {
    expect(dataflowRows(island(REAL))).toBe(2);
  });

  it('is 0 for a document with no data, and for one whose query errored', () => {
    expect(dataflowRows('<html><body><h1>prose</h1></body></html>')).toBe(0);
    expect(dataflowRows(island({ flow: REAL.flow, state: { values: {}, tables: {}, errors: { sales: 'Binder Error: no such column' } } }))).toBe(0);
    expect(dataflowRows(island({ flow: REAL.flow, state: { values: {}, tables: { sales: { rows: [], columns: [] } }, errors: {} } }))).toBe(0);
  });

  it('survives an island that is missing, malformed, or escaped', () => {
    expect(dataflowRows('<script type="application/json" id="mx-story-data">not json</script>')).toBe(0);
    // The product escapes `<` in the island as \u003c; JSON.parse restores it.
    const rows = { flow: REAL.flow, state: { values: {}, errors: {}, tables: { q: { rows: [{ a: '\u003cb\u003e' }], columns: [] } } } };
    const escaped = `<script type="application/json" id="mx-story-data">${JSON.stringify({ dataflow: rows }).replace(/</g, '\\u003c')}</script>`;
    expect(dataflowRows(escaped)).toBe(1);
  });
});



describe('artifactIdFromText', () => {
  it('reads the id out of the URL an agent reports, so we score what it says it made', () => {
    expect(artifactIdFromText('https://artifactbin.dev/a/K8a1Dg')).toBe('K8a1Dg');
    expect(artifactIdFromText('Published: https://artifactbin.dev/a/K8a1Dg — done')).toBe('K8a1Dg');
    expect(artifactIdFromText('http://127.0.0.1:3101/a/abc123/raw?chrome=0')).toBe('abc123');
    expect(artifactIdFromText('https://artifactbin.dev/@me/notes/K8a1Dg-release-notes')).toBe('K8a1Dg');
  });

  it('is null when there is no artifact URL', () => {
    expect(artifactIdFromText('Unable to publish: the link is inaccessible.')).toBeNull();
    expect(artifactIdFromText('')).toBeNull();
  });

  it('takes the LAST url named — an agent lists what it tried and ends with the deliverable', () => {
    expect(artifactIdFromText('Drafted https://artifactbin.dev/a/AAAAA1 first; the final version is https://artifactbin.dev/a/BBBBB2.')).toBe('BBBBB2');
    expect(artifactIdFromText('See https://artifactbin.dev/@me/x/AAAAA1-old, superseded by https://artifactbin.dev/a/BBBBB2')).toBe('BBBBB2');
    expect(artifactIdFromText('https://artifactbin.dev/a/AAAAA1 then https://artifactbin.dev/@me/x/BBBBB2-final')).toBe('BBBBB2');
  });

});

/**
 * `<Iframe>` IS THE ESCAPE HATCH. An agent that cannot make the document's own components do
 * something reaches for a managed frame and writes raw HTML inside it; we want native markup,
 * so we measure the reach before we ask anyone to stop.
 *
 * Read from what the product SERVES, like every other product metric — and therefore NOT from
 * the literal tag. `/a/<id>/raw` is the SSR'd document, not its source (services/app/__tests__/
 * raw-document.test.ts), and `lib/story-ui/registry.ts` renders `<Iframe>` as a
 * `div[data-mx-managed-frame]`. A case-sensitive `<Iframe` over the served HTML is a constant
 * true; the marker the renderer emits is the evidence that survives.
 */
describe('usesIframe / no_iframe', () => {
  const FRAME = '<div id="n3" data-mx-managed-frame="" aria-label="Managed frame: Demo" style="height:450px;width:100%"><div style="height:100%"></div></div>';

  it('sees the managed-frame marker the renderer emits for <Iframe>', () => {
    expect(usesIframe(`<html><body><h1>Demo</h1>${FRAME}</body></html>`)).toBe(true);
  });

  it('sees the component in the story island even when the marker is not in the body', () => {
    const island = JSON.stringify({ nodes: [{ type: 'element', tag: 'Iframe', isComponent: true, attributes: [], children: [], selfClosing: true, start: 0, end: 9 }] });
    expect(usesIframe(`<html><body><script type="application/json" id="mx-story-data">${island}</script></body></html>`)).toBe(true);
  });

  it('sees a literal <Iframe tag, for a response that does carry source', () => {
    expect(usesIframe('<Iframe src="https://example.test" height={400} />')).toBe(true);
  });

  it('is false for a document written in native markup — and not fooled by the word alone', () => {
    expect(usesIframe('<html><body><h1>Q3</h1><table><tr><td>1</td></tr></table><p>No frames here.</p></body></html>')).toBe(false);
    // Prose ABOUT the component, a lowercase browser iframe of the reader chrome, and a longer tag.
    expect(usesIframe('<p>We considered Iframe embeds and rejected them.</p><iframe title="chrome"></iframe><IframeGallery />')).toBe(false);
  });

  /**
   * The fixture is the SHAPE THE PRODUCT SERVES: `lib/story/document.ts` puts every document
   * inside `<body data-mx-story-root><div id="mx-story-root">`. Judging a hand-written page that
   * carries neither is judging something the scorer never receives.
   */
  const document_ = (body: string, title = 'Q3') =>
    served(`<html><head><title>${title}</title></head><body data-mx-story-root><div id="mx-story-root">${body}</div></body></html>`);

  it('answers true for a published document in native markup, false for one that framed', () => {
    expect(productMetrics({ served: document_('<h1>Q3</h1><p>Native.</p>'), baseline: null }).noIframe).toBe(true);
    expect(productMetrics({ served: document_(`<h1>Q3</h1>${FRAME}`), baseline: null }).noIframe).toBe(false);
  });

  it('is null when nothing was published — an unwritten document is not a clean one', () => {
    expect(productMetrics({ served: served('', 404), baseline: null }).noIframe).toBeNull();
    expect(productMetrics({ served: served('<html><body></body></html>'), baseline: null }).noIframe).toBeNull();
  });

  /**
   * REGRESSION, live leg run `local21` (pi, tracker task): the agent created its dataset and never
   * wrote the document, so the artifact the scorer fetched was the DATASET — and `/a/<id>/raw`
   * answers a dataset with its ROWS AS JSON, not with a document
   * (`services/app/app/a/[id]/raw/route.ts`, `case 'dataset'`). There is no document markup to
   * inspect, so the only honest answer is null; the run recorded `no_iframe: false`, which reads
   * as "the agent used an Iframe" about a document that was never written.
   */
  it('is null when the scored artifact is a dataset, whatever its rows happen to contain', () => {
    const rows = served(JSON.stringify({ rows: [
      { page: '<div>home</div>', note: 'embedded via <Iframe src="x" />', frame: 'data-mx-managed-frame' },
    ] }));
    expect(productMetrics({ served: rows, baseline: null }).noIframe).toBeNull();
  });

  it('is null for any response that is not a served document, even one full of HTML', () => {
    // An export, an error page, a bare fragment: none of them is the document this run published.
    expect(productMetrics({ served: served('<html><body><h1>Not found</h1><p>gone</p></body></html>'), baseline: null }).noIframe).toBeNull();
  });
});
