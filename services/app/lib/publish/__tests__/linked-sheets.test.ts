/**
 * The document's stylesheets with the shared ones linked (lib/page-styles/linked-sheets.server): every sheet that is
 * the same bytes for many documents becomes one immutable address on the app's origin, in the place it had, and what
 * is the document's own stays inline.
 */
import { describe, expect, it } from 'vitest';
import { compileStoryCss } from '@/lib/data/story/story-css.server';
import { STORY_SYSTEM_SHEETS } from '@/lib/data/story/story-system-sheets';
import { STORY_SYSTEM_NAMES } from '@/lib/validation/story-system-names';
import { createStylesheetStore } from '@/lib/compiled-page/modules.server';
import { storyThemeCss } from '@/lib/data/story/story-themes';
import { documentStyleSheets } from '@/lib/page-styles/document-styles';
import { linkedDocumentSheets } from '../prepared/linked-sheets.server';
import { cssUnits } from '@/lib/page-styles/css-units';
import { STORY_FONTS_ATTR } from '@/lib/data/story/story-fonts';

const ORIGIN = 'https://app.example.test';
const store = createStylesheetStore();
const linked = (sheets: ReturnType<typeof documentStyleSheets>) => linkedDocumentSheets(sheets, { origin: ORIGIN, store });
const compile = async (classes: string): Promise<string> => (await compileStoryCss(`<div class="${classes}"></div>`))!;
const sheetsFor = async (classes: string, over: Partial<Parameters<typeof documentStyleSheets>[0]> = {}) => documentStyleSheets({
  compiledCss: await compile(classes), chrome: true, bare: false, theme: 'industry', docFonts: { slots: {}, families: [] }, systemCss: '', authorCss: null, ...over,
});
const unitsOf = (sheets: ReadonlyArray<{ css: string }>): string[] => sheets.flatMap((sheet) => cssUnits(sheet.css));
const hrefs = (sheets: ReadonlyArray<{ href?: string }>): string[] => sheets.flatMap((sheet) => (sheet.href ? [sheet.href] : []));
const attrs = (sheets: ReadonlyArray<{ attr: string }>): string[] => sheets.map((sheet) => sheet.attr);

describe('linkedDocumentSheets', () => {
  it('links the union\'s shards, the base sheet and the design system, keeps the document\'s own rules, fonts and CSS inline, and keeps the order', async () => {
    const system = STORY_SYSTEM_NAMES[0]!;
    const original = await sheetsFor('mt-auto tracking-[0.3em]', {
      systemCss: `${STORY_SYSTEM_SHEETS[system].fontFaces}\n${STORY_SYSTEM_SHEETS[system].css}`,
      authorCss: '.mine { color: red }', docFonts: { slots: { 'font-display': 'Lobster' }, families: ['Lobster'] },
    });
    const out = await linked(original);
    // Every address is the app's, content-addressed, and the store serves exactly the text the sheet carries.
    for (const sheet of out.filter((s) => s.href)) {
      expect(sheet.href).toMatch(new RegExp(`^${ORIGIN}/islands/c/[0-9a-f]{16}\\.css$`));
      expect(new TextDecoder().decode((await store.get(sheet.href!.slice(-20, -4)))!)).toBe(sheet.css);
    }
    expect(attrs(out).filter((a) => a.startsWith('data-mx-tw-s'))).toHaveLength(8);
    expect(attrs(out)).toEqual(expect.arrayContaining(['data-mx-base', 'data-mx-system']));
    // The bare element sheets, the chrome, the fonts and every theme's tokens travel in the one base sheet.
    const base = out.find((s) => s.attr === 'data-mx-base')!;
    expect(base.href).toBeDefined();
    for (const marker of ['.mx-doc', '[data-theme', '@font-face']) expect(base.css).toContain(marker);
    // The document's own: its added rules, the Helmet font slots, the author's CSS — inline, after what they override.
    expect(out.filter((s) => !s.href).map((s) => s.attr)).toEqual(['data-mx-tw-i0', 'data-mx-font-vars', 'data-mx-author']);
    expect(out.find((s) => s.attr === 'data-mx-tw-i0')!.css).toContain('.mt-auto');
    expect(out.at(-1)).toMatchObject({ attr: 'data-mx-author', css: '.mine { color: red }' });
    const order = attrs(out);
    expect(order.indexOf('data-mx-font-vars')).toBeLessThan(order.indexOf('data-mx-system'));
    expect(order.indexOf('data-mx-base')).toBeGreaterThan(order.indexOf('data-mx-tw-s7'));
    // Nothing is lost: every rule of the original sheets stands in what the linked ones carry.
    const carried = new Set(unitsOf(out));
    for (const unit of unitsOf(original)) expect(carried.has(unit), unit.slice(0, 60)).toBe(true);
    expect(hrefs(out)).toHaveLength(8 + 2);
  });

  it('shares every address between documents, and a document that is only the union carries nothing of its own inline', async () => {
    const a = await linked(await sheetsFor(''));
    const b = await linked(await sheetsFor('mt-auto', { authorCss: '.b{color:blue}' }));
    expect(hrefs(a)).toEqual(hrefs(b).filter((href) => hrefs(a).includes(href)));
    expect(hrefs(a)).toHaveLength(9);
    expect(a.filter((s) => !s.href)).toEqual([]);
    expect(hrefs(b).length).toBeGreaterThanOrEqual(8);
  });

  it('answers a different base sheet for another theme, and the same shards', async () => {
    const industry = await linked(await sheetsFor('', { theme: 'industry' }));
    const other = await linked(await sheetsFor('', { theme: null }));
    expect(industry.find((s) => s.attr === STORY_FONTS_ATTR)).toBeUndefined();
    expect(industry.find((s) => s.attr === 'data-mx-base')!.href).not.toBe(other.find((s) => s.attr === 'data-mx-base')!.href);
    expect(hrefs(industry).slice(0, 8)).toEqual(hrefs(other).slice(0, 8));
  });

  it('leaves a sheet that is not the union plus additions inline, whole', async () => {
    const odd = await sheetsFor('', { compiledCss: '.only{color:red}' });
    const out = await linked(odd);
    expect(out.find((s) => s.attr === 'data-mx-tw')).toMatchObject({ css: '.only{color:red}' });
    expect(out.find((s) => s.attr === 'data-mx-tw')!.href).toBeUndefined();
    expect(out.find((s) => s.attr === 'data-mx-base')!.css).not.toContain(storyThemeCss());
  });

  it('passes a document with no compiled sheet through, linking only what is shared', async () => {
    const out = await linked(await sheetsFor('', { compiledCss: null }));
    expect(attrs(out).some((a) => a.startsWith('data-mx-tw'))).toBe(false);
    expect(out.find((s) => s.attr === 'data-mx-base')!.href).toBeDefined();
  });

  it('only ever names the app\'s own fonts and inline data in a shared sheet: the policy admits no other address', async () => {
    const system = STORY_SYSTEM_NAMES[0]!;
    const out = await linked(await sheetsFor('', { systemCss: `${STORY_SYSTEM_SHEETS[system].fontFaces}\n${STORY_SYSTEM_SHEETS[system].css}` }));
    const urls = out.filter((s) => s.href).flatMap((s) => [...s.css.matchAll(/url\(\s*(['"]?)([^'")]+)\1\s*\)/g)].map((m) => m[2]!));
    expect(urls.length).toBeGreaterThan(5);
    // A fragment reference inside an inline SVG (`url(%23g)`) fetches nothing.
    for (const url of urls.filter((u) => !u.startsWith('%23') && !u.startsWith('#'))) expect(url.startsWith('/fonts/') || url.startsWith('data:'), url).toBe(true);
  });

  it('carries a sheet inline, in its place, when the store cannot take it, and stores the rest concurrently', async () => {
    const original = await sheetsFor('mt-auto', { authorCss: '.mine{color:red}' });
    let inFlight = 0, peak = 0;
    const failing = { put: async (css: string) => {
      inFlight++; peak = Math.max(peak, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 5));
      inFlight--;
      if (css.includes('[data-theme')) throw new Error('store down');
      return store.put(css);
    } };
    const out = await linkedDocumentSheets(original, { origin: ORIGIN, store: failing });
    const base = out.find((s) => s.attr === 'data-mx-base')!;
    expect(base.href).toBeUndefined();
    expect(base.css).toContain('[data-theme');
    expect(attrs(out).indexOf('data-mx-base')).toBeGreaterThan(attrs(out).indexOf('data-mx-tw-s7'));
    expect(hrefs(out).length).toBeGreaterThanOrEqual(7);
    expect(peak).toBeGreaterThan(1);
    const carried = new Set(unitsOf(out));
    for (const unit of unitsOf(original)) expect(carried.has(unit), unit.slice(0, 60)).toBe(true);
  });

  it('does not touch the standalone sheets themselves: documentStyleSheets is what the offline file and a capture still inline', async () => {
    const original = await sheetsFor('mt-auto');
    const copy = JSON.stringify(original);
    await linked(original);
    expect(JSON.stringify(original)).toBe(copy);
    expect(original.every((s) => !('href' in s))).toBe(true);
  });
});
