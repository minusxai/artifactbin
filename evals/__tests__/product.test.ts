/**
 * Product-side truth for a run, read from what the product SERVES (the driver
 * never holds the agent's token — the start link handed it to the agent).
 */
import { describe, it, expect } from 'vitest';
import { artifactIdFromText, dataflowRows, productMetrics, titleOf } from '../lib/score/product';

const served = (html: string, status = 200) => ({ status, html });

describe('titleOf', () => {
  it('reads the document <title>, decoded', () => {
    expect(titleOf('<html><head><title>Coffee &amp; cups — Q2</title></head></html>')).toBe('Coffee & cups — Q2');
    expect(titleOf('<html><head></head></html>')).toBeNull();
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

describe('titleOf — entity decoding is a SINGLE pass', () => {
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

describe('published is PRODUCT truth, not a count of the calls we happened to see', () => {
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

  it('ignores a START link, which names the document the agent was GIVEN, not one it made', () => {
    expect(artifactIdFromText('https://artifactbin.dev/a/K8a1Dg/start?k=abc')).toBeNull();
  });
});
