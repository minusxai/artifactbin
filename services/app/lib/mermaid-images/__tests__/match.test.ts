/**
 * WHEN A STORED DRAWING MAY STAND IN FOR THE ENGINE'S (lib/mermaid-images/match).
 *
 * The measurements below are real: the SVG text boxes (`getBBox` width, height,
 * y) of the palette's label face (Inter, 16px) and edge-label face (JetBrains
 * Mono, 11px) over the metrics probe, measured on the same published document
 * (production /a/HlRZLD, theme industry) on 27 Sep 2026 by:
 *   - the harvest's Linux Chromium with unhinted text (`--font-render-hinting=none`),
 *   - macOS Chromium (a reader),
 *   - the harvest's Linux Chromium as it ran before (default hinting: advances
 *     rounded to whole pixels — the drawings production stored),
 *   - macOS WebKit (Safari's engine: the same widths to 2dp, a shorter line box).
 */
import { describe, expect, it } from 'vitest';
import { formatMermaidFaces, formatMermaidMetrics, mermaidMetricsAgree, parseMermaidFaces, parseMermaidMetrics, storedDrawingFits, type MermaidMetrics } from '../match';

const HARVEST_UNHINTED: MermaidMetrics = [855.9375, 20, -16, 646.796875, 14, -11];
const MACOS_BLINK: MermaidMetrics = [855.9375, 20, -16, 646.8125, 14, -11];
const LINUX_HINTED: MermaidMetrics = [851, 20, -16, 686, 14, -11];
const MACOS_WEBKIT: MermaidMetrics = [859.3125, 19.359375, -15.5, 646.8125, 14.546875, -11.234375];
const MACOS_GECKO: MermaidMetrics = [860.1500244140625, 20, -16, 650.7999877929688, 16, -12];
const PALETTE = 'b6016e11163bb0b2f7dd9e80238a8c77';

const stored = (metrics: readonly number[] | undefined, palette = PALETTE) => ({ palette, ...(metrics ? { metrics: [...metrics] } : {}) });

describe('a stored drawing fits this reader', () => {
  it('when the palette is the same and the faces measure the same up to sub-pixel noise (Blink on macOS vs the unhinted harvest)', () => {
    expect(storedDrawingFits(stored(HARVEST_UNHINTED), { palette: PALETTE, metrics: MACOS_BLINK })).toBe(true);
  });

  it('never when the harvest rounded its glyph advances (the hinted drawings production stored: 4–39px wider)', () => {
    expect(storedDrawingFits(stored(LINUX_HINTED), { palette: PALETTE, metrics: MACOS_BLINK })).toBe(false);
    expect(storedDrawingFits(stored(HARVEST_UNHINTED), { palette: PALETTE, metrics: LINUX_HINTED })).toBe(false);
  });

  it('never in WebKit, whose widths agree to 2dp but whose line box is 0.64px shorter (its drawings are 2.5–4px shorter)', () => {
    expect(storedDrawingFits(stored(HARVEST_UNHINTED), { palette: PALETTE, metrics: MACOS_WEBKIT })).toBe(false);
  });

  it('never in Gecko, whose text boxes are wider than its advances', () => {
    expect(storedDrawingFits(stored(HARVEST_UNHINTED), { palette: PALETTE, metrics: MACOS_GECKO })).toBe(false);
  });

  it('never under another palette, however the faces measure', () => {
    expect(storedDrawingFits(stored(HARVEST_UNHINTED, 'f'.repeat(32)), { palette: PALETTE, metrics: HARVEST_UNHINTED })).toBe(false);
  });

  it('never when only one side measured (a browser without SVG text boxes, or a drawing stored without them)', () => {
    expect(storedDrawingFits(stored(undefined), { palette: PALETTE, metrics: MACOS_BLINK })).toBe(false);
    expect(storedDrawingFits(stored(HARVEST_UNHINTED), { palette: PALETTE, metrics: null })).toBe(false);
    // Neither side measured: only the palette decides (a DOM without layout, as in tests).
    expect(storedDrawingFits(stored(undefined), { palette: PALETTE, metrics: null })).toBe(true);
  });
});

describe('the metrics', () => {
  it('round-trip through the attribute the harvest reads, and refuse anything else', () => {
    expect(parseMermaidMetrics(formatMermaidMetrics(MACOS_WEBKIT))).toEqual(MACOS_WEBKIT);
    expect(parseMermaidMetrics('1,2,3')).toBeNull();
    expect(parseMermaidMetrics('1,2,3,4,5,NaN')).toBeNull();
    expect(parseMermaidMetrics('1,2,3,4,5,1e400')).toBeNull();
    expect(parseMermaidMetrics('')).toBeNull();
    expect(parseMermaidMetrics(null)).toBeNull();
    expect(parseMermaidMetrics(`${'9'.repeat(40)},2,3,4,5,6`)).toBeNull();
  });

  it('agree within a tenth of a pixel of width and a hundredth of a pixel of box', () => {
    expect(mermaidMetricsAgree(HARVEST_UNHINTED, MACOS_BLINK)).toBe(true);
    expect(mermaidMetricsAgree(HARVEST_UNHINTED, [856.05, 20, -16, 646.796875, 14, -11])).toBe(false);
    expect(mermaidMetricsAgree(HARVEST_UNHINTED, [855.9375, 20.02, -16, 646.796875, 14, -11])).toBe(false);
  });
});

describe('the faces a drawing was drawn in', () => {
  it('round-trip through the attribute the harvest reads, and refuse anything else', () => {
    expect(parseMermaidFaces(formatMermaidFaces({ label: 'Inter', size: 16, edge: 'JetBrains Mono' }))).toEqual({ label: 'Inter', size: 16, edge: 'JetBrains Mono' });
    expect(parseMermaidFaces('Inter|16')).toBeNull();
    expect(parseMermaidFaces('Inter|sixteen|JetBrains Mono')).toBeNull();
    expect(parseMermaidFaces('Inter|16|<script>')).toBeNull();
    expect(parseMermaidFaces(`${'x'.repeat(200)}|16|Inter`)).toBeNull();
    expect(parseMermaidFaces(null)).toBeNull();
  });
});
