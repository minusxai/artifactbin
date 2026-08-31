/**
 * Server-rendered analytics charts: the dashboard's per-artifact view spline
 * and the account page's views-per-artifact bar chart. Both go through the
 * ONE headless Vega pipeline (render-vega's renderer:'none' → toSVG) — no
 * client bundle cost, no second chart stack.
 *
 * Rendered in 'dark' mode (the app default): the SVG is static markup, so it
 * cannot follow the viewer's theme toggle. The sparkline carries no themed
 * chrome (no axes, no text) and paints in the accent green, so only the
 * account bar chart's labels show the bias.
 */
import { VIZ_DATASET_MAIN } from '@/lib/viz/types';

/** The dark-theme accent (globals.css --color-accent) — legible on both surfaces. */
const ACCENT = '#3fe77b';

export interface SparklineOptions {
  width?: number;
  height?: number;
}

/** A tiny axis-less spline of a daily count series. Resolves to `<svg ...>` markup. */
export async function renderSparklineSvg(
  series: number[],
  opts: SparklineOptions = {},
): Promise<string> {
  const width = opts.width ?? 96;
  const height = opts.height ?? 20;
  const rows = series.map((n, i) => ({ i, n }));
  const spec = {
    background: 'transparent',
    data: { name: VIZ_DATASET_MAIN },
    mark: {
      type: 'area',
      interpolate: 'monotone',
      color: ACCENT,
      opacity: 0.18,
      line: { color: ACCENT, strokeWidth: 1.25, opacity: 1 },
    },
    encoding: {
      x: { field: 'i', type: 'quantitative', axis: null, scale: { nice: false, zero: false } },
      y: { field: 'n', type: 'quantitative', axis: null, scale: { zero: true } },
    },
    width,
    height,
    padding: 1,
    // The container-fit default assumes a live DOM to measure; a sparkline is
    // fixed-size by definition, so pin it and skip the fitting pass.
    autosize: { type: 'none' },
  };
  return (await import('@/lib/viz/render-vega')).renderVegaLiteToSvg(spec, rows, 'dark', { width, height });
}

/**
 * Vega emits a fixed-size root; swap the pixel size for a viewBox so the SVG
 * scales to its container (full-width chart, ratio preserved).
 */
function responsive(svg: string): string {
  return svg.replace(/^<svg([^>]*)>/, (_tag, attrs: string) => {
    const w = attrs.match(/width="([\d.]+)"/)?.[1];
    const h = attrs.match(/height="([\d.]+)"/)?.[1];
    let rest = attrs.replace(/\s(?:width|height)="[^"]*"/g, '');
    if (!rest.includes('viewBox') && w && h) rest += ` viewBox="0 0 ${w} ${h}"`;
    return `<svg${rest} style="width:100%;height:auto">`;
  });
}

/** All-time daily views histogram for the account page: full-container-width SVG. */
export async function renderDailyViewsSvg(days: { day: string; views: number }[]): Promise<string> {
  const spec = {
    background: 'transparent',
    data: { name: VIZ_DATASET_MAIN },
    mark: { type: 'bar', opacity: 0.85 },
    encoding: {
      x: { field: 'day', type: 'temporal', title: null, axis: { format: '%b %-d', labelAngle: 0 } },
      y: { field: 'views', type: 'quantitative', title: null, axis: { tickMinStep: 1 } },
      // A literal color (not a field) also opts out of the pipeline's
      // single-series legend + legend-toggle injections — one series
      // needs no legend chrome.
      color: { value: ACCENT },
    },
    width: 720,
    height: 150,
    // 'pad' grows the SVG around the plot area; the pipeline's default 'fit'
    // would squeeze axes INTO width×height and collapse a short chart to
    // zero plot height.
    autosize: { type: 'pad' },
  };
  return responsive(await (await import('@/lib/viz/render-vega')).renderVegaLiteToSvg(spec, days, 'dark'));
}
