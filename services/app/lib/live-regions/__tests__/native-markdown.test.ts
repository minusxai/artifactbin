/**
 * Documents' Markdown through lib/markdown: Markdown in (native-markdown.ts: the shared parse, fitted to native-v1) and
 * out (native-markdown-save.ts: the shared serializer). The fit rules, what an agent reads and sends back, the shared
 * rules that differ from the previous parser, and Markdown's images, which a paste or an agent write builds.
 */
import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { applyRegionRevision, createRegionState, openRegionDoc, regionHtml, regionMarkdown } from '..';
import { nativeMarkdownJson } from '../native-markdown';
import { writeNativeHtml } from '../native-html';
import { nativeSchema } from '../native-schema';

const kind = 'rich-native-v1';
/** Markdown → the document's normal-form HTML, as a paste or an agent write builds it. */
const html = (markdown: string) => {
  const doc = nativeSchema.nodeFromJSON(nativeMarkdownJson(markdown));
  doc.check();
  return writeNativeHtml(doc);
};
const LINK = 'target="_blank" rel="noopener noreferrer nofollow"';
const emptyUpdate = (update: Uint8Array) => {
  const { structs, ds } = Y.decodeUpdate(update);
  return !structs.length && ![...ds.clients.values()].some(ranges => ranges.length);
};
/** An agent's write of `markdown` over `saved`: the region's HTML after it. */
const write = (saved: string, markdown: string) => {
  const { state, snapshot } = createRegionState(kind, saved);
  const { update } = applyRegionRevision({ kind, live: state, savedSnapshot: snapshot, markdown });
  const doc = openRegionDoc(state, { kind });
  Y.applyUpdate(doc, update);
  return regionHtml(kind, Y.encodeStateAsUpdate(doc));
};

describe('the fit to native-v1', () => {
  it.each([
    ['strikethrough is dropped, its text kept', 'a ~~b~~ c', '<p>a b c</p>'],
    ['inline code keeps its text and drops bold and links', '**`x`** [`y`](https://y.example) *a*', '<p><code>x</code> <code>y</code> <em>a</em></p>'],
    ['a table is one paragraph per row, cells joined with " | "', '| a | b |\n| --- | --- |\n| 1 | **2** |', '<p>a | b</p><p>1 | <strong>2</strong></p>'],
    ['a link the document refuses keeps its text; a title is kept', '[t](tel:123) [w](https://w.example "W")', `<p>t <a href="https://w.example" ${LINK} title="W">w</a></p>`],
    ['a code language only in the stored form', '```ts\nx\n```\n\n```c#\ny\n```', '<pre><code class="language-ts">x</code></pre><pre><code>y</code></pre>'],
    ['a list item opens with a paragraph', '- ```\n  x\n  ```', '<ul><li><p></p><pre><code>x</code></pre></li></ul>'],
    ['task lists split from bullet groups; nesting kept', '- [x] done\n- [ ] next\n- plain\n  - nested',
      '<ul data-type="taskList"><li data-type="taskItem" data-checked="true"><p>done</p></li><li data-type="taskItem" data-checked="false"><p>next</p></li></ul><ul><li><p>plain</p><ul><li><p>nested</p></li></ul></li></ul>'],
    ['ordered lists keep their start', '3. three\n4. four', '<ol start="3"><li><p>three</p></li><li><p>four</p></li></ol>'],
    ['hard breaks stay breaks', 'a  \nb\\\nc', '<p>a<br>b<br>c</p>'],
    ['headings, quotes and rules', '## Plan\n\n> quoted\n\n---', '<h2>Plan</h2><blockquote><p>quoted</p></blockquote><hr>'],
  ])('%s', (_name, markdown, expected) => {
    expect(html(markdown)).toBe(expected);
  });

  // The shared rules (lib/markdown/display.ts) that differ from prosemirror-markdown's CommonMark parser.
  it.each([
    ['a single newline is a line break', 'one\ntwo', '<p>one<br>two</p>'],
    ['bare addresses with a scheme or www. link; file names stay text', 'see https://e.example and README.md',
      `<p>see <a href="https://e.example" ${LINK}>https://e.example</a> and README.md</p>`],
    ['a rare entity name stays as typed (the slim decoder)', 'AT&amp;T &alpha;', '<p>AT&amp;T &amp;alpha;</p>'],
  ])('intended difference: %s', (_name, markdown, expected) => {
    expect(html(markdown)).toBe(expected);
  });

  it('builds a valid region state from every shared element and edge case; only nesting past the document\'s limit refuses', () => {
    const corpus = [
      '', '  \n\t\n', '# One\n\n###### Six', 'Title\n=====', 'Some **bold**, *italic*, ~~strike~~, `code` and ***both***.',
      '**a `b` [c](https://c.example) d** and [**e** `f`](/g "G")', '`**a** [b](c) <i> &amp;`',
      'See [the docs](https://example.com/a?b=1 "Docs"), <https://auto.example>, www.example.com, mailto:a@b.example and [rel](/x#y).',
      '[x](javascript:alert(1)) [y](data:text/html,hi) [z](//host.example) <ftp://f.example>', 'Hi <script>alert(1)</script>\n\n<div>block</div>',
      '\\*not italic\\* \\# \\[x\\](y) 1\\. two \\\\ back', 'No. It lives here.\nOk. Fine.', 'snake_case_name and 2*3*4', 'Text[^1].\n\n[^1]: the note',
      '- one\n\n- two\n\n  second paragraph', '- [ ] a\n- [x] b\n\n1. [x] not a task', '> - a\n>   > b\n> ```js\n> x\n> ```',
      '| a | b |\n|:--|--:|\n| `x\\|y` | <br> |', '![alt](https://i.example/p.png "T") ![up](ref:abcdef12)', '- # heading item\n- > quote item\n- - nested first',
      Array.from({ length: 10 }, (_, i) => `${'  '.repeat(i)}- level${i}`).join('\n'),
    ];
    for (const markdown of corpus) expect(() => createRegionState(kind, html(markdown)), markdown).not.toThrow();
    const deep = Array.from({ length: 30 }, (_, i) => `${'  '.repeat(i)}- level${i}`).join('\n');
    expect(() => createRegionState(kind, html(deep))).toThrow('native nesting limit');
  });
});

describe('an agent reads a document as Markdown and writes it back', () => {
  const SAVED: ReadonlyArray<readonly [string, string]> = [
    ['blocks and marks', '<h2 data-af-id="h">Plan</h2><p data-af-id="p">Ship <strong>bold</strong>, <em>soft</em>, <code>x()</code> and <a href="https://e.test/a" target="_blank" rel="noopener noreferrer nofollow">a link</a>.</p>'],
    ['a bare link and a titled one', `<p><a href="https://e.test" ${LINK}>https://e.test</a> and <a href="/rel" ${LINK} title="T">rel</a></p>`],
    ['lists, nesting and a start', '<ul><li><p>one</p><ul><li><p>nested</p></li></ul></li><li><p>two</p></li></ul><ol start="3"><li><p>three</p></li></ol>'],
    ['mixed task and bullet groups', '<ul data-type="taskList"><li data-type="taskItem" data-checked="true"><p>done</p></li></ul><ul><li><p>plain</p></li></ul>'],
    ['code with a language, a quote and a rule', '<pre><code class="language-ts">const x = 1;\n  y();</code></pre><blockquote><p>q</p></blockquote><hr>'],
    ['breaks, leading spaces and Markdown typed as text', '<p>  indented<br>next line</p><p>* not a list</p><p># not a heading</p><p>1. not ordered</p><p>a ~~b~~ c | d</p>'],
  ];
  it.each(SAVED)('%s: sending back what was read changes nothing', (_name, saved) => {
    const { state, snapshot } = createRegionState(kind, saved);
    const markdown = regionMarkdown(kind, saved);
    const { update } = applyRegionRevision({ kind, live: state, savedSnapshot: snapshot, markdown });
    expect(emptyUpdate(update), markdown).toBe(true);
  });

  it('reads the canonical spelling: `-` bullets, tight lists, `1.` numbers, fenced code', () => {
    expect(regionMarkdown(kind, '<p>A</p><ul><li><p>B</p></li><li><p>C</p></li></ul><ol start="2"><li><p>D</p></li></ol><pre><code class="language-js">x</code></pre>'))
      .toBe('A\n\n- B\n- C\n\n2. D\n\n```js\nx\n```');
  });

  it('a URL that is plain text in the document links once an agent sends the Markdown back (bare addresses link)', () => {
    const saved = '<p data-af-id="a">see https://e.test and www.example.com</p>';
    expect(regionMarkdown(kind, saved)).toBe('see https://e.test and www.example.com');
    expect(write(saved, regionMarkdown(kind, saved))).toBe(`<p data-af-id="a">see <a href="https://e.test" ${LINK}>https://e.test</a> and <a href="http://www.example.com" ${LINK}>www.example.com</a></p>`);
  });

  it('an edit to the Markdown read changes only that block', () => {
    const saved = '<p data-af-id="a">alpha</p><ul data-af-id="l"><li data-af-id="i"><p data-af-id="ip">item</p></li></ul><p data-af-id="z">omega</p>';
    expect(write(saved, regionMarkdown(kind, saved).replace('item', 'item, revised')))
      .toBe('<p data-af-id="a">alpha</p><ul data-af-id="l"><li data-af-id="i"><p data-af-id="ip">item, revised</p></li></ul><p data-af-id="z">omega</p>');
  });
});

describe('Markdown writes images', () => {
  it.each([
    ['an https image and an upload, each with its alt and title', '![chart](https://i.example/c.png) and ![upload](ref:abcdef12 "T")',
      '<p><img src="https://i.example/c.png" alt="chart"> and <img src="ref:abcdef12" alt="upload" title="T"></p>'],
    ['a relative source', '![p](/a/x/raw)', '<p><img src="/a/x/raw" alt="p"></p>'],
    ['in a heading, a list item and a table row', '## ![h](ref:abcdef12) Head\n\n- ![i](ref:abcdef12)\n\n| a | b |\n| --- | --- |\n| ![c](ref:abcdef12) | d |',
      '<h2><img src="ref:abcdef12" alt="h"> Head</h2><ul><li><p><img src="ref:abcdef12" alt="i"></p></li></ul><p>a | b</p><p><img src="ref:abcdef12" alt="c"> | d</p>'],
    ['an image inside a link or bold carries no mark (the document refuses a marked image)', '[![badge](https://b.example/b.svg)](https://e.example) **![a](ref:abcdef12) b**',
      `<p><img src="https://b.example/b.svg" alt="badge"> <img src="ref:abcdef12" alt="a"><strong> b</strong></p>`],
  ])('%s', (_name, markdown, expected) => {
    expect(html(markdown)).toBe(expected);
    expect(() => createRegionState(kind, expected)).not.toThrow();
  });

  it('a title is cut to 512 characters, as the document stores it', () => {
    expect(html(`![t](ref:abcdef12 "${'t'.repeat(600)}")`)).toBe(`<p><img src="ref:abcdef12" alt="t" title="${'t'.repeat(512)}"></p>`);
  });

  it.each([
    ['http', '![x](http://i.example/p.png)'], ['data', '![x](data:image/png;base64,AA)'], ['javascript', '![x](javascript:alert(1))'], ['protocol-relative', '![x](//host.example/p.png)'],
  ])('an image whose source the document refuses (%s) stays the text it was typed as, never an image', (_name, markdown) => {
    const json = JSON.stringify(nativeMarkdownJson(markdown));
    expect(json).not.toContain('"image"');
    expect(json).toContain('![x](');
  });

  it('an agent\'s write adds an image beside the text it keeps', () => {
    expect(write('<p data-af-id="a">old</p><p data-af-id="b">kept</p>', 'old ![c](https://i.example/c.png)\n\nkept'))
      .toBe('<p data-af-id="a">old <img src="https://i.example/c.png" alt="c"></p><p data-af-id="b">kept</p>');
  });

  it('an edit beside an image keeps the image, its id and every untouched block byte for byte', () => {
    const saved = '<h2 data-af-id="h">Plan</h2><p data-af-id="a">See <img data-af-id="i" src="ref:abcdef12" alt="chart" title="T"> here</p><p data-af-id="z">omega</p>';
    expect(write(saved, regionMarkdown(kind, saved).replace('here', 'there'))).toBe(saved.replace('here', 'there'));
    expect(write(saved, regionMarkdown(kind, saved).replace('omega', 'omega, revised'))).toBe(saved.replace('omega', 'omega, revised'));
  });

  it('an agent\'s write removes an image it leaves out, and changes one whose alt it edits', () => {
    const saved = '<p data-af-id="a">See <img data-af-id="i" src="ref:abcdef12" alt="chart"></p>';
    expect(write(saved, 'See')).toBe('<p data-af-id="a">See</p>');
    expect(write(saved, 'See ![bar chart](ref:abcdef12)')).toBe('<p data-af-id="a">See <img data-af-id="i" src="ref:abcdef12" alt="bar chart"></p>');
  });

  it.each([
    ['an image with alt and title', '<p data-af-id="a">See <img data-af-id="i" src="ref:abcdef12" alt="A &amp; B" title="Chart"> and <img data-af-id="j" src="https://i.example/p.png?a=1&amp;b=2" alt=""></p>'],
    ['sources and text Markdown must escape', '<p data-af-id="a"><img data-af-id="i" src="https://i.example/a(1).png" alt="x [y] *z*" title="say &quot;hi&quot;"> <img data-af-id="j" src="https://i.example/caf%C3%A9.png" alt="café"></p>'],
    ['images in a heading, a list and a quote', '<h2 data-af-id="h"><img data-af-id="i" src="ref:abcdef12" alt="logo"> Title</h2><ul data-af-id="l"><li data-af-id="li"><p data-af-id="lp">item <img data-af-id="j" src="/a/x/raw" alt=""></p></li></ul><blockquote data-af-id="q"><p data-af-id="qp"><img data-af-id="k" src="ref:abcdef12" alt="q"></p></blockquote>'],
  ])('%s: sending back what was read changes nothing', (_name, saved) => {
    const { state, snapshot } = createRegionState(kind, saved);
    const markdown = regionMarkdown(kind, saved);
    const { update } = applyRegionRevision({ kind, live: state, savedSnapshot: snapshot, markdown });
    expect(emptyUpdate(update), markdown).toBe(true);
  });
});
