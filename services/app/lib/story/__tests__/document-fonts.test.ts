/**
 * The font ask, and the CSS that makes it real — pure.
 *
 * The load-bearing case is the last one: emitting the VARIABLE without the
 * rule that reads it looks completely correct (the @font-face rules, the
 * preload and the var are all present) and paints the default sans stack in a
 * themeless document, because nothing in that document binds --font-display.
 * A browser gate found it; this pins it.
 */
import { describe, expect, it } from 'vitest';
import { documentFonts, documentFontCss, invalidFontFamilies } from '../document-fonts';
import { EMPTY_HELMET_CONTENT } from '../helmet';

const helmet = (meta: Array<{ name: string; content: string }>) => ({ ...EMPTY_HELMET_CONTENT, meta });

describe('documentFonts', () => {
  it('reads the three slots and dedupes the families', () => {
    const fonts = documentFonts(helmet([
      { name: 'font-display', content: 'Lobster' },
      { name: 'font-body', content: 'Lora' },
      { name: 'font-mono', content: 'Lora' },
      { name: 'description', content: 'not a font' },
    ]));
    expect(fonts.slots).toEqual({ 'font-display': 'Lobster', 'font-body': 'Lora', 'font-mono': 'Lora' });
    expect(fonts.families.sort()).toEqual(['Lobster', 'Lora']);
  });

  it('ignores blank content and documents that name nothing', () => {
    expect(documentFonts(helmet([{ name: 'font-body', content: '   ' }])).families).toEqual([]);
    expect(documentFonts(EMPTY_HELMET_CONTENT).families).toEqual([]);
  });
});

describe('invalidFontFamilies', () => {
  it('names what the door must refuse — a family lands in a stylesheet', () => {
    const bad = invalidFontFamilies(documentFonts(helmet([
      { name: 'font-body', content: 'Inter"; } body { display: none } .x {' },
    ])));
    expect(bad).toHaveLength(1);
  });

  it('passes ordinary family names, spaces included', () => {
    expect(invalidFontFamilies(documentFonts(helmet([{ name: 'font-body', content: 'Bricolage Grotesque' }])))).toEqual([]);
  });
});

describe('documentFontCss', () => {
  it('is empty when the document names no fonts', () => {
    expect(documentFontCss(documentFonts(EMPTY_HELMET_CONTENT))).toBe('');
  });

  it('DECLARES the var AND BINDS it — a var nothing reads paints nothing', () => {
    const css = documentFontCss(documentFonts(helmet([{ name: 'font-display', content: 'Lobster' }])));
    expect(css).toContain('--font-display: "Lobster"');
    // The half that was missing: without this rule a themeless document keeps
    // Tailwind's default sans on every heading.
    expect(css).toMatch(/:is\(h1, h2, h3, h4, h5, h6\)\s*\{\s*font-family: var\(--font-display\)/);
  });

  it('binds only the slots the document actually named', () => {
    const css = documentFontCss(documentFonts(helmet([{ name: 'font-mono', content: 'Fira Code' }])));
    expect(css).toContain('--font-mono: "Fira Code"');
    expect(css).toContain('code, pre, kbd, samp');
    expect(css).not.toContain('--font-display');
    expect(css).not.toContain('h1, h2');
  });

  it('keeps zero specificity so an authored class still wins', () => {
    const css = documentFontCss(documentFonts(helmet([{ name: 'font-body', content: 'Lora' }])));
    expect(css).toContain(':where(:root)');
  });
});
