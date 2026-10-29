import { afterEach, describe, expect, it, vi } from 'vitest';
import { COLOR_PALETTE, DARK_THEME, LIGHT_THEME, getChartFontFamily } from '../chart-theme';

const FALLBACK = 'JetBrains Mono, Consolas, Monaco, Courier New, monospace';
const HEX = /^#[0-9a-f]{6}$/i;

afterEach(() => vi.unstubAllGlobals());

describe('getChartFontFamily', () => {
  it('answers the monospace fallback where there is no document (server, worker)', () => {
    expect(getChartFontFamily()).toBe(FALLBACK);
  });

  it('reads the app font variable, trimmed, when the document defines it', () => {
    const read = vi.fn(() => '  "Fira Code", monospace ');
    vi.stubGlobal('document', { documentElement: {} });
    vi.stubGlobal('getComputedStyle', () => ({ getPropertyValue: read }));
    expect(getChartFontFamily()).toBe('"Fira Code", monospace');
    expect(read).toHaveBeenCalledWith('--font-jetbrains-mono');
  });

  it('falls back when the variable is unset or only whitespace', () => {
    vi.stubGlobal('document', { documentElement: {} });
    vi.stubGlobal('getComputedStyle', () => ({ getPropertyValue: () => '   ' }));
    expect(getChartFontFamily()).toBe(FALLBACK);
  });
});

describe('chart palette and themes', () => {
  it('has 24 distinct hex colours, keeping the original first eight in order', () => {
    expect(COLOR_PALETTE).toHaveLength(24);
    expect(new Set(COLOR_PALETTE.map(c => c.toLowerCase())).size).toBe(24);
    expect(COLOR_PALETTE.every(c => HEX.test(c))).toBe(true);
    expect(COLOR_PALETTE.slice(0, 3)).toEqual(['#16a085', '#2980b9', '#c0392b']);
  });

  it('defines the same tokens for light and dark, every one a hex colour, and they differ', () => {
    expect(Object.keys(DARK_THEME).sort()).toEqual(Object.keys(LIGHT_THEME).sort());
    for (const theme of [LIGHT_THEME, DARK_THEME]) expect(Object.values(theme).every(c => HEX.test(c))).toBe(true);
    expect(LIGHT_THEME.bgCanvas).not.toBe(DARK_THEME.bgCanvas);
    expect(LIGHT_THEME.fgDefault).toBe(DARK_THEME.bgCanvas);
  });
});
