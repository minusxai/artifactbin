/** The query image's theme: CSS colour values resolved to concrete sRGB, and every design system's chart tokens. */
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { DESIGN_SYSTEM_VARIABLES } from '@/lib/html-systems/server';
import { resolveCssColor } from '../css-color';
import { imageFontFamily, imageTokens } from '../chart-draw.server';
import { getVegaParserConfig, houseTokens, tokensFromThemeVariables } from '../theme';
import { registerImageFonts, woffToSfnt } from '../chart-fonts.server';

const channels = (hex: string) => [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16));
const near = (actual: string | null, expected: string, tolerance = 2) => {
  expect(actual).toMatch(/^#[0-9a-f]{6}$/);
  channels(actual!).forEach((c, i) => expect(Math.abs(c - channels(expected)[i]!), `${actual} vs ${expected}`).toBeLessThanOrEqual(tolerance));
};

describe('resolveCssColor', () => {
  it('writes hex, rgb() and hsl() as #rrggbb', () => {
    expect(resolveCssColor('#ABC')).toBe('#aabbcc');
    expect(resolveCssColor('#11223344', undefined, '#000000')).toBe('#05090e');
    expect(resolveCssColor('rgb(255 0 0)')).toBe('#ff0000');
    expect(resolveCssColor('rgba(0, 0, 255, 0.5)', undefined, '#ffffff')).toBe('#8080ff');
    expect(resolveCssColor('hsl(120 100% 25%)')).toBe('#008000');
    expect(resolveCssColor('white')).toBe('#ffffff');
  });
  it('converts oklch() and oklab() to sRGB, clamping what lies outside it', () => {
    near(resolveCssColor('oklch(0.628 0.2577 29.23)'), '#ff0000');
    near(resolveCssColor('oklch(1 0 0)'), '#ffffff');
    near(resolveCssColor('oklch(0.15 0 0)'), '#0b0b0b');
    near(resolveCssColor('oklch(62.8% 0.2577 29.23deg)'), '#ff0000');
    near(resolveCssColor('oklab(0.452 -0.0325 -0.3115)'), '#0000ff');
    near(resolveCssColor('oklch(0.9 0.4 145)'), '#00ff00', 255);
    expect(resolveCssColor('oklch(0.7 0.1 200 / 50%)', undefined, '#000000')).toMatch(/^#[0-9a-f]{6}$/);
  });
  it('mixes in srgb, oklab and oklch, and follows var() chains with fallbacks', () => {
    expect(resolveCssColor('color-mix(in srgb, #000000, #ffffff)')).toBe('#808080');
    expect(resolveCssColor('color-mix(in srgb, #ff0000 25%, #0000ff)')).toBe('#4000bf');
    near(resolveCssColor('color-mix(in oklab, #000000 50%, #ffffff)'), '#636363');
    near(resolveCssColor('color-mix(in oklch, #ff0000, #ff0000)'), '#ff0000');
    const vars: Record<string, string> = { '--a': 'var(--b)', '--b': 'oklch(0.628 0.2577 29.23)', '--loop': 'var(--loop)' };
    near(resolveCssColor('var(--a)', n => vars[n]), '#ff0000');
    expect(resolveCssColor('var(--missing, #123456)', n => vars[n])).toBe('#123456');
    expect(resolveCssColor('var(--missing)', n => vars[n])).toBeNull();
    expect(resolveCssColor('var(--loop)', n => vars[n])).toBeNull();
    for (const bad of ['', 'red-ish', 'url(x)', 'rgb(1 2)', 'color-mix(in hsl, #000, #fff)', 'oklch(a b c)']) expect(resolveCssColor(bad), bad).toBeNull();
  });
});

describe('the image tokens', () => {
  it('resolve every mapped token of every design system, light and dark, to concrete sRGB', () => {
    expect(DESIGN_SYSTEM_VARIABLES.names).toHaveLength(14);
    for (const name of DESIGN_SYSTEM_VARIABLES.names) for (const mode of ['light', 'dark'] as const) {
      const variables = DESIGN_SYSTEM_VARIABLES.variables(name, mode)!;
      const tokens = imageTokens(variables, mode), label = `${name} ${mode}`;
      // Five design-system colours, then the same five toward the text and toward the surface.
      expect(tokens.category, label).toHaveLength(15);
      for (const color of tokens.category.slice(5)) expect(color, label).toMatch(/^rgb\(\d+,\d+,\d+\)$/);
      for (const color of [...tokens.category.slice(0, 5), tokens.foreground, tokens.muted, tokens.border, tokens.surface]) expect(color, label).toMatch(/^#[0-9a-f]{6}$/);
      for (const color of [tokens.subtle, tokens.grid]) expect(color, label).toMatch(/^rgb\(\d+,\d+,\d+\)$/);
      // The system's own values, not the house fallback: its surface is its --background.
      expect(tokens.surface, label).toBe(resolveCssColor('var(--background)', n => variables[n]));
      expect(tokens.font, label).toMatch(/(sans-serif|monospace|serif)$/);
    }
  });
  it('layer the dark block over the light one', () => {
    const light = imageTokens(DESIGN_SYSTEM_VARIABLES.variables('volta', 'light'), 'light');
    const dark = imageTokens(DESIGN_SYSTEM_VARIABLES.variables('volta', 'dark'), 'dark');
    expect([light.surface, light.foreground, light.category[0]]).toEqual(['#f3eee4', '#14110f', '#2236d1']);
    expect([dark.surface, dark.foreground, dark.category[0]]).toEqual(['#121110', '#f3eee4', '#7484ff']);
    expect(DESIGN_SYSTEM_VARIABLES.variables('volta', 'dark')!['--radius']).toBe('4px');
    expect(DESIGN_SYSTEM_VARIABLES.variables('nope', 'light')).toBeNull();
    expect(DESIGN_SYSTEM_VARIABLES.defaultMode('phosphor')).toBe('dark');
  });
  it('keep the house values for what a page leaves unset, and the house theme without a system', () => {
    const partial = tokensFromThemeVariables(name => name === '--foreground' ? '#101010' : null, 'serif', 'dark');
    expect(partial).toMatchObject({ foreground: '#101010', surface: houseTokens('dark').surface, category: houseTokens('dark').category });
    expect(imageTokens(null, 'light')).toMatchObject({ ...houseTokens('light'), font: expect.stringMatching(/^"JetBrains Mono", "IBM Plex Mono", .*monospace$/) });
  });
  it('draw text in the system families, then families a Linux image carries for the same generic', () => {
    expect(imageFontFamily('"Instrument Sans", system-ui, sans-serif')).toMatch(/^"Instrument Sans", "Barlow", "Liberation Sans", .*sans-serif$/);
    expect(imageFontFamily('"IBM Plex Mono", ui-monospace, Menlo, monospace')).toMatch(/^"IBM Plex Mono", Menlo, "IBM Plex Mono", "DejaVu Sans Mono", .*monospace$/);
    expect(imageFontFamily('Newsreader, Georgia, serif')).toMatch(/^Newsreader, Georgia, "Old Standard TT", "DejaVu Serif", .*serif$/);
    expect(imageFontFamily(undefined)).toMatch(/^"Barlow"/);
  });
  it('theme native Vega axes and legend titles too', () => {
    const tokens = imageTokens(DESIGN_SYSTEM_VARIABLES.variables('volta', 'dark'), 'dark');
    expect(getVegaParserConfig(tokens)).toMatchObject({ axis: { labelColor: tokens.muted, titleColor: tokens.foreground, labelFont: tokens.font, domainColor: tokens.border, gridColor: tokens.grid },
      legend: { titleColor: tokens.foreground, labelColor: tokens.muted } });
  });
});

describe('the image fonts', () => {
  it('rewrite a WOFF 1.0 face as the sfnt it wraps, and register every face from the runtime packages', async () => {
    const woff = readFileSync(path.join(path.dirname(createRequire(import.meta.url).resolve('@fontsource/barlow')), 'files', 'barlow-latin-400-normal.woff'));
    const sfnt = woffToSfnt(woff), count = woff.readUInt16BE(12);
    expect(sfnt.readUInt32BE(0)).toBe(woff.readUInt32BE(4));
    expect(sfnt.readUInt16BE(4)).toBe(count);
    expect(sfnt.length).toBe(woff.readUInt32BE(16));
    const tags = Array.from({ length: count }, (_, i) => sfnt.subarray(12 + 16 * i, 16 + 16 * i).toString('latin1'));
    expect(tags).toEqual([...tags].sort());
    expect(tags).toEqual(expect.arrayContaining(['cmap', 'glyf', 'head', 'name']));
    // Every table record points inside the file, at its own length.
    for (let i = 0; i < count; i++) expect(sfnt.readUInt32BE(12 + 16 * i + 8) + sfnt.readUInt32BE(12 + 16 * i + 12)).toBeLessThanOrEqual(sfnt.length);
    expect(() => woffToSfnt(Buffer.from('wOF2xxxxxxxxxxxx'))).toThrow('not a WOFF 1.0 file');
    expect(await registerImageFonts()).toBe(12);
  });
});
