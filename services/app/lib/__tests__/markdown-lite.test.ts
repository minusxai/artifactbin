/**
 * MARKDOWN-LITE — the strict subset comment bodies may use.
 *
 * Two things are being pinned here and they pull in opposite directions: the
 * subset must be RICH enough that an agent's reply naming files, functions and
 * a regex reads as prose with code in it, and NARROW enough that a body which
 * is not markdown at all still reads as exactly what was typed. So every
 * construct has a partner test for its unterminated form, `<script>` is a
 * word, and a link whose scheme is not one of three is the source line.
 *
 * The parser is the only guard: the renderer emits React elements, so there is
 * no escaping step to get wrong — but there is also nothing downstream to save
 * a `javascript:` href that this module hands out.
 */
import { describe, it, expect } from 'vitest';
import { parseMarkdownLite, plainText, safeHref, wrapSelection, type MdNode } from '../markdown-lite';

/** The tests read blocks by shape, so a tiny reader keeps them legible. */
const para = (nodes: MdNode[], at = 0) => {
  const node = nodes[at];
  if (node?.kind !== 'paragraph') throw new Error(`block ${at} is ${node?.kind}`);
  return node.children;
};

describe('blocks', () => {
  it('splits paragraphs on a blank line and keeps a single newline as a hard break', () => {
    const nodes = parseMarkdownLite('first line\nsecond line\n\nnew paragraph');
    expect(nodes).toHaveLength(2);
    expect(para(nodes).map((n) => n.kind)).toEqual(['text', 'break', 'text']);
    expect(plainText(nodes)).toBe('first line\nsecond line\nnew paragraph');
  });

  it('takes two trailing spaces as the same hard break, without leaving them in the text', () => {
    const nodes = parseMarkdownLite('call it  \nthen return');
    expect(para(nodes)).toEqual([
      { kind: 'text', text: 'call it' },
      { kind: 'break' },
      { kind: 'text', text: 'then return' },
    ]);
  });

  it('reads a fenced block with its language, verbatim', () => {
    const nodes = parseMarkdownLite('before\n\n```ts\nconst a = 1;\n  const b = 2;\n```\n\nafter');
    expect(nodes[1]).toEqual({ kind: 'code_block', lang: 'ts', text: 'const a = 1;\n  const b = 2;' });
    expect(nodes).toHaveLength(3);
  });

  it('runs an UNTERMINATED fence to the end of the body — a fence, never prose', () => {
    const nodes = parseMarkdownLite('look:\n\n```\nnpm test\nstill inside');
    expect(nodes).toHaveLength(2);
    expect(nodes[1]).toEqual({ kind: 'code_block', lang: null, text: 'npm test\nstill inside' });
  });

  it('reads bullet and ordered lists, and one level of nesting under an item', () => {
    const nodes = parseMarkdownLite('- one\n- two\n  - two point one\n\n1. first\n2. second');
    const bullets = nodes[0];
    if (bullets?.kind !== 'list') throw new Error('expected a list');
    expect(bullets.ordered).toBe(false);
    expect(bullets.items).toHaveLength(2);
    const nested = bullets.items[1].children[1];
    expect(nested?.kind).toBe('list');
    expect(plainText([bullets])).toBe('one\ntwo\ntwo point one');

    const ordered = nodes[1];
    if (ordered?.kind !== 'list') throw new Error('expected an ordered list');
    expect(ordered.ordered).toBe(true);
    expect(ordered.items).toHaveLength(2);
  });

  it('reads a quote, and code INSIDE a quote', () => {
    const nodes = parseMarkdownLite('> run `npm test` first\n> then push');
    const quote = nodes[0];
    if (quote?.kind !== 'quote') throw new Error('expected a quote');
    expect(quote.children).toHaveLength(1);
    expect(para(quote.children).some((n) => n.kind === 'code' && n.text === 'npm test')).toBe(true);
  });

  it('bounds quote nesting rather than recursing on every ">" it is given', () => {
    const nodes = parseMarkdownLite(`${'> '.repeat(500)}deep`);
    expect(nodes).toHaveLength(1);
    expect(plainText(nodes)).toBe('deep');
  });
});

describe('inline', () => {
  it('reads bold, italic (both markers) and inline code', () => {
    const nodes = parseMarkdownLite('**bold** and _slanted_ and *also* and `code()`');
    expect(para(nodes).map((n) => n.kind)).toEqual(['strong', 'text', 'em', 'text', 'em', 'text', 'code']);
  });

  it('nests bold inside a list item', () => {
    const nodes = parseMarkdownLite('- fix **lib/config.ts** now');
    const list = nodes[0];
    if (list?.kind !== 'list') throw new Error('expected a list');
    const inline = list.items[0].children[0];
    if (inline?.kind !== 'paragraph') throw new Error('expected a paragraph in the item');
    expect(inline.children[1]).toEqual({ kind: 'strong', children: [{ kind: 'text', text: 'lib/config.ts' }] });
  });

  /*
   * A RUN'S FULL FENCE MAY FAIL WHERE A SHORTER ONE INSIDE IT MATCHES, so the
   * parser may never skip past a run it could not close whole. These three are
   * the exact trees the parser produced BEFORE the run-measurement rewrite
   * (measured on the previous implementation) — they are here so "faster"
   * cannot quietly become "different".
   */
  it('a sub-fence inside an unclosed run still matches — byte for byte', () => {
    expect(parseMarkdownLite('``x`')[0]).toEqual({
      kind: 'paragraph',
      children: [{ kind: 'text', text: '`' }, { kind: 'code', text: 'x' }],
    });
    expect(parseMarkdownLite('``a`b`')[0]).toEqual({
      kind: 'paragraph',
      children: [{ kind: 'text', text: '`' }, { kind: 'code', text: 'a' }, { kind: 'text', text: 'b`' }],
    });
    expect(parseMarkdownLite('y``x`')[0]).toEqual({
      kind: 'paragraph',
      children: [{ kind: 'text', text: 'y`' }, { kind: 'code', text: 'x' }],
    });
  });

  it('leaves an unterminated marker exactly as typed', () => {
    expect(plainText(parseMarkdownLite('2 * 3 and a lone ` backtick'))).toBe('2 * 3 and a lone ` backtick');
    expect(para(parseMarkdownLite('2 * 3 and a lone ` backtick'))).toEqual([
      { kind: 'text', text: '2 * 3 and a lone ` backtick' },
    ]);
  });

  it('reads an http/https/mailto link', () => {
    const nodes = parseMarkdownLite('see [the docs](https://artifactbin.dev/docs) or [mail](mailto:a@b.c)');
    const link = para(nodes)[1];
    expect(link).toEqual({ kind: 'link', href: 'https://artifactbin.dev/docs', children: [{ kind: 'text', text: 'the docs' }] });
    expect(para(nodes)[3]).toMatchObject({ kind: 'link', href: 'mailto:a@b.c' });
  });

  it('a javascript: link is TEXT — the source line, visible and unclickable', () => {
    const source = 'click [here](javascript:alert(1)) now';
    const nodes = parseMarkdownLite(source);
    expect(para(nodes).every((n) => n.kind === 'text')).toBe(true);
    expect(plainText(nodes)).toBe(source);
  });

  it('a scheme hidden behind control characters or case is still refused', () => {
    expect(safeHref('JavaScript:alert(1)')).toBeNull();
    expect(safeHref('java\tscript:alert(1)')).toBeNull();
    expect(safeHref('  javascript:alert(1)')).toBeNull();
    expect(safeHref('/relative/path')).toBeNull();
    expect(safeHref('data:text/html,<script>')).toBeNull();
    expect(safeHref('HTTPS://ArtifactBin.dev/a')).toBe('HTTPS://ArtifactBin.dev/a');
  });

  it('raw HTML is TEXT: `<` is a character, never a tag', () => {
    const nodes = parseMarkdownLite('<script>alert(1)</script> and <b>not bold</b>');
    expect(para(nodes)).toEqual([{ kind: 'text', text: '<script>alert(1)</script> and <b>not bold</b>' }]);
    expect(plainText(nodes)).toBe('<script>alert(1)</script> and <b>not bold</b>');
  });
});

describe('plainText — what the compact surfaces show', () => {
  it('reads an agent reply with code and a list as one flat sentence-shaped string', () => {
    const body = 'Fixed in `lib/config.ts`:\n\n```ts\nconst max = 10;\n```\n\n- bumped the cap\n- added a test';
    expect(plainText(parseMarkdownLite(body))).toBe(
      'Fixed in lib/config.ts:\nconst max = 10;\nbumped the cap\nadded a test',
    );
  });
});

describe('wrapSelection — the composer toolbar', () => {
  it('wraps the selection for bold, italic and code, and answers the caret to restore', () => {
    expect(wrapSelection('make it loud', 8, 12, 'bold')).toEqual({ text: 'make it **loud**', start: 10, end: 14 });
    expect(wrapSelection('make it loud', 8, 12, 'italic')).toEqual({ text: 'make it _loud_', start: 9, end: 13 });
    expect(wrapSelection('call foo now', 5, 8, 'code')).toEqual({ text: 'call `foo` now', start: 6, end: 9 });
  });

  it('inserts empty markers at a caret with nothing selected', () => {
    expect(wrapSelection('ab', 1, 1, 'bold')).toEqual({ text: 'a****b', start: 3, end: 3 });
  });

  it('a second press UNWRAPS what the first wrapped', () => {
    const once = wrapSelection('make it loud', 8, 12, 'bold');
    expect(wrapSelection(once.text, once.start, once.end, 'bold')).toEqual({ text: 'make it loud', start: 8, end: 12 });
  });

  it('link seeds a template and selects the url for typing over', () => {
    const linked = wrapSelection('see the docs', 4, 12, 'link');
    expect(linked.text).toBe('see [the docs](url)');
    expect(linked.text.slice(linked.start, linked.end)).toBe('url');
  });

  it('list is a LINE verb: it marks every line the selection touches', () => {
    const listed = wrapSelection('one\ntwo\nthree', 0, 7, 'list');
    expect(listed.text).toBe('- one\n- two\nthree');
    const fromCaret = wrapSelection('one\ntwo', 5, 5, 'list');
    expect(fromCaret.text).toBe('one\n- two');
  });
});

describe('bounded', () => {
  /*
   * THE PATH MATTERS MORE THAN THE SIZE. A pathological run alone on its own
   * line never reaches `parseInline` at all — a line of backticks is eaten by
   * FENCE_RE as a code fence first — so the budget has to be measured on runs
   * sitting INSIDE a paragraph, which is where a comment's backticks actually
   * live. The earlier version of this test measured the fence path and passed
   * while the inline path took 156 ms.
   */
  const fastest = (body: string) => {
    const runs = [0, 0, 0].map(() => {
      const started = performance.now();
      const nodes = parseMarkdownLite(body);
      const elapsed = performance.now() - started;
      expect(nodes.length).toBeGreaterThan(0);
      return elapsed;
    }).sort((a, b) => a - b);
    return runs[1]; // the median of three — a shared laptop has outliers
  };

  it('a 10 KB body of pathological runs INSIDE a paragraph parses well under 10 ms', () => {
    // "x" in front of each run so the line is a paragraph, not a fence.
    const body = `${'the quick brown fox jumps over the lazy dog. '.repeat(120)}\n\n`
      + `x${'*'.repeat(2000)}\n\nx${'`'.repeat(2000)}\n\nx${'_'.repeat(2000)}`;
    expect(body.length).toBeGreaterThan(9000);
    expect(fastest(body)).toBeLessThan(10);
  });

  it('a 10 KB inline backtick run — the shape that was quadratic — parses under 10 ms', () => {
    const body = `x${'`'.repeat(10_000)}`;
    expect(fastest(body)).toBeLessThan(10);
  });

  it('and 16,000 of them stay under 20 ms — the growth is not 4x per doubling', () => {
    const body = `x${'`'.repeat(16_000)}`;
    expect(fastest(body)).toBeLessThan(20);
  });

  it('a run whose fence never closes is still measured once, not once per backtick', () => {
    // The memory half: the old code built one fence string per position, so a
    // 3,000-backtick run constructed 4.5M characters before finding nothing.
    const body = `x${'`'.repeat(3000)} and then ${'plain words '.repeat(400)}`;
    expect(fastest(body)).toBeLessThan(10);
  });
});
