/**
 *  — `--chart-1..5` drive Vega chart colors.
 *
 * The token→range mapping is a pure function (chartTokenRange) tested here; the DOM wrapper
 * resolves computed style from the chart's container so charts recolor with the surrounding
 * [data-theme] scope. compileVegaLite/toVegaSpec accept the resolved range as a categorical
 * color override; absent tokens keep the house palette.
 */
import { describe, it, expect } from 'vitest';
import { chartTokenRange, resolveCssVarColors } from '../chart-tokens';
import { compileVegaLite, toVegaSpec } from '../render-vega';
import { COLOR_PALETTE } from '@/lib/chart/chart-theme';

const readerOf = (vars: Record<string, string>) => (name: string) => vars[name] ?? '';

describe('chartTokenRange — token → categorical range mapping', () => {
  it('maps all five tokens in order, converting oklch to hex (vega\'s d3-color cannot parse oklch inside recipe rgb() expressions — the trend card\'s history fade rendered BLACK)', () => {
    const range = chartTokenRange(readerOf({
      '--chart-1': 'oklch(0.6 0.2 30)',
      '--chart-2': 'oklch(0.5 0.1 200)',
      '--chart-3': 'oklch(0.4 0.05 250)',
      '--chart-4': 'oklch(0.8 0.15 90)',
      '--chart-5': 'oklch(0.7 0.18 70)',
    }));
    expect(range).toEqual(['#de3e2d', '#00747a', '#334a62', '#e3b831', '#e38500']);
  });

  it('handles percentage lightness and deg hues', () => {
    expect(chartTokenRange(readerOf({ '--chart-1': 'oklch(62% 0.16 290deg)' }))).toEqual(['#8771de']);
  });

  it('returns null when --chart-1 is undefined (no token scope → house palette)', () => {
    expect(chartTokenRange(readerOf({}))).toBeNull();
    expect(chartTokenRange(readerOf({ '--chart-2': 'red' }))).toBeNull();
  });

  it('trims computed values, passes non-oklch colors through, and skips empty middle slots', () => {
    const range = chartTokenRange(readerOf({ '--chart-1': ' red ', '--chart-3': '#8771de' }));
    expect(range).toEqual(['red', '#8771de']);
  });
});

const UNIT_SPEC = {
  mark: 'bar',
  encoding: {
    x: { field: 'cat', type: 'nominal' },
    y: { field: 'val', type: 'quantitative' },
    color: { field: 'cat', type: 'nominal' },
  },
};

describe('compileVegaLite — categoryRange override', () => {
  it('bakes the token range into the compiled config as range.category', () => {
    const tokens = ['oklch(0.6 0.2 30)', 'oklch(0.5 0.1 200)'];
    const spec = compileVegaLite(UNIT_SPEC, 'light', { categoryRange: tokens }) as unknown as
      { config?: { range?: { category?: unknown } } };
    expect(spec.config?.range?.category).toEqual(tokens);
  });

  it('keeps the house palette when no range is given', () => {
    const spec = compileVegaLite(UNIT_SPEC, 'light') as unknown as
      { config?: { range?: { category?: unknown } } };
    expect(spec.config?.range?.category).toEqual(COLOR_PALETTE);
  });
});

describe('toVegaSpec — native-vega engine gets the range via parser config', () => {
  it('merges range.category into the themed parser config', () => {
    const tokens = ['red', 'blue'];
    const { parserConfig } = toVegaSpec(
      { spec: { marks: [] }, engine: 'vega' }, 'light', { categoryRange: tokens },
    );
    expect((parserConfig as { range?: { category?: unknown } }).range?.category).toEqual(tokens);
  });

  it('leaves the parser config untouched without a range', () => {
    const { parserConfig } = toVegaSpec({ spec: { marks: [] }, engine: 'vega' }, 'light');
    expect((parserConfig as { range?: { category?: unknown } })?.range?.category).not.toEqual(['red', 'blue']);
  });
});

describe('resolveCssVarColors — var(--token) references in built specs', () => {
  const read = (name: string) =>
    ({ '--foreground': 'oklch(0.94 0.015 270)', '--chart-2': '#22aacc' } as Record<string, string>)[name] ?? '';

  it('substitutes exact var() strings anywhere in the spec, converting oklch to hex', () => {
    const spec = {
      scales: [{ name: 'color', range: ['var(--chart-2)', 'var(--chart-2)'] }],
      marks: [{ encode: { update: { fill: { value: 'var(--foreground)' } } } }],
    };
    resolveCssVarColors(spec, read);
    expect(spec.scales[0].range).toEqual(['#22aacc', '#22aacc']);
    const fill = spec.marks[0].encode.update.fill.value;
    expect(fill).toMatch(/^#[0-9a-f]{6}$/i);
    expect(fill).not.toContain('var(');
  });

  it('leaves ordinary strings and non-color content alone', () => {
    const spec = { title: 'var is a keyword', fill: '#ff0000', expr: "scale('color', datum.x)" };
    resolveCssVarColors(spec, read);
    expect(spec).toEqual({ title: 'var is a keyword', fill: '#ff0000', expr: "scale('color', datum.x)" });
  });

  it('an undefined token falls back to a visible neutral rather than an invalid color', () => {
    const spec = { fill: 'var(--no-such-token)' };
    resolveCssVarColors(spec, read);
    expect(spec.fill).toBe('#888888');
  });
});
