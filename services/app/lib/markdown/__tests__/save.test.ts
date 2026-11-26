/**
 * Saving (services/app/lib/markdown/serialize.ts): canonical text comes back byte for byte, and any parsed document
 * reads back as the same document (a seeded property run over generated Markdown). Synthetic text only.
 */
import { describe, expect, it } from 'vitest';
import type { Node as PMNode } from 'prosemirror-model';
import { markdownSchema, parse, serialize } from '../editor';
import type { ParseOptions } from '../display';

const schemas = { plain: markdownSchema(), images: markdownSchema({ images: true }) };
const doc = (markdown: string, options: ParseOptions = {}): PMNode => (options.images ? schemas.images : schemas.plain).nodeFromJSON(parse(markdown, options));
const save = (markdown: string, options: ParseOptions = {}) => serialize(doc(markdown, options), { breaks: options.breaks ?? true });
const readsBack = (markdown: string, options: ParseOptions = {}) => {
  const first = doc(markdown, options);
  const saved = serialize(first, { breaks: options.breaks ?? true });
  return { first, saved, again: doc(saved, options) };
};

describe('no-edit identity: canonical text saves byte for byte', () => {
  const canonical = [
    '# Heading\n\nA paragraph with **bold**, *italic*, ~~strike~~, `code` and [a link](https://a.example "Title").',
    '- one\n- two\n  - nested\n- three',
    '- loose\n\n- list',
    '3. three\n4. four',
    '1. one\n\n   second paragraph\n\n2. two',
    '- [ ] todo\n- [x] done',
    '- [ ] todo\n- plain\n- [x] done',
    '- a\n\n* separate list',
    '> quote\n>\n> second',
    '````md\n```js\nx\n```\n````',
    '```ts\nconst a = 1;\n```',
    'above\n\n---\n\nbelow',
    'line one\nline two\n\\\nafter two breaks',
    '| a | b | c |\n| :-- | --: | :-: |\n| 1 | `x\\|y` | 2<br>3 |',
    '\\# not a heading, \\*not italic\\* and 5 * 3 = snake_case',
    'Text[^1].\n\n[^1]: the note stays text',
    'See https://a.example/x and www.example.com.',
    'AT&T and \\&copy; stay as typed; &alpha; too',
    'A [refused\\](javascript:x) link stays as typed',
    '**`code` in bold** and [`code` in a link](/docs)',
    '#### Four\n\n###### Six',
  ];
  it.each(canonical)('%j', markdown => { expect(save(markdown)).toBe(markdown); });
  it('keeps images, ref: uploads and their titles', () => {
    for (const markdown of ['![alt](https://i.example/p.png)', '![a](ref:abc123 "T") and ![b](/raw/p.png)']) expect(save(markdown, { images: true })).toBe(markdown);
  });
  it('writes backslash breaks when breaks is off', () => {
    expect(save('one\\\ntwo', { breaks: false })).toBe('one\\\ntwo');
  });
});

describe('a saved document reads back as the same document', () => {
  const edgeCases = [
    'No. It lives here.\nOk. Fine.\nI. Roman', '1) paren list', '- a\n+ b', '* star', '+ plus',
    'a\n# not heading\n> not quote\n- not item\n1. not item\n---\n===\n| a |\n|---|\n```\n~~~\n    indented',
    'trailing  \nspaces\t\nand nbsp', ' leading space', 'a **b ** c', '** x**', '*a*b', 'a*b*c', '**a.**&#98;', '&#98;**.a**',
    '`` `tick` ``', '` a `', '`  `', 'a\\', '\\\\', '[a]', '[a] (b)', '[a]: /def\n\n[a]', '[^note]: x', '![not image', 'x![y](z)',
    '[a](<b c>)', '[a](b(c))', '[a](https://x.example "t \\"q\\"")', '<https://a.example/x?y=1&z=2>', 'mailto:a@b.example', 'www.a.example/path_(x)',
    '- [ ] \n- [x]', '- \\[x] not a task', '1. [ ] ordered', '- # heading item\n- ```\n  code\n  ```', '- > quote item',
    '| a |\n|---|\n| \\| pipe |\n| <br> |\n| `|` |', '| a | b |\n|---|---|\n| only one |',
    '# Heading #\n## C#\n### a \\#', '#', '# ', 'Setext\n---', 'Setext\n===',
    '&amp; &lt;b&gt; &#x41; &copy; &bogus;', 'a <b>c</b> <https://x.example> <a@b.example>', '<br> outside a table',
    '~~a~~b~c~~~', '~5 minutes', 'emoji 🌻 and **bold 🌻**', '\t\ttabs', 'a\n\n\n\nb', '> a\nb\n\n> c', '- a\nb',
    '>>> deep\n> > > deeper', '1. a\n   1. b\n      1. c', '- a\n\n  b\n- c', '````\n```\n````', '```js title\nx\n```',
  ];
  it.each(edgeCases)('%j', markdown => {
    const { first, saved, again } = readsBack(markdown);
    expect(again.toJSON(), saved).toEqual(first.toJSON());
  });

  it('holds over seeded generated Markdown', () => {
    // mulberry32: a fixed seed, so every run sees the same inputs.
    let seed = 0x5eed1;
    const random = () => { seed |= 0; seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
    const pick = <T>(list: readonly T[]): T => list[Math.floor(random() * list.length)]!;
    const inline = ['word', 'two words', ' ', '  ', '*', '_', '**', '__', '`', '``', '~', '~~', '[', ']', '(', ')', '!', '#', '\\', '&amp;', '&copy;',
      '&alpha;', '<', '>', '|', ':', '.', '1.', '-', '+', '=', 'https://a.example/p', 'www.b.example', 'README.md', '[x](https://y.example)',
      '[t](/p "T")', '**bold**', '*em*', '~~del~~', '`code`', '**`c`**', '[`c`](/c)', '\n', '  \n', '\\\n', '<br>', '[^1]', 'snake_case', '$_x',
      '***', '<https://x.example>', '\t', '“q”', '—', 'a.', '.a', '*a', 'a*', '[a]', '](', '![', '<a@b.example>', '&#32;', '&nbsp;', '    ', ':-:', '|---|',
      '- ', '> ', '# ', '1. ', '```', '~~~', '![i](/p.png)', '![j](https://i.example/j.png "J")'];
    const blockStarts = ['', '', '', '# ', '## ', '> ', '- ', '* ', '1. ', '3) ', '- [ ] ', '- [x] ', '    ', '   '];
    const block = (depth: number): string => {
      const kind = random();
      if (kind < 0.08) return '```' + pick(['', 'ts', 'md']) + '\n' + Array.from({ length: 1 + Math.floor(random() * 3) }, () => pick(inline)).join('') + '\n```';
      if (kind < 0.12) return '| a | b |\n| ' + pick(['---', ':--', '--:']) + ' | --- |\n| ' + pick(inline) + ' | ' + pick(inline) + ' |';
      if (kind < 0.15) return pick(['---', '***', '* * *']);
      const start = pick(blockStarts);
      const text = Array.from({ length: 1 + Math.floor(random() * 6) }, () => pick(inline)).join(pick(['', ' ']));
      const nested = depth < 2 && /^(- |\* |1\. |> )/.test(start) && random() < 0.3 ? '\n' + ' '.repeat(start.startsWith('1') ? 3 : 2) + block(depth + 1).replace(/\n/g, '\n' + ' '.repeat(start.startsWith('1') ? 3 : 2)) : '';
      return start + text + nested;
    };
    const failures: Array<{ markdown: string; saved: string }> = [];
    for (let run = 0; run < 1000; run++) {
      const markdown = Array.from({ length: 1 + Math.floor(random() * 4) }, () => block(0)).join(pick(['\n', '\n\n']));
      const options = { images: random() < 0.5, breaks: random() < 0.8 };
      const { first, saved, again } = readsBack(markdown, options);
      if (!again.eq(first)) failures.push({ markdown, saved });
    }
    expect(failures.length, JSON.stringify(failures.slice(0, 8), null, 1)).toBe(0);
  });
});
