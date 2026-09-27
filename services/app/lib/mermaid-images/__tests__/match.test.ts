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
import { formatMermaidMetrics, mermaidMetricsAgree, parseMermaidMetrics, readerMayUseStoredDrawings, servableStoredDrawing, storedDrawingFits, type MermaidMetrics } from '../match';

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

describe('a reader the server serves stored drawings to', () => {
  // Blink with unhinted, fractional glyph advances: macOS (measured) and Windows (DirectWrite, reasoned).
  it.each([
    ['Chrome on macOS', 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36'],
    ['headless Chrome on macOS', 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/140.0.0.0 Safari/537.36'],
    ['Chrome on Windows', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36'],
    ['Edge on Windows', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36 Edg/140.0.0.0'],
  ])('%s', (_name, ua) => {
    expect(readerMayUseStoredDrawings(ua)).toBe(true);
  });

  // Everyone else draws with the engine, as before: their measurements are not the harvest's.
  it.each([
    ['Chrome on Linux (hinted: whole-pixel advances)', 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36'],
    ['headless Chrome on Linux', 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/140.0.0.0 Safari/537.36'],
    ['Chrome on Android (unmeasured)', 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36'],
    ['Chrome on ChromeOS (unmeasured)', 'Mozilla/5.0 (X11; CrOS x86_64 14541.0.0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36'],
    ['Chrome on iOS (WebKit)', 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/140.0.0.0 Mobile/15E148 Safari/604.1'],
    ['Safari on macOS', 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15'],
    ['Firefox on macOS', 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:130.0) Gecko/20100101 Firefox/130.0'],
    ['Firefox on Windows', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:130.0) Gecko/20100101 Firefox/130.0'],
    ['no user agent', ''],
  ])('not %s', (_name, ua) => {
    expect(readerMayUseStoredDrawings(ua)).toBe(false);
  });
  it('not a request that names none', () => {
    expect(readerMayUseStoredDrawings(null)).toBe(false);
    expect(readerMayUseStoredDrawings(undefined)).toBe(false);
  });
});

describe('a stored drawing the server serves at all', () => {
  it('is one drawn entirely in the document\'s web fonts, with its measurements', () => {
    expect(servableStoredDrawing({ portable: true, metrics: [...HARVEST_UNHINTED] })).toBe(true);
  });
  it('is never one drawn in a system font (it measures like the harvest\'s machine, and no reader is that machine)', () => {
    expect(servableStoredDrawing({ portable: false, metrics: [...HARVEST_UNHINTED] })).toBe(false);
    expect(servableStoredDrawing({ metrics: [...HARVEST_UNHINTED] })).toBe(false);
  });
  it('is never one stored without its measurements', () => {
    expect(servableStoredDrawing({ portable: true })).toBe(false);
    expect(servableStoredDrawing({ portable: true, metrics: [1, 2, 3] })).toBe(false);
  });
});
