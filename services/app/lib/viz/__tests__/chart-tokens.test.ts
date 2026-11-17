/** The query image's theme: CSS colour values resolved to concrete sRGB, and every design system's chart tokens. */
import { describe, expect, it } from 'vitest';
import { DESIGN_SYSTEM_VARIABLES } from '@/lib/html-systems/server';
import { resolveCssColor } from '../css-color';
import { imageFontFamily, imageTokens } from '../chart-draw.server';
import { getVegaParserConfig, houseTokens, tokensFromThemeVariables } from '../theme';

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
    expect(DESIGN_SYSTEM_VARIABLES.names).toHaveLength(13);
    for (const name of DESIGN_SYSTEM_VARIABLES.names) for (const mode of ['light', 'dark'] as const) {
      const variables = DESIGN_SYSTEM_VARIABLES.variables(name, mode)!;
      const tokens = imageTokens(variables, mode), label = `${name} ${mode}`;
      expect(tokens.category, label).toHaveLength(5);
      for (const color of [...tokens.category, tokens.foreground, tokens.muted, tokens.border, tokens.surface]) expect(color, label).toMatch(/^#[0-9a-f]{6}$/);
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
    expect(imageTokens(null, 'light')).toMatchObject({ ...houseTokens('light'), font: expect.stringMatching(/^"JetBrains Mono", .*monospace$/) });
  });
  it('draw text in the system families, then families a Linux image carries for the same generic', () => {
    expect(imageFontFamily('"Instrument Sans", system-ui, sans-serif')).toMatch(/^"Instrument Sans", "Liberation Sans", .*sans-serif$/);
    expect(imageFontFamily('"IBM Plex Mono", ui-monospace, Menlo, monospace')).toMatch(/^"IBM Plex Mono", Menlo, "DejaVu Sans Mono", .*monospace$/);
    expect(imageFontFamily('Newsreader, Georgia, serif')).toMatch(/^Newsreader, Georgia, "DejaVu Serif", .*serif$/);
    expect(imageFontFamily(undefined)).toMatch(/^"Liberation Sans"/);
  });
  it('theme native Vega axes and legend titles too', () => {
    const tokens = imageTokens(DESIGN_SYSTEM_VARIABLES.variables('volta', 'dark'), 'dark');
    expect(getVegaParserConfig(tokens)).toMatchObject({ axis: { labelColor: tokens.muted, titleColor: tokens.foreground, labelFont: tokens.font, domainColor: tokens.border, gridColor: tokens.grid },
      legend: { titleColor: tokens.foreground, labelColor: tokens.muted } });
  });
});
