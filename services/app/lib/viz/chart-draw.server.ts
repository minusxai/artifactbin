/**
 * DRAWING ONE CHART TO PNG, the body of the query image's worker (./chart-image-worker.ts). The
 * same pipeline as <af-chart>: the checked description resolves (recipes materialize), the chart
 * plan decides legends, label angles and facets for the slot, the view binds the rows as `main`
 * with the loader that refuses every fetch, and Vega draws it headless (`renderer: 'none'` →
 * `toSVG`). sharp (librsvg) rasterises it onto the theme's surface.
 *
 * Theme: a named design system's variables (lib/html-systems server entry), resolved to concrete
 * sRGB here (./css-color) and mapped by theme.ts `tokensFromThemeVariables`, the page's own
 * mapping; none means the house tokens. Text is drawn in the system's body families, then the
 * faces the thread registered for its generic family (./chart-fonts.server.ts), then system ones.
 *
 * Bounds: the image fits the requested box (a spec that sizes itself larger is scaled down, never
 * rasterised past it), and a PNG past `maxPngBytes` is retried as a palette PNG before it is
 * refused. Defence in depth below the parse (which refuses every `url` key): the SVG handed to
 * librsvg keeps no external href or url(), so an image mark that slipped through draws nothing.
 */
import sharp from 'sharp';
import type { ChartDescription } from '@/lib/html-component-specs/chart-spec';
import { createChartView, planChart, resizeVegaView } from './chart-plan';
import { resolveChartDescription } from './chart-resolve';
import { SERVER_ENGINES } from './render-vega';
import { houseTokens, tokensFromThemeVariables, type ChartTokens } from './theme';
import { resolveCssColor } from './css-color';
import { IMAGE_FONTS } from './chart-fonts.server';

export interface ChartDrawJob {
  description: ChartDescription;
  rows: Record<string, unknown>[];
  /** The box the image fits, in pixels. */
  width: number;
  height: number;
  mode: 'light' | 'dark';
  /** A design system's custom properties as declared; null draws with the house tokens. */
  variables: Readonly<Record<string, string>> | null;
  maxPngBytes: number;
}
export type ChartDrawResult =
  | { ok: true; png: Uint8Array; width: number; height: number }
  | { ok: false; status: number; code: string; message: string; hint?: string };

// The registered faces (./chart-fonts.server.ts), then what a Linux image commonly carries.
const SANS = `"${IMAGE_FONTS.sans}", "Liberation Sans", "DejaVu Sans", Arial, sans-serif`;
const MONO = `"${IMAGE_FONTS.mono}", "DejaVu Sans Mono", "Liberation Mono", monospace`;
const SERIF = `"${IMAGE_FONTS.serif}", "DejaVu Serif", "Liberation Serif", Georgia, serif`;
const GENERIC = /^(?:system-ui|ui-(?:sans-serif|serif|monospace|rounded)|sans-serif|serif|monospace|cursive|fantasy)$/i;

/** A CSS font-family list → its named families, then the installed fallbacks for its generic family. */
export function imageFontFamily(list: string | undefined): string {
  const families = (list ?? '').split(',').map(f => f.trim()).filter(Boolean);
  const generic = families.map(f => f.replace(/^["']|["']$/g, '').toLowerCase())
    .find(f => /^(?:ui-)?(?:monospace|serif)$/.test(f))?.replace('ui-', '');
  const named = families.filter(f => !GENERIC.test(f.replace(/^["']|["']$/g, '')));
  return [...named, generic === 'monospace' ? MONO : generic === 'serif' ? SERIF : SANS].join(', ');
}

/** The tokens one image draws with. */
export function imageTokens(variables: Readonly<Record<string, string>> | null, mode: 'light' | 'dark'): ChartTokens {
  if (!variables) return { ...houseTokens(mode), font: `"JetBrains Mono", ${MONO}` };
  const lookup = (name: string) => variables[name];
  const surface = resolveCssColor('var(--background)', lookup) ?? houseTokens(mode).surface;
  return tokensFromThemeVariables(name => resolveCssColor(`var(${name})`, lookup, surface),
    imageFontFamily(variables['--font-body']), mode);
}

/** No external reference survives into the SVG librsvg reads: hrefs keep only fragments and data images. */
export function inertSvg(svg: string): string {
  return svg
    .replace(/\s(xlink:href|href)\s*=\s*"(?!#|data:image\/(?:png|jpeg|gif|webp);)[^"]*"/gi, ' $1=""')
    .replace(/url\((?!\s*['"]?#)[^)]*\)/gi, 'none');
}

const refusal = (status: number, code: string, message: string, hint?: string): ChartDrawResult =>
  ({ ok: false, status, code, message, ...(hint ? { hint } : {}) });
const own = (spec: Record<string, unknown>, key: 'width' | 'height') => typeof spec[key] === 'number';
const COMPOSED = ['hconcat', 'vconcat', 'concat', 'repeat', 'facet'];

export async function drawChart(job: ChartDrawJob): Promise<ChartDrawResult> {
  const resolved = resolveChartDescription(job.description, job.rows);
  if (!resolved.ok) return refusal(400, 'invalid_chart', resolved.error);
  const tokens = imageTokens(job.variables, job.mode);
  const { spec, engine } = resolved.resolved;
  let svg: string;
  try {
    const plan = planChart(SERVER_ENGINES, resolved.resolved, job.rows, { width: job.width, height: job.height }, tokens);
    const composed = engine === 'vega-lite' && COMPOSED.some(k => k in spec);
    const view = createChartView(SERVER_ENGINES, plan.vegaSpec, job.rows, { renderer: 'none',
      ...(plan.parserConfig ? { parserConfig: plan.parserConfig } : {}) });
    view.logLevel(1);
    try {
      // The compiled `container` sizes initialise on the first run, so the slot size applies after it.
      await view.runAsync();
      resizeVegaView(view, { facetLayout: plan.facetLayout,
        ...(composed || own(spec, 'width') ? {} : { width: job.width }),
        ...(composed || own(spec, 'height') ? {} : { height: job.height }) });
      await view.runAsync();
      svg = await view.toSVG();
    } finally { view.finalize(); }
  } catch (error) {
    return refusal(400, 'invalid_chart', `the chart could not be drawn: ${error instanceof Error ? error.message : String(error)}`.slice(0, 500));
  }
  const size = /<svg\b[^>]*\swidth="([\d.]+)"[^>]*\sheight="([\d.]+)"/.exec(svg);
  const w = Number(size?.[1]), h = Number(size?.[2]);
  if (!(w > 0 && h > 0)) return refusal(400, 'invalid_chart', 'the chart drew nothing: give it marks, or rows to draw');
  const scale = Math.min(1, job.width / w, job.height / h);
  const image = () => sharp(Buffer.from(inertSvg(svg)), { density: 72 * scale, limitInputPixels: job.width * job.height * 4 })
    .flatten({ background: tokens.surface });
  let png = await image().png({ compressionLevel: 9, adaptiveFiltering: true }).toBuffer({ resolveWithObject: true });
  if (png.data.length > job.maxPngBytes) png = await image().png({ compressionLevel: 9, palette: true }).toBuffer({ resolveWithObject: true });
  if (png.data.length > job.maxPngBytes) {
    return refusal(422, 'image_too_large', `the PNG is ${png.data.length} bytes, past ${job.maxPngBytes}`,
      'ask for a smaller width and height, or draw fewer marks (aggregate the rows in SQL)');
  }
  return { ok: true, png: new Uint8Array(png.data), width: png.info.width, height: png.info.height };
}
