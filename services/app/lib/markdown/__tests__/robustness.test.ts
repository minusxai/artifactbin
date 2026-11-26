/**
 * Hostile and deep input (the cases from the scoping experiments): the whole display pipeline and saving finish
 * within a generous ceiling, scale linearly, never crash, and lose no word, however deep the nesting. No millisecond
 * asserts: a ceiling seconds wide and a ratio between two sizes, bounded far below quadratic.
 */
import { describe, expect, it } from 'vitest';
import { NESTING_CAP, parse, plainText, renderHtml } from '../display';
import { markdownSchema, serialize } from '../editor';
import { SAMPLES } from './samples';

const HOSTILE: Record<string, (n: number) => string> = {
  'asterisks': n => '*'.repeat(n),
  'alternating *a': n => '*a'.repeat(n),
  'nested quotes': n => `${'>'.repeat(n)} x`,
  'nested lists': n => Array.from({ length: n }, (_, i) => `${'  '.repeat(i)}- x`).join('\n'),
  'brackets': n => '['.repeat(n),
  'links': n => '[a](b '.repeat(n),
  'emphasis mix': n => '**_~~`'.repeat(n),
  'html-ish': n => '<a '.repeat(n),
  'backticks': n => '`'.repeat(n),
  'table rows': n => `| a | b |\n|---|---|\n${'| 1 | 2 |\n'.repeat(n)}`,
  'urls': n => 'https://a.example/x '.repeat(n),
  'entities': n => '&amp;&alpha;&#65;'.repeat(n),
  'prose': n => 'word '.repeat(n),
};
/** The experiments' sizes: the 1 MB prose and 2,000-deep list among them. */
const FULL: Record<string, number> = { 'asterisks': 10_000, 'alternating *a': 20_000, 'nested quotes': 5_000, 'nested lists': 2_000, 'brackets': 20_000, 'links': 5_000, 'emphasis mix': 8_000, 'html-ish': 20_000, 'backticks': 16_000, 'table rows': 2_000, 'urls': 10_000, 'entities': 10_000, 'prose': 200_000 };
const schema = markdownSchema({ images: true });
const display = (markdown: string) => { const doc = parse(markdown, { images: true }); return renderHtml(doc).length + plainText(doc).length; };
const time = (run: () => unknown) => { let best = Infinity; for (let i = 0; i < 3; i++) { const start = performance.now(); run(); best = Math.min(best, performance.now() - start); } return best; };

describe('hostile input', () => {
  it.each(Object.keys(HOSTILE))('%s: displays and saves within a generous ceiling', name => {
    const markdown = HOSTILE[name]!(FULL[name]!);
    const start = performance.now();
    expect(display(markdown)).toBeGreaterThan(0);
    expect(typeof serialize(schema.nodeFromJSON(parse(markdown, { images: true })))).toBe('string');
    expect(performance.now() - start).toBeLessThan(5_000);
  });
  it.each(Object.keys(HOSTILE))('%s: time grows with the input, not with its square', name => {
    const small = HOSTILE[name]!(FULL[name]! / 16), large = HOSTILE[name]!(FULL[name]!);
    display(small);
    // Linear work takes about `growth` (~16) times as long, quadratic about its square (~256). The bound sits at half
    // the square: eight times linear, so a loaded machine's noise cannot fail it while quadratic growth still does.
    const growth = large.length / small.length;
    const ratio = time(() => display(large)) / Math.max(time(() => display(small)), 2);
    expect(ratio).toBeLessThan(growth * growth / 2);
  });
});

describe('no text is lost', () => {
  const words = (text: string) => text.match(/[A-Za-z]+\d+/g) ?? [];
  const deepList = (depth: number) => Array.from({ length: depth }, (_, i) => `${'  '.repeat(i)}- w${i}`).join('\n');
  const deepQuote = (depth: number) => Array.from({ length: depth }, (_, i) => `${'>'.repeat(i + 1)} q${i}`).join('\n');
  const mixed = (depth: number) => Array.from({ length: depth }, (_, i) => `${'  '.repeat(i)}${i % 2 ? '>' : '-'} m${i}`).join('\n');
  it.each([
    ['30-deep list', deepList(30)], ['30-deep quote', deepQuote(30)], ['30-deep list and quote', mixed(30)],
    [`a list ${NESTING_CAP} deep (past the cap)`, deepList(NESTING_CAP)], ['a 2,000-deep list', deepList(2_000)],
    ['a 600-deep quote', deepQuote(600)], ['a 5,000-deep quote', `${'>'.repeat(5_000)} last1`],
  ])('keeps every word of %s', (_name, markdown) => {
    const shown = plainText(parse(markdown));
    expect(words(shown)).toEqual(words(markdown));
  });
  it('keeps every word of every sample', () => {
    for (const [name, markdown] of SAMPLES) {
      const shown = plainText(parse(markdown, { images: true }));
      // Words of the text, not of link and image addresses.
      for (const word of markdown.replace(/\]\([^)]*\)/g, '](').match(/\b[a-z]+[0-9]+\b/g) ?? []) expect(shown, name).toContain(word);
    }
  });
});
