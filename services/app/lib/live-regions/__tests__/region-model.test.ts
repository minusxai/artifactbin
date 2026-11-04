/**
 * The server half of live regions, without an editor: normal form and sanitization (I6), the server-built state,
 * the three-way revision, compaction (I5) and the id rules. Concurrent editing through real editors is in
 * concurrent-editing.ui.test.ts; random interleavings in convergence.property.ui.test.ts.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { canonicalizeHtmlPage } from '../../html-page';
import { attribute, parseSource } from '../../html-page/html-source';
import { applyRegionRevision, compactRegion, createRegionState, LiveRegionRefusal, normalizeRegionHtml, regionHtml, regionSchema, regionText, safeHref, type RegionKind } from '..';

const refusal = (run: () => unknown): LiveRegionRefusal => {
  try { run(); } catch (error) { if (error instanceof LiveRegionRefusal) return error; throw error; }
  throw new Error('expected a LiveRegionRefusal');
};
const ids = (html: string) => [...html.matchAll(/data-af-id="([^"]+)"/g)].map((match) => match[1]!);
const PAGE = (region: string, kind: RegionKind = 'rich') => {
  const tag = kind === 'rich' ? 'article' : 'h1';
  return `<!doctype html><html><head><title>Plan</title><style>p{color:red}</style></head><body>
<header><h1>Fixed title</h1></header>
<${tag} data-af-editable="${kind}">${region}</${tag}>
<script type="module">document.title='x';</script>
</body></html>`;
};
/** A published page around a normalized region, as publish would store it. */
function published(region: string, kind: RegionKind = 'rich') {
  const page = canonicalizeHtmlPage(PAGE(normalizeRegionHtml(kind, region), kind));
  const element = parseSource(page.html).elements.find((candidate) => attribute(candidate, 'data-af-editable') === kind)!;
  const location = element.sourceCodeLocation!;
  const inner = page.html.slice(location.startTag!.endOffset, location.endTag!.startOffset);
  return { ...page, regionId: attribute(element, 'data-af-id')!, inner };
}
/** Bytes outside the region of `html`, given the region element's id. */
function outsideRegion(html: string, regionId: string): [string, string] {
  const element = parseSource(html).elements.find((candidate) => attribute(candidate, 'data-af-id') === regionId)!;
  const location = element.sourceCodeLocation!;
  return [html.slice(0, location.startTag!.endOffset), html.slice(location.endTag!.startOffset)];
}
const apply = (state: Uint8Array, ...updates: Uint8Array[]) => Y.mergeUpdates([state, ...updates]);

describe('schema (I2 checks attributes too)', () => {
  it('validates every structural attribute and the link href', () => {
    const schema = regionSchema('rich');
    const { nodes, marks } = schema;
    const ok = nodes.doc!.create(null, nodes.textblock!.create({ level: 2, list: 'ordered', depth: 3, quote: true, afId: 'af-1', itemId: 'af-2' }, schema.text('x')));
    expect(() => ok.check()).not.toThrow();
    for (const attrs of [{ level: 7 }, { list: 'dotted' }, { depth: 7 }, { quote: 'yes' }, { afId: '"><b>' }, { listId: 1 }]) {
      expect(() => nodes.doc!.create(null, nodes.textblock!.create(attrs)).check(), JSON.stringify(attrs)).toThrow(RangeError);
    }
    expect(() => nodes.doc!.create(null, nodes.textblock!.create(null, schema.text('x', [marks.link!.create({ href: 'javascript:alert(1)' })]))).check()).toThrow(RangeError);
    expect(() => nodes.doc!.create(null, nodes.code_block!.create(null, schema.text('x', [marks.strong!.create()]))).check()).toThrow(RangeError);
    expect(Object.keys(regionSchema('text').nodes)).toEqual(['doc', 'textblock', 'text']);
    expect(Object.keys(regionSchema('text').marks)).toEqual([]);
  });
});

describe('normal form (I6: normalize once, then byte-identical through ProseMirror and Yjs)', () => {
  const rich: [string, string, string][] = [
    ['b and i become strong and em; bare text becomes a paragraph', 'Some <b>bold</b> and <i>italic</i>.', '<p>Some <strong>bold</strong> and <em>italic</em>.</p>'],
    ['whitespace collapses and block ends are trimmed', '<p>\n   Hello   \t world \n</p>\n<h2>  Title </h2>', '<p>Hello world</p><h2>Title</h2>'],
    ['marks nest in schema order', '<p><em><strong>x</strong> y</em><code>z</code></p>', '<p><strong><em>x</em></strong><em> y</em><code>z</code></p>'],
    ['attributes outside the schema are dropped', '<p class="lead" style="color:red" onclick="x()" data-af-id="af-3" id="p">t <a href="https://x.dev" target="_blank" rel="noopener" onmouseover="y()">l</a></p>', '<p data-af-id="af-3">t <a href="https://x.dev">l</a></p>'],
    ['inline elements keep no id', '<p data-af-id="af-1">a <strong data-af-id="af-2">b</strong> <a href="/x" data-af-id="af-3">c</a></p>', '<p data-af-id="af-1">a <strong>b</strong> <a href="/x">c</a></p>'],
    ['bare and paragraph list items, nested lists', '<ul><li>Bare</li><li><p>Para</p><ol><li>Nested</li></ol></li></ul>', '<ul><li><p>Bare</p></li><li><p>Para</p><ol><li><p>Nested</p></li></ol></li></ul>'],
    ['lists three deep keep every id', '<ul data-af-id="l1"><li data-af-id="i1"><p data-af-id="p1">a</p><ul data-af-id="l2"><li data-af-id="i2"><p data-af-id="p2">b</p><ol data-af-id="l3"><li data-af-id="i3"><p data-af-id="p3">c</p></li></ol></li></ul></li><li data-af-id="i4"><p data-af-id="p4">d</p></li></ul>', '<ul data-af-id="l1"><li data-af-id="i1"><p data-af-id="p1">a</p><ul data-af-id="l2"><li data-af-id="i2"><p data-af-id="p2">b</p><ol data-af-id="l3"><li data-af-id="i3"><p data-af-id="p3">c</p></li></ol></li></ul></li><li data-af-id="i4"><p data-af-id="p4">d</p></li></ul>'],
    ['a list item that starts with a nested list', '<ul><li><ul><li>deep</li></ul></li></ul>', '<ul><li><ul><li><p>deep</p></li></ul></li></ul>'],
    ['adjacent lists of one type merge', '<ul><li>a</li></ul>\n<ul><li>b</li></ul><ol><li>c</li></ol>', '<ul><li><p>a</p></li><li><p>b</p></li></ul><ol><li><p>c</p></li></ol>'],
    ['quotes hold paragraphs, lists and code', '<blockquote data-af-id="q"><p>Q</p><ul><li>a</li></ul><pre>x</pre></blockquote><p>after</p>', '<blockquote data-af-id="q"><p>Q</p><ul><li><p>a</p></li></ul><pre><code>x</code></pre></blockquote><p>after</p>'],
    ['code keeps its whitespace and loses its attributes', '<pre data-af-id="c1"><code class="language-js" data-af-id="c2">let x = 1;\n  y &lt; 2 &amp;&amp; z\n</code></pre>', '<pre data-af-id="c1"><code>let x = 1;\n  y &lt; 2 &amp;&amp; z\n</code></pre>'],
    ['rules and every heading level', '<h1>1</h1><h2>2</h2><h3>3</h3><h4>4</h4><h5>5</h5><h6>6</h6><hr class="x">', '<h1>1</h1><h2>2</h2><h3>3</h3><h4>4</h4><h5>5</h5><h6>6</h6><hr>'],
    ['entities: &amp; &lt; &gt; stay escaped, NBSP stays, others are characters', '<p>a &amp; b &lt; c &gt; d&nbsp;e &eacute; &quot;q&quot;</p>', '<p>a &amp; b &lt; c &gt; d&nbsp;e é "q"</p>'],
    ['emoji, surrogate pairs, combining characters and RTL text', '<p>👩🏽‍💻 𝒳 é שלום مرحبا</p>', '<p>👩🏽‍💻 𝒳 é שלום مرحبا</p>'],
    ['comments are dropped', '<!-- headings, paragraphs --><p>x</p>', '<p>x</p>'],
    ['an empty region', '', ''],
    ['a whitespace-only region', '  \n\t ', ''],
    ['one empty paragraph is an empty region', '<p></p>', ''],
    ['an empty paragraph with an id stays', '<p data-af-id="af-1"></p>', '<p data-af-id="af-1"></p>'],
  ];
  const text: [string, string, string][] = [
    ['plain text collapses', '  Hello  <!-- x -->\n world ', 'Hello world'],
    ['entities stay escaped', 'a &amp; b &lt;c&gt;&nbsp;d', 'a &amp; b &lt;c&gt;&nbsp;d'],
    ['empty', '', ''],
  ];
  it.each([...rich.map((row) => ['rich', ...row] as const), ...text.map((row) => ['text', ...row] as const)])('%s: %s', (kind, _name, input, expected) => {
    const normal = normalizeRegionHtml(kind, input);
    expect(normal).toBe(expected);
    expect(normalizeRegionHtml(kind, normal)).toBe(normal);
    expect(regionHtml(kind, createRegionState(kind, normal).state)).toBe(normal);
    expect(regionHtml(kind, createRegionState(kind, input).state)).toBe(normal);
  });

  it('the skill\'s handwritten corpus is stable after one normalization', () => {
    const corpus = `<h2>Notes &amp; plans</h2><p>Text with <b>bold</b>, <i>italic</i>, <a href="https://x.dev">link</a> and <code>code</code>.</p>
      <ul><li>Bare li</li><li><p>Para li</p><ol><li>Nested</li></ol></li></ul><blockquote><p>Quote</p></blockquote><pre><code>let x = 1;</code></pre><hr>`;
    const normal = normalizeRegionHtml('rich', corpus);
    expect(normal).toBe('<h2>Notes &amp; plans</h2><p>Text with <strong>bold</strong>, <em>italic</em>, <a href="https://x.dev">link</a> and <code>code</code>.</p><ul><li><p>Bare li</p></li><li><p>Para li</p><ol><li><p>Nested</p></li></ol></li></ul><blockquote><p>Quote</p></blockquote><pre><code>let x = 1;</code></pre><hr>');
    expect(regionHtml('rich', createRegionState('rich', normal).state)).toBe(normal);
  });
});

describe('sanitization: authored content is refused by name, never silently rewritten', () => {
  const rows: [RegionKind, string, string[]][] = [
    ['rich', '<p>a<br>b</p>', ['<br>']],
    ['rich', '<div><p>x</p></div><section>y</section>', ['<div>', '<section>']],
    ['rich', '<p><span class="pill">s</span> <u>u</u></p>', ['<span>', '<u>']],
    ['rich', '<svg><text>label</text></svg><button>Go</button>', ['<svg>', '<button>']],
    ['rich', '<p><img src="x.png" alt="x"> <script>alert(1)</script></p><style>p{}</style>', ['<img>', '<script>', '<style>']],
    ['rich', '<p><a href="javascript:alert(1)">x</a></p>', ['unsafe link "javascript:alert(1)"']],
    ['rich', '<p><a href=" JaVa\tScRiPt:alert(1)">x</a></p>', ['unsafe link " JaVa\\tScRiPt:alert(1)"']],
    ['rich', '<p><a href="data:text/html,x">x</a> <a>y</a></p>', ['unsafe link "data:text/html,x"', '<a> without href']],
    ['rich', '<blockquote><blockquote><p>x</p></blockquote></blockquote>', ['nested <blockquote>']],
    ['rich', '<ul><li><blockquote>q</blockquote></li></ul>', ['<blockquote> in a list']],
    ['rich', '<ul><li><p>a</p><p>b</p></li></ul>', ['several blocks in one <li>']],
    ['rich', '<ul><li><hr></li></ul><li>x</li>', ['<hr> in a list', '<li> outside a list']],
    ['rich', '<ul><p>x</p>loose</ul>', ['<p> directly in <ul>', 'text directly in <ul>']],
    ['rich', '<ul><li><ul><li><ul><li><ul><li><ul><li><ul><li><ul><li>7</li></ul></li></ul></li></ul></li></ul></li></ul></li></ul></li></ul>', ['lists nested deeper than 6']],
    ['text', 'a <strong>b</strong><br>c', ['<strong>', '<br>']],
  ];
  it.each(rows)('%s %j refuses %j', (kind, html, details) => {
    const error = refusal(() => normalizeRegionHtml(kind, html));
    expect(error.code).toBe('unsupported_content');
    expect(error.details).toEqual(details);
    expect(refusal(() => createRegionState(kind, html)).details).toEqual(details);
  });

  it('the report example\'s sections cannot be regions as written: svg, button and div are refused', () => {
    const report = readFileSync(new URL('../../../skills/artifactbin/examples/report.html', import.meta.url), 'utf8');
    const document = parseSource(report);
    const sections = document.elements.filter((element) => element.tagName === 'section' || element.tagName === 'article');
    expect(sections.length).toBeGreaterThanOrEqual(2);
    const details = sections.flatMap((element) => {
      const location = element.sourceCodeLocation!;
      try { normalizeRegionHtml('rich', report.slice(location.startTag!.endOffset, location.endTag!.startOffset)); return []; } catch (error) {
        if (!(error instanceof LiveRegionRefusal)) throw error;
        return [...error.details];
      }
    });
    expect(details).toEqual(expect.arrayContaining(['<svg>', '<button>', '<div>']));
  });

  it.each([
    ['https://x.dev/a?b#c', 'https://x.dev/a?b#c'], ['http://x.dev', 'http://x.dev'], ['MAILTO:a@b.dev', 'MAILTO:a@b.dev'],
    ['/relative/path', '/relative/path'], ['../up', '../up'], ['#anchor', '#anchor'], ['?q=1', '?q=1'], ['//cdn.dev/x', '//cdn.dev/x'],
    ['  https://x.dev  ', 'https://x.dev'], ['https://x\n.dev', 'https://x.dev'],
    ['javascript:alert(1)', null], ['JAVASCRIPT:alert(1)', null], ['java\tscript:alert(1)', null], ['\u0001javascript:x', null],
    ['vbscript:x', null], ['data:text/html,x', null], ['file:///etc/passwd', null], ['blob:https://x', null], ['a:b', null], ['', null], [' ', null],
  ])('safeHref(%j) is %j', (href, expected) => {
    expect(safeHref(href)).toBe(expected);
  });

  it('the merged state is stripped, not refused: foreign attributes, embeds, unsafe links, junk ids and bad values vanish; text never does', () => {
    const doc = new Y.Doc();
    const text = regionText(doc);
    text.insert(0, 'ok ', { onclick: 'x()' });
    text.insertEmbed(3, { script: 'alert(1)' });
    text.insert(4, 'link', { link: 'javascript:alert(1)', bold: 'yes' });
    text.insert(8, '\n', { level: 9, onclick: 'x()', afId: '"><script>alert(1)</script>' });
    text.insert(9, 'q\n', { quote: 'yes', list: 'weird' } as never);
    text.insert(11, 'held\n', { rule: true });
    text.insert(16, 'tail without its line end');
    expect(regionHtml('rich', Y.encodeStateAsUpdate(doc))).toBe('<h6>ok link</h6><p>q</p><p>held</p><p>tail without its line end</p>');
  });
});

describe('agent Markdown (prosemirror-markdown, CommonMark, raw HTML off)', () => {
  const revise = (markdown: string, base = '<p data-af-id="af-1">old</p>') => {
    const { state, snapshot } = createRegionState('rich', base);
    const { update } = applyRegionRevision({ kind: 'rich', live: state, savedSnapshot: snapshot, markdown });
    return regionHtml('rich', apply(state, update));
  };
  it('maps every construct the rich kind holds', () => {
    expect(revise('# Title\n\nSome **bold**, *it*, `code` and [l](https://x.dev).\n\n- a\n  - b\n1. c\n\n> q\n\n```js\nx < 1\n```\n\n---\n'))
      // Markdown has no ids: the rewritten first block takes the id of the block it replaces.
      .toBe('<h1 data-af-id="af-1">Title</h1><p>Some <strong>bold</strong>, <em>it</em>, <code>code</code> and <a href="https://x.dev">l</a>.</p><ul><li><p>a</p><ul><li><p>b</p></li></ul></li></ul><ol><li><p>c</p></li></ol><blockquote><p>q</p></blockquote><pre><code>x &lt; 1</code></pre><hr>');
  });
  it('raw HTML is text and a javascript: link is not a link', () => {
    expect(revise('<script>alert(1)</script> [x](javascript:alert(1))')).toBe('<p data-af-id="af-1">&lt;script&gt;alert(1)&lt;/script&gt; [x](javascript:alert(1))</p>');
  });
  it('refuses images and hard breaks by name', () => {
    const { state, snapshot } = createRegionState('rich', '<p>x</p>');
    const error = refusal(() => applyRegionRevision({ kind: 'rich', live: state, savedSnapshot: snapshot, markdown: '![a](x.png)\n\nline  \nbreak' }));
    expect([error.code, error.details]).toEqual(['unsupported_content', ['<img>', '<br>']]);
  });
});

describe('three-way revision (republish and agent edits)', () => {
  /** A reader's edit made straight on the shared text: text inserted at `offset` within line `index`. */
  const readerTypes = (state: Uint8Array, index: number, offset: number, text: string, clientID = 7) => {
    const doc = new Y.Doc();
    doc.clientID = clientID;
    Y.applyUpdate(doc, state);
    const before = Y.encodeStateVector(doc);
    const shared = regionText(doc);
    const lineStart = shared.toString().split('\n').slice(0, index).reduce((sum, line) => sum + line.length + 1, 0);
    shared.insert(lineStart + offset, text);
    return Y.encodeStateAsUpdate(doc, before);
  };
  const base = '<h2 data-af-id="h">Goals</h2><p data-af-id="p1">First paragraph about the plan.</p><p data-af-id="p2">Second paragraph that the author will revise.</p>';

  it('keeps the reader\'s synced, unsaved edits in paragraphs 1 and 2 and the author\'s rewrite of paragraph 2', () => {
    const saved = createRegionState('rich', base);
    let live = saved.state;
    live = apply(live, readerTypes(live, 1, 'First paragraph about the plan'.length, ' [reader p1]'));
    live = apply(live, readerTypes(live, 2, 'Second'.length, ' [reader p2]'));
    const authored = base.replace('Second paragraph that the author will revise.', 'Second paragraph, revised by the author.');
    const { update } = applyRegionRevision({ kind: 'rich', live, savedSnapshot: saved.snapshot, html: authored });
    expect(regionHtml('rich', apply(live, update))).toBe('<h2 data-af-id="h">Goals</h2><p data-af-id="p1">First paragraph about the plan [reader p1].</p><p data-af-id="p2">Second [reader p2] paragraph, revised by the author.</p>');
  });

  it('refuses a revision without a snapshot, typed, instead of applying it two-way', () => {
    const { state } = createRegionState('rich', base);
    for (const savedSnapshot of [null, undefined, new Uint8Array()]) {
      expect(refusal(() => applyRegionRevision({ kind: 'rich', live: state, savedSnapshot, html: base })).code).toBe('missing_snapshot');
    }
  });

  it('refuses a snapshot of another live state', () => {
    const { state } = createRegionState('rich', base);
    const other = createRegionState('rich', '<p>other</p>');
    expect(refusal(() => applyRegionRevision({ kind: 'rich', live: state, savedSnapshot: other.snapshot, html: base })).code).toBe('snapshot_mismatch');
  });

  it('applies two republishes in a row, each against the snapshot the previous one returned', () => {
    const saved = createRegionState('rich', base);
    let live = apply(saved.state, readerTypes(saved.state, 1, 5, ' [r1]'));
    const v2 = base.replace('Goals', 'Goals v2');
    const first = applyRegionRevision({ kind: 'rich', live, savedSnapshot: saved.snapshot, html: v2 });
    live = apply(live, first.update);
    live = apply(live, readerTypes(live, 2, 6, ' [r2]', 8));
    const v3 = v2.replace('First paragraph', 'Opening paragraph');
    const second = applyRegionRevision({ kind: 'rich', live, savedSnapshot: first.snapshot, html: v3 });
    // The reader typed right after "First"; the author replaced "First". Both inserts follow the same character, so
    // Yjs orders them by client id (the reader's 7 is below the fork's random id): the reader's text comes first.
    expect(regionHtml('rich', apply(live, second.update))).toBe('<h2 data-af-id="h">Goals v2</h2><p data-af-id="p1">[r1]Opening paragraph about the plan.</p><p data-af-id="p2">Second [r2] paragraph that the author will revise.</p>');
  });

  it('leaves blocks the revision does not change untouched, trailing space included', () => {
    const saved = createRegionState('rich', base);
    const live = apply(saved.state, readerTypes(saved.state, 1, 'First paragraph about the plan.'.length, ' '));
    const { update } = applyRegionRevision({ kind: 'rich', live, savedSnapshot: compactSnapshot(live), html: base.replace('Goals', 'Aims') });
    const doc = new Y.Doc();
    Y.applyUpdate(doc, apply(live, update));
    expect(regionText(doc).toString().split('\n')[1]).toBe('First paragraph about the plan. ');
  });
});

/** The snapshot compaction would keep for this state (a region whose saved page holds exactly these blocks). */
function compactSnapshot(state: Uint8Array): Uint8Array {
  const doc = new Y.Doc({ gc: false });
  Y.applyUpdate(doc, state);
  return Y.encodeSnapshot(Y.snapshot(doc));
}

describe('compaction (I5: a page canonicalizeHtmlPage accepts; every byte outside the region unchanged)', () => {
  const body = '<h2>Goals</h2><p>First paragraph about the plan.</p><p>Hello <strong>bold</strong> and <a href="https://x.dev">link</a>.</p><ul><li>One</li><li>Two</li></ul><pre><code>x</code></pre>';
  const appendBlock = (state: Uint8Array, text: string, attrs: Record<string, unknown> = {}) => {
    const doc = new Y.Doc();
    Y.applyUpdate(doc, state);
    const before = Y.encodeStateVector(doc);
    const shared = regionText(doc);
    shared.insert(shared.length, `${text}\n`, {});
    shared.format(shared.length - 1, 1, attrs as never);
    return Y.encodeStateAsUpdate(doc, before);
  };
  const check = (page: { html: string }, saved: ReturnType<typeof published>) => {
    expect(() => canonicalizeHtmlPage(page.html, { previousHtml: saved.html, ledger: saved.ledger })).not.toThrow();
    expect(outsideRegion(page.html, saved.regionId)).toEqual(outsideRegion(saved.html, saved.regionId));
    expect(new Set(ids(page.html)).size).toBe(ids(page.html).length);
  };

  it('without edits rewrites nothing, and a second compaction is byte-identical too', () => {
    const saved = published(body);
    const { state } = createRegionState('rich', saved.inner);
    const first = compactRegion({ savedHtml: saved.html, ledger: saved.ledger, regionId: saved.regionId, state });
    check(first, saved);
    expect(first.html).toBe(saved.html);
    const second = compactRegion({ savedHtml: first.html, ledger: first.ledger, regionId: saved.regionId, state: apply(state, first.update) });
    expect([second.html, second.ledger]).toEqual([first.html, first.ledger]);
  });

  it('gives a new block a fresh id, writes it back into the live state, and stays stable after', () => {
    const saved = published(body);
    const { state } = createRegionState('rich', saved.inner);
    const live = apply(state, appendBlock(state, 'A new block'));
    const first = compactRegion({ savedHtml: saved.html, ledger: saved.ledger, regionId: saved.regionId, state: live });
    check(first, saved);
    const fresh = ids(first.html).filter((id) => !ids(saved.html).includes(id));
    expect(fresh).toHaveLength(1);
    const written = apply(live, first.update);
    expect(regionHtml('rich', written)).toContain(`<p data-af-id="${fresh[0]}">A new block</p>`);
    const second = compactRegion({ savedHtml: first.html, ledger: first.ledger, regionId: saved.regionId, state: written });
    expect([second.html, second.ledger]).toEqual([first.html, first.ledger]);
  });

  it('strips ids the saved region does not hold: retired, foreign to the region, repeated or invalid', () => {
    const saved = published('<p>keep</p><p>gone</p>');
    const retired = ids(saved.inner)[1]!;
    const shrunk = compactRegion({ savedHtml: saved.html, ledger: saved.ledger, regionId: saved.regionId, state: createRegionState('rich', saved.inner.replace(/<p[^>]*>gone<\/p>/, '')).state });
    const kept = ids(saved.inner)[0]!;
    const header = ids(saved.html)[ids(saved.html).indexOf(saved.regionId) - 1]!;
    let live = createRegionState('rich', saved.inner.replace(/<p[^>]*>gone<\/p>/, '')).state;
    for (const afId of [retired, header, kept, 'not valid!']) live = apply(live, appendBlock(live, `block ${afId}`, { afId }));
    const page = compactRegion({ savedHtml: shrunk.html, ledger: shrunk.ledger, regionId: saved.regionId, state: live });
    check(page, saved);
    const region = ids(page.html.slice(page.html.indexOf(saved.regionId)));
    expect(region.filter((id) => [retired, header].includes(id))).toEqual([]);
    expect(region.filter((id) => id === kept)).toHaveLength(1);
    expect(page.html).toContain(`<p data-af-id="${kept}">keep</p>`);
  });

  it('known limitation: inline element ids are re-derived by text carry-over, so rewriting a bold run changes its id', () => {
    const saved = published('<p>Hello <strong>bold</strong> and <a href="https://x.dev">link</a>.</p>');
    const [paragraph, strong, link] = ids(saved.inner);
    const editedAfter = compactRegion({ savedHtml: saved.html, ledger: saved.ledger, regionId: saved.regionId, state: createRegionState('rich', saved.inner.replace('link</a>.', 'link</a>. More text.')).state });
    expect(ids(editedAfter.html.slice(editedAfter.html.indexOf(saved.regionId))).slice(0, 3)).toEqual([paragraph, strong, link]);
    const rewritten = compactRegion({ savedHtml: saved.html, ledger: saved.ledger, regionId: saved.regionId, state: createRegionState('rich', saved.inner.replace('>bold<', '>completely different words<')).state });
    const after = ids(rewritten.html.slice(rewritten.html.indexOf(saved.regionId))).slice(0, 3);
    expect(after[0]).toBe(paragraph);
    expect(after[1]).not.toBe(strong);
  });

  it('compacts a text region', () => {
    const saved = published('Plain title', 'text');
    const { state } = createRegionState('text', saved.inner);
    const doc = new Y.Doc();
    Y.applyUpdate(doc, state);
    const before = Y.encodeStateVector(doc);
    regionText(doc).insert(5, ' & safe <title>');
    const page = compactRegion({ savedHtml: saved.html, ledger: saved.ledger, regionId: saved.regionId, state: apply(state, Y.encodeStateAsUpdate(doc, before)) });
    check(page, saved);
    expect(page.html).toContain(`data-af-editable="text" data-af-id="${saved.regionId}">Plain &amp; safe &lt;title&gt; title</h1>`);
  });

  it('refuses a region id the page does not have', () => {
    const saved = published('<p>x</p>');
    const { state } = createRegionState('rich', saved.inner);
    expect(refusal(() => compactRegion({ savedHtml: saved.html, ledger: saved.ledger, regionId: 'af-999', state })).code).toBe('region_not_found');
  });
});

describe('performance bound', () => {
  it('a 50,000-character paragraph is built, read, revised and compacted in well under two seconds', () => {
    const long = 'word '.repeat(10_000).trim();
    const started = performance.now();
    const saved = published(`<p>${long}</p>`);
    const { state, snapshot } = createRegionState('rich', saved.inner);
    expect(regionHtml('rich', state)).toHaveLength(long.length + `<p data-af-id="${ids(saved.inner)[0]}"></p>`.length);
    const { update } = applyRegionRevision({ kind: 'rich', live: state, savedSnapshot: snapshot, html: saved.inner.replace('word word', 'WORD word') });
    const page = compactRegion({ savedHtml: saved.html, ledger: saved.ledger, regionId: saved.regionId, state: apply(state, update) });
    expect(page.html).toContain('WORD word');
    expect(performance.now() - started).toBeLessThan(2000);
  });
});
