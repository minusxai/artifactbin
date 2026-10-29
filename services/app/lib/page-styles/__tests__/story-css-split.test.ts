/**
 * A document's compiled Tailwind as the union's shared shards plus its own additions
 * (lib/page-styles/story-css-split): what is shared, what stays inline, and when a shard is carried inline
 * because moving a rule would change the cascade. Real compiles, not hand-written sheets.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { compileStoryCss } from '@/lib/story-design/server';
import { storyThemeCss } from '@/lib/story-design/story-themes';
import { cssUnits, declaredProperties, isVariantUtility, orderMatters, relatedProperties, variantOf } from '../css-units';
import { splitStoryCss, storyCssBase, STORY_CSS_SHARDS, type StorySegment, type StoryCssBase } from '../story-css-split';

const compile = async (classes: string): Promise<string> => (await compileStoryCss(`<div class="${classes}"></div>`))!;
let base: StoryCssBase;
let union: string;
beforeAll(async () => {
  union = await compile('');
  base = storyCssBase(union, storyThemeCss())!;
});

/** The rules a document applies, in order: what its segments say. */
const applied = (segments: readonly StorySegment[]): string[] =>
  segments.flatMap((segment) => ('shard' in segment ? cssUnits(base.shards[segment.shard]!) : cssUnits(segment.inline)));
const bodyUnits = (full: string): string[] => cssUnits(full.slice(0, full.length - base.themes.length - 1));
const inlineText = (segments: readonly StorySegment[]): string => segments.flatMap((s) => ('inline' in s ? [s.inline] : [])).join('\n');
const shardsLinked = (segments: readonly StorySegment[]): number[] => segments.flatMap((s) => ('shard' in s ? [s.shard] : []));

describe('cssUnits', () => {
  it('splits comments, statements and nested blocks, and is not fooled by braces and semicolons in strings and urls', () => {
    const css = '/*! v1 */ @import "a;b"; .a { content: "}"; background: url(data:image/svg+xml;utf8,<svg>{}</svg>) } @media (x) { .b { c: d } .e { f: g } }\n:root{--x:1}';
    expect(cssUnits(css)).toEqual([
      '/*! v1 */', '@import "a;b";', '.a { content: "}"; background: url(data:image/svg+xml;utf8,<svg>{}</svg>) }',
      '@media (x) { .b { c: d } .e { f: g } }', ':root{--x:1}',
    ]);
  });
  it('ends an unbalanced sheet at its end instead of throwing', () => {
    expect(cssUnits('.a { b: c ')).toEqual(['.a { b: c']);
  });
  it('reads the variant of a Tailwind utility from its escaped class and the declared properties of nested rules', () => {
    expect(variantOf('.px-4 { padding-inline: 1rem }')).toBe('');
    expect(variantOf('.\\@2xl\\:px-8 { @container (width >= 42rem) { padding-inline: 2rem } }')).toBe('\\@2xl');
    expect(variantOf('.dark\\:hover\\:bg-x { color: red }')).toBe('dark\\:hover');
    expect(isVariantUtility('.md\\:flex { @media (width >= 48rem) { display: flex } }')).toBe(true);
    expect([...declaredProperties('.\\@2xl\\:px-8 { @container (width >= 42rem) { padding-inline: 2rem !important; --tw-x: 1 } &:hover { color: red } }')].sort())
      .toEqual(['--tw-x', 'color', 'padding-inline']);
  });
  it('relates a property to its shorthands and longhands, and nothing else', () => {
    for (const [a, b] of [['padding-top', 'padding'], ['padding-block', 'padding-top'], ['margin-inline', 'margin-left'], ['top', 'inset'], ['inset-inline', 'left'],
      ['border-top-width', 'border'], ['border-color', 'border-left-color'], ['gap', 'row-gap'], ['overflow', 'overflow-x'], ['background', 'background-color'], ['font', 'line-height']]) {
      expect(relatedProperties(a!, b!), `${a} ~ ${b}`).toBe(true);
    }
    for (const [a, b] of [['padding-top', 'padding-bottom'], ['padding-inline', 'padding-block'], ['width', 'min-width'], ['border-color', 'border-width'], ['border-top-width', 'border-bottom-width'], ['margin', 'padding'], ['top', 'margin-top'], ['line-height', 'font-size']]) {
      expect(relatedProperties(a!, b!), `${a} !~ ${b}`).toBe(false);
    }
  });
  it('says order matters across variants and across a shorthand and its longhand, and not between two rules of one property', () => {
    const rule = (variant: string, ...properties: string[]) => ({ variant, properties: new Set(properties) });
    expect(orderMatters(rule('', 'padding-inline'), rule('\\@2xl', 'padding-inline'))).toBe(true);
    expect(orderMatters(rule('', 'padding-block'), rule('', 'padding-top'))).toBe(true);
    expect(orderMatters(rule('', 'margin-top'), rule('', 'margin-top'))).toBe(false);
    expect(orderMatters(rule('', 'color'), rule('', 'padding'))).toBe(false);
  });
});

describe('splitStoryCss', () => {
  it('cuts the union into a handful of shards that are the union, rule for rule, and links all of them for a sheet that is the union', () => {
    expect(base.shards).toHaveLength(STORY_CSS_SHARDS);
    expect(base.shards.flatMap((shard) => cssUnits(shard))).toEqual(bodyUnits(union));
    expect(splitStoryCss(union, base)).toEqual(base.shards.map((_, shard) => ({ shard })));
  });

  it('carries a document\'s own rules inline at the end when nothing after them can disagree, and links every shard', async () => {
    const full = await compile('mt-auto tracking-[0.3em]');
    const segments = splitStoryCss(full, base)!;
    expect(shardsLinked(segments)).toEqual(base.shards.map((_, shard) => shard));
    const inline = inlineText(segments);
    expect(inline).toContain('.mt-auto');
    expect(inline).toContain('tracking-\\[0\\.3em\\]');
    expect(inline.length).toBeLessThan(3500);
    // Nothing of the document's sheet is lost: every one of its rules is in what its segments apply.
    const rules = new Set(applied(segments));
    for (const unit of bodyUnits(full)) expect(rules.has(unit), unit.slice(0, 60)).toBe(true);
  });

  it('keeps a document rule where Tailwind sorted it when a later rule disagrees about order, carrying that shard inline in its original order', async () => {
    // `px-[13px]` must stay ahead of the union's `@2xl:px-12`-style rules; a longhand after it must keep winning too.
    const full = await compile('px-[13px] py-[11px]');
    const segments = splitStoryCss(full, base)!;
    const rules = applied(segments);
    const own = rules.findIndex((unit) => unit.startsWith('.px-\\[13px\\]'));
    const later = rules.findIndex((unit, at) => at > own && variantOf(unit) !== '' && declaredProperties(unit).has('padding-inline'));
    expect(own).toBeGreaterThan(-1);
    expect(later).toBeGreaterThan(own);
    // Every pair the union's order puts one way is still that way round.
    const original = bodyUnits(full);
    const pairs: Array<[string, string]> = [];
    for (let a = 0; a < original.length; a += 3) for (let b = a + 1; b < original.length; b += 17) {
      if (orderMatters({ variant: variantOf(original[a]!), properties: declaredProperties(original[a]!) }, { variant: variantOf(original[b]!), properties: declaredProperties(original[b]!) })) pairs.push([original[a]!, original[b]!]);
    }
    expect(pairs.length).toBeGreaterThan(50);
    for (const [first, second] of pairs) expect(rules.indexOf(first)).toBeLessThan(rules.lastIndexOf(second));
    expect(segments.some((segment) => 'inline' in segment && segment.inline.includes('px-\\[13px\\]'))).toBe(true);
    expect(shardsLinked(segments).length).toBeLessThan(base.shards.length);
  });

  it('reproduces, for every pair of rules whose order matters, the order of the document\'s own sheet', async () => {
    const full = await compile('@md:px-[22px] pt-[7px] py-[9px] mt-auto @2xl:py-[3px] hover:bg-[#123456] dark:text-[#abcdef]');
    const original = bodyUnits(full);
    const facts = original.map((unit) => ({ variant: variantOf(unit), properties: declaredProperties(unit) }));
    const rules = applied(splitStoryCss(full, base)!);
    const at = new Map(rules.map((unit, index) => [unit, index]));
    let checked = 0;
    for (let a = 0; a < original.length; a++) for (let b = a + 1; b < original.length; b++) {
      if (!orderMatters(facts[a]!, facts[b]!)) continue;
      checked++;
      expect(at.get(original[a]!), original[a]!.slice(0, 50)).toBeLessThan(at.get(original[b]!)!);
    }
    expect(checked).toBeGreaterThan(1000);
  });

  it('answers null for a sheet that is not the union plus additions', async () => {
    expect(splitStoryCss(`.a{b:c}\n${base.themes}`, base)).toBeNull();
    expect(splitStoryCss('.a{b:c}', base)).toBeNull();
    const cut = union.indexOf('.px-4');
    expect(splitStoryCss(union.slice(0, cut) + union.slice(cut + 80), base)).toBeNull();
  });

  it('refuses a block the document restates with a different value, which the union\'s own statement would not agree with', async () => {
    const full = await compile('mt-auto tracking-[0.3em]');
    expect(splitStoryCss(full, base)).not.toBeNull();
    expect(splitStoryCss(full.replace('--font-sans: ui-sans-serif', '--font-sans: Comic Sans'), base)).toBeNull();
  });

  it('does not share a union whose compile does not end with the theme blocks', () => {
    expect(storyCssBase('.a{b:c}', '.t{u:v}')).toBeNull();
  });
});
