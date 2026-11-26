/**
 * The display entry's contract: one synthetic fixture per known edge case, parsed and written as the shared markup
 * (services/app/lib/markdown/display.ts). Every fixture here is made up; no stored text is used.
 */
import { describe, expect, it } from 'vitest';
import { renderCodeBlock } from '../code-block';
import { headings, parse, plainText, renderHtml, renderHtmlAsync, type ParseOptions, type Refusal } from '../display';

const html = (markdown: string, options?: ParseOptions) => renderHtml(parse(markdown, options));
const images = { images: true };
const asTyped = (source: string) => `<p>${source.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')}</p>`;

describe('the newline rule', () => {
  it('turns a single newline into a line break by default, and joins lines when breaks is off', () => {
    expect(html('one\ntwo')).toBe('<p>one<br>two</p>');
    expect(html('one\ntwo', { breaks: false })).toBe('<p>one two</p>');
    expect(html('one  \ntwo\\\nthree', { breaks: false })).toBe('<p>one<br>two<br>three</p>');
  });
  it('keeps headings on one line: a break inside a setext heading becomes a space', () => {
    expect(html('one\ntwo\n===')).toBe('<h1 data-mx-markdown-heading="0">one two</h1>');
  });
  it('continues a lazy line inside its quote or list item as a line break', () => {
    expect(html('> quoted\ncontinued')).toBe('<blockquote><p>quoted<br>continued</p></blockquote>');
    expect(html('- item\nlazy')).toBe('<ul data-tight="true"><li><p>item<br>lazy</p></li></ul>');
  });
});

describe('text that must stay text', () => {
  it('reads No., Ok. and I. line starts as prose: ordered markers are digits only', () => {
    expect(html('No. It lives here.\nOk. Fine.\nI. Roman')).toBe('<p>No. It lives here.<br>Ok. Fine.<br>I. Roman</p>');
  });
  it('does not italicise intraword underscores', () => {
    expect(html('snake_case_name and $_me')).toBe('<p>snake_case_name and $_me</p>');
  });
  it('honours backslash escapes', () => {
    expect(html('\\*not italic\\* \\# \\[x\\](y) 1\\. two')).toBe('<p>*not italic* # [x](y) 1. two</p>');
  });
  it('shows raw HTML as literal text', () => {
    expect(html('Hi <script>alert(1)</script> <b>bold</b>')).toBe('<p>Hi &lt;script&gt;alert(1)&lt;/script&gt; &lt;b&gt;bold&lt;/b&gt;</p>');
    expect(html('<div>\nblock\n</div>')).toBe('<p>&lt;div&gt;<br>block<br>&lt;/div&gt;</p>');
  });
  it('decodes numeric and common named entities and leaves rare names as typed', () => {
    expect(html('AT&amp;T &copy; &#65;&#x42; &alpha; &nbsp;.')).toBe('<p>AT&amp;T © AB &amp;alpha;  .</p>');
  });
  it('keeps footnote definitions and references as literal text', () => {
    expect(html('Text[^1].\n\n[^1]: the note')).toBe('<p>Text[^1].</p><p>[^1]: the note</p>');
  });
  it('links bare addresses only with a scheme or www.; file names stay text', () => {
    expect(html('README.md, setup.sh, example.com, a@b.example'))
      .toBe('<p>README.md, setup.sh, example.com, a@b.example</p>');
    expect(html('www.example.com and https://a.example/x.'))
      .toBe('<p><a href="http://www.example.com">www.example.com</a> and <a href="https://a.example/x">https://a.example/x</a>.</p>');
    expect(html('ftp://files.example and //host.example/path')).toBe('<p>ftp://files.example and //host.example/path</p>');
  });
  it('returns one empty paragraph for empty and whitespace-only input', () => {
    for (const source of ['', '   ', '\n\n\t\n']) {
      expect(parse(source)).toEqual({ type: 'doc', content: [{ type: 'paragraph' }] });
      expect(html(source)).toBe('<p></p>');
    }
  });
});

describe('the markup contract', () => {
  it('anchors headings 1-3 in document order and leaves 4-6 plain', () => {
    expect(html('# A\n## B\n#### C\n> ### D\n###### E'))
      .toBe('<h1 data-mx-markdown-heading="0">A</h1><h2 data-mx-markdown-heading="1">B</h2><h4>C</h4>'
        + '<blockquote><h3 data-mx-markdown-heading="2">D</h3></blockquote><h6>E</h6>');
    expect(headings(parse('# A\n## B **b**\n#### C\n### D'))).toEqual([
      { level: 1, title: 'A', index: 0 }, { level: 2, title: 'B b', index: 1 }, { level: 3, title: 'D', index: 2 },
    ]);
  });
  it('writes marks with shared spans, inline code inside bold and links, and never parses code text', () => {
    expect(html('**a `b` c** ~~s~~ *i* [`y`](https://y.example "T")'))
      .toBe('<p><strong>a <code>b</code> c</strong> <s>s</s> <em>i</em> <a href="https://y.example" title="T"><code>y</code></a></p>');
    expect(html('`**a** [b](https://c.example) <i>`')).toBe('<p><code>**a** [b](https://c.example) &lt;i&gt;</code></p>');
    expect(html('[**a** b](/docs)')).toBe('<p><a href="/docs"><strong>a</strong> b</a></p>');
  });
  it('marks tight lists, keeps <p> in items, carries ordered starts', () => {
    expect(html('- a\n- b')).toBe('<ul data-tight="true"><li><p>a</p></li><li><p>b</p></li></ul>');
    expect(html('- a\n\n- b')).toBe('<ul><li><p>a</p></li><li><p>b</p></li></ul>');
    expect(html('3. three\n4. four')).toBe('<ol start="3" data-tight="true"><li><p>three</p></li><li><p>four</p></li></ol>');
    expect(html('1. one\n   - nested')).toBe('<ol data-tight="true"><li><p>one</p><ul data-tight="true"><li><p>nested</p></li></ul></li></ol>');
    expect(html('-\n- b')).toBe('<ul data-tight="true"><li><p></p></li><li><p>b</p></li></ul>');
  });
  it('renders read-only task items and splits a mixed list into groups', () => {
    expect(html('- [ ] todo\n- [x] done\n- plain\n- [X] again'))
      .toBe('<ul class="mx-md-check-list" data-tight="true">'
        + '<li role="checkbox" aria-checked="false" aria-disabled="true"><p>todo</p></li>'
        + '<li role="checkbox" aria-checked="true" aria-disabled="true"><p>done</p></li></ul>'
        + '<ul data-tight="true"><li><p>plain</p></li></ul>'
        + '<ul class="mx-md-check-list" data-tight="true"><li role="checkbox" aria-checked="true" aria-disabled="true"><p>again</p></li></ul>');
    expect(html('- \\[ ] escaped\n1. [ ] ordered')).toBe('<ul data-tight="true"><li><p>[ ] escaped</p></li></ul><ol data-tight="true"><li><p>[ ] ordered</p></li></ol>');
    expect(html('- [ ]')).toBe('<ul class="mx-md-check-list" data-tight="true"><li role="checkbox" aria-checked="false" aria-disabled="true"><p></p></li></ul>');
  });
  it('writes an empty quote as a quote of one empty paragraph, as the editor holds it', () => {
    expect(html('>')).toBe('<blockquote><p></p></blockquote>');
  });
  it('drops an address the rules refuse even from a document parse did not make', () => {
    const doc = { type: 'doc' as const, content: [{ type: 'paragraph', content: [
      { type: 'text', text: 'x', marks: [{ type: 'link' as const, attrs: { href: 'javascript:alert(1)', title: null } }] },
      { type: 'image', attrs: { src: 'http://i.example/p.png', alt: 'a', title: null } }] }] };
    expect(renderHtml(doc, { classifyLink: () => 'kind', imageAddress: src => src })).toBe('<p><a>x</a><img alt="a" loading="lazy"></p>');
  });
  it('writes quotes, rules, breaks and code blocks through the shared highlighter', () => {
    expect(html('> a\n\n---\n\nb  \nc')).toBe('<blockquote><p>a</p></blockquote><hr><p>b<br>c</p>');
    expect(html('```ts\nconst a = 1;\n```')).toBe(renderCodeBlock('const a = 1;', 'ts'));
    expect(html('```sql extra\nselect 1;\n```')).toBe(renderCodeBlock('select 1;', 'sql'));
    expect(html('    indented\n')).toBe('<pre><code>indented</code></pre>');
    expect(parse('```ts {1}\nx\n```').content[0]).toEqual({ type: 'codeBlock', attrs: { language: 'ts' }, content: [{ type: 'text', text: 'x' }] });
  });
  it('writes tables in the scroll wrapper with alignment, escaped pipes in code and <br> breaks', () => {
    expect(html('| a | b | c |\n|:-|-:|:-:|\n| `x\\|y` | 1<br>2 | 3<br/>4 `<br>` |'))
      .toBe('<div class="mx-md-table-scroll"><table><tbody>'
        + '<tr><th style="text-align:left">a</th><th style="text-align:right">b</th><th style="text-align:center">c</th></tr>'
        + '<tr><td style="text-align:left"><code>x|y</code></td><td style="text-align:right">1<br>2</td><td style="text-align:center">3<br>4 <code>&lt;br&gt;</code></td></tr>'
        + '</tbody></table></div>');
    expect(html('| a |\n|---|\n| <br> |\n\nx <br> y')).toBe('<div class="mx-md-table-scroll"><table><tbody><tr><th>a</th></tr><tr><td><br></td></tr></tbody></table></div><p>x &lt;br&gt; y</p>');
  });
  it('recovers older saves that spaced each pipe row into its own paragraph, only when asked', () => {
    const spaced = '| a | b |\n\n| --- | --- |\n\n| 1 | 2 |';
    expect(html(spaced, { recoverSpacedTables: true })).toBe(html('| a | b |\n| --- | --- |\n| 1 | 2 |'));
    expect(html(spaced)).toBe('<p>| a | b |</p><p>| --- | --- |</p><p>| 1 | 2 |</p>');
  });
});

describe('links: one rule, and refused links show as typed', () => {
  it('allows http, https, mailto, tel and relative links', () => {
    for (const href of ['https://a.example/x', 'HTTP://A.EXAMPLE', 'mailto:a@b.example', 'tel:+15551234', '/docs', 'page.md', '#part', '?q=1', ''])
      expect(html(`[x](<${href}>)`), href).toMatch(/^<p><a href="[^"]*">x<\/a><\/p>$/);
  });
  it('shows any other scheme, protocol-relative and hidden schemes as the typed source', () => {
    for (const source of ['[x](javascript:alert(1))', '[x](JaVaScRiPt:alert(1))', '[x](<java\tscript:alert(1)>)',
      '[x](java&Tab;script:alert(1))', '[x](&#106;avascript:alert(1))', '[x](java&#x09;script:alert(1))', '[x](data:text/html,hi)',
      '[x](vbscript:x)', '[x](file:///etc/passwd)', '[x](ftp://host)', '[x](//evil.example/a)', '[x](/\\evil.example)',
      '[x](<javascript&colon;alert(1)>)', '[**bold** label](javascript:x)', '<javascript:alert(1)>', '<ftp://host/x>'])
      expect(html(source), JSON.stringify(source)).toBe(asTyped(source));
    expect(html('[a][r]\n\n[r]: javascript:x')).toBe('<p>[a][r]</p><p>[r]: javascript:x</p>');
  });
  it('shows the typed source once, beside the text around it', () => {
    expect(html('before [x](javascript:y) after *e*')).toBe('<p>before [x](javascript:y) after <em>e</em></p>');
  });
  it('lets the inner link win when links nest, and never nests anchors', () => {
    expect(html('[a [b](https://b.example) c](https://a.example)'))
      .toBe('<p>[a <a href="https://b.example">b</a> c](<a href="https://a.example">https://a.example</a>)</p>');
    expect(html('[a [b](javascript:x) c](https://a.example)')).not.toMatch(/<a[^>]*>[^<]*<a/);
  });
  it('reports what it did not show', () => {
    const refused: Refusal[] = [];
    parse('[x](javascript:y) ![i](http://i.example/p.png)', { images: true, onRefused: refusal => refused.push(refusal) });
    expect(refused).toEqual([
      { kind: 'link', source: '[x](javascript:y)', href: 'javascript:y' },
      { kind: 'image', source: '![i](http://i.example/p.png)', href: 'http://i.example/p.png' },
    ]);
  });
  it('classifies a link href through the caller, so mentions can render as mentions', () => {
    const doc = parse('[@ann](/api/people/u1) and [docs](/docs)');
    expect(renderHtml(doc, { classifyLink: href => (href.startsWith('/api/people/') ? 'person' : null) }))
      .toBe('<p><a href="/api/people/u1" data-mx-link="person">@ann</a> and <a href="/docs">docs</a></p>');
  });
});

describe('images', () => {
  it('render when the source is https, relative or ref:<id>, with alt text and lazy loading', () => {
    expect(html('![An *alt*](https://i.example/p.png "T")', images)).toBe('<p><img src="https://i.example/p.png" alt="An alt" title="T" loading="lazy"></p>');
    expect(html('![a](/raw/p.png) ![b](ref:abc123)', images)).toBe('<p><img src="/raw/p.png" alt="a" loading="lazy"> <img src="ref:abc123" alt="b" loading="lazy"></p>');
    expect(html('[![a](https://i.example/p.png)](https://l.example)', images)).toBe('<p><a href="https://l.example"><img src="https://i.example/p.png" alt="a" loading="lazy"></a></p>');
  });
  it('show any other source as typed', () => {
    for (const source of ['![a](http://i.example/p.png)', '![a](//i.example/p.png)', '![a](javascript:x)', '![a](data:image/png;base64,AAAA)', '![a](ref:no)'])
      expect(html(source, images), source).toBe(asTyped(source).replace('http://i.example/p.png', '<a href="http://i.example/p.png">http://i.example/p.png</a>'));
  });
  it('show as typed when the surface turns the image element off', () => {
    expect(html('![a](/p.png)')).toBe('<p>![a](/p.png)</p>');
    expect(html('![a](/p.png)', { images: false })).toBe('<p>![a](/p.png)</p>');
  });
  it('map each source through the image-address function, which may be asynchronous', async () => {
    const doc = parse('![a](https://i.example/p.png) ![b](ref:abc123) ![c](https://i.example/p.png)', images);
    expect(renderHtml(doc, { imageAddress: src => `/a/doc/assets?u=${encodeURIComponent(src)}` }))
      .toBe('<p><img src="/a/doc/assets?u=https%3A%2F%2Fi.example%2Fp.png" alt="a" loading="lazy"> <img src="/a/doc/assets?u=ref%3Aabc123" alt="b" loading="lazy"> <img src="/a/doc/assets?u=https%3A%2F%2Fi.example%2Fp.png" alt="c" loading="lazy"></p>');
    const asked: string[] = [];
    const address = async (src: string) => { const order = asked.push(src); await Promise.resolve(); return `blob:${order}`; };
    expect(await renderHtmlAsync(doc, { imageAddress: address })).toBe('<p><img src="blob:1" alt="a" loading="lazy"> <img src="blob:2" alt="b" loading="lazy"> <img src="blob:1" alt="c" loading="lazy"></p>');
    expect(asked).toEqual(['https://i.example/p.png', 'ref:abc123']);
    expect(await renderHtmlAsync(doc)).toBe(renderHtml(doc));
  });
});

describe('plain text', () => {
  it('takes the markup off for previews: blocks and breaks on their own lines, alt text for images', () => {
    expect(plainText(parse('# Title\n\nA **bold** `code` [link](/x)\nnext\n\n- one\n- [x] two\n\n> quoted\n\n```\ncode block\n```\n\n| a | b |\n|-|-|\n| 1 | 2 |\n\n![alt](/p.png)', images)))
      .toBe('Title\nA bold code link\nnext\none\ntwo\nquoted\ncode block\na b\n1 2\nalt');
    expect(plainText(parse(''))).toBe('');
  });
});
