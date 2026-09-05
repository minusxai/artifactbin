/** Server-rendered per-artifact sparklines through the headless Vega pipeline. */
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
