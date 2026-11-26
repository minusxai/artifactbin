/**
 * Synthetic Markdown covering every shared element and the known edge cases, for the tests that must hold for all
 * of them (display markup equals the editor's, mounting changes nothing, every word survives). Made up; no stored text.
 */
const deepList = (depth: number) => Array.from({ length: depth }, (_, i) => `${'  '.repeat(i)}- level${i}`).join('\n');
const deepQuote = (depth: number) => Array.from({ length: depth }, (_, i) => `${'>'.repeat(i + 1)} quote${i}`).join('\n');

export const SAMPLES: ReadonlyArray<readonly [string, string]> = [
  ['empty', ''],
  ['whitespace only', '  \n\t\n'],
  ['headings', '# One\n\n## Two\n\n### Three\n\n#### Four\n\n##### Five\n\n###### Six'],
  ['setext headings', 'Title\n=====\n\nSub\n---'],
  ['marks', 'Some **bold**, *italic*, ~~strike~~, `code` and ***both***.'],
  ['shared mark spans', '**a `b` [c](https://c.example) d** and [**e** `f`](/g "G")'],
  ['code in bold and links', '**`x`** [`y`](https://y.example) *`z`* ~~`w`~~'],
  ['code text unparsed', '`**a** [b](c) <i> &amp;`'],
  ['links', 'See [the docs](https://example.com/a?b=1 "Docs"), <https://auto.example>, www.example.com, mailto:a@b.example and [rel](/x#y).'],
  ['classified links', '[@ann](/api/people/u1) and [@bot](/api/people/u2) [plain](/plain)'],
  ['refused links', '[x](javascript:alert(1)) [y](data:text/html,hi) [z](//host.example) <ftp://f.example>'],
  ['file names', 'README.md, setup.sh and example.com stay text'],
  ['raw html', 'Hi <script>alert(1)</script> <b>bold</b>\n\n<div>block</div>'],
  ['entities', 'AT&amp;T &copy; &#65; &alpha; 5 < 6 > 4 &nbsp;x'],
  ['escapes', '\\*not italic\\* \\# \\[x\\](y) 1\\. two \\\\ back'],
  ['no-dot lines', 'No. It lives here.\nOk. Fine.\nI. Roman'],
  ['intraword', 'snake_case_name and $_me and 2*3*4'],
  ['footnotes', 'Text[^1].\n\n[^1]: the note'],
  ['soft and hard breaks', 'one\ntwo  \nthree\\\nfour\n\\\nfive'],
  ['bullet list', '- one\n- two\n  - nested\n  - nested two\n- three'],
  ['loose list', '- one\n\n- two\n\n  second paragraph'],
  ['ordered list', '3. three\n4. four\n\n1) one'],
  ['empty items', '-\n- b\n-'],
  ['task list', '- [ ] todo\n- [x] done\n  - [ ] nested todo\n  - [X] nested done'],
  ['mixed task list', '- [ ] todo\n- plain\n- [x] done'],
  ['task text', '- [ ] **bold** task with `code`\n- [x]'],
  ['list item blocks', '- # heading item\n- ```js\n  code()\n  ```\n- > quote item\n- ---'],
  ['lazy lines', '> quoted\ncontinued\n\n- item\nlazy'],
  ['quote', '> quoted **text**\n>\n> second para\n>\n> > nested'],
  ['code blocks', '```ts\nconst a: number = 1; // note\n```\n\n```html\n<div class="x">y</div>\n```\n\n```md\n# H **b**\n```\n\n```css\n.a { color: red; }\n```'],
  ['code block plain', '```\nplain <b>\n```\n\n```sql\nselect 1;\n```\n\n    indented\n\n```\n```'],
  ['code block trailing blank line', '```js\nx\n\n```'],
  ['hr', 'above\n\n---\n\nbelow\n\n***'],
  ['table', '| a | b | c |\n| :-- | --: | :-: |\n| 1 | **2** | `x\\|y` |\n| 3<br>4 | [l](/l) |  |'],
  ['table break only', '| a |\n| --- |\n| <br> |\n| a<br> |'],
  ['table in list', '- item\n\n  | a | b |\n  | --- | --- |\n  | 1 | 2 |'],
  ['images', '![alt](https://i.example/p.png "T") ![b](/raw/p.png) ![c](ref:abc123)'],
  ['image in link', '[![a](https://i.example/p.png)](https://l.example)'],
  ['image end of line', 'text ![a](/p.png)\n![b](/q.png)'],
  ['refused images', '![a](http://i.example/p.png) ![b](//i.example/p.png) ![c](javascript:x)'],
  ['heading with image and marks', '## **Bold** ![i](/i.png) `c`'],
  ['deep list', deepList(30)],
  ['deep quote', deepQuote(30)],
  ['long line', 'word '.repeat(200)],
];

/**
 * Entity text and its shared markup, the same in Node, jsdom and a browser bundle: numeric and common named
 * references decode, rare names stay as typed, and a reference hidden in a scheme decodes before the link check.
 */
export const ENTITY_SAMPLES: readonly string[] = [
  '&amp; &lt; &gt; &quot; &apos; &nbsp; &copy; &mdash; &hellip; &check;',
  '&#65; &#x42; &#X43; &#0; &#xD800; &#1114112; &#128512;',
  '&alpha; &Alpha; &AMP; &amp &unknown; &#; &#x;',
  '[a](x&alpha;y) [b](x&amp;y "t&copy;") [c](java&Tab;script:x) [d](java&colon;x)',
  '```&alpha;\nx\n```',
];
export const ENTITY_HTML: readonly string[] = [
  '<p>&amp; &lt; &gt; " \' \u00a0 © — … ✓</p>',
  '<p>A B C \ufffd \ufffd \ufffd 😀</p>',
  '<p>&amp;alpha; &amp;Alpha; &amp;AMP; &amp;amp &amp;unknown; &amp;#; &amp;#x;</p>',
  '<p><a href="x&amp;alpha;y">a</a> <a href="x&amp;y" title="t©">b</a> [c](java&amp;Tab;script:x) [d](java&amp;colon;x)</p>',
  '<pre><code>x</code></pre>',
];
