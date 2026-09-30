/**
 * THE CHART CONTROLLER — a `<Question>` chart as a FRAMEWORK-FREE controller over lib/viz (what
 * components/viz/VegaChart does inside React effects). Never imported statically: `chart.ts` loads
 * it on demand, so Vega arrives after reader readiness and chart visibility, a table change,
 * or a reader interaction.
 *
 * Builds the view, re-feeds rows, follows resizes (rebuilding when a resize flips the legend-wrap or
 * x-label-angle plan — those are compile-time constants baked into the parsed spec) and the reader's
 * theme (rebuilding on a light/dark or `data-theme` change), and speaks the readiness contract
 * (`data-mx-chart-state`) through lib/viz/render-readiness. Not ported from VegaChart (parity gaps):
 * the shared multi-series tooltip guide, interactive-map zoom and view persistence.
 */
import { beginChartRender, trackChartRender } from '@/lib/viz/render-readiness';
import { computeFacetLayoutPlan, computeLegendPlan, computeXLabelAngle, createVegaView, injectNamedAssets, resizeVegaView, resolveEnvelopeSpec, setMainData, toVegaSpec } from '@/lib/viz/render-vega';
import { inferVizColumnsFromRows } from '@/lib/viz/query-data';
import { chartTokenRangeFromElement, resolveCssVarColors } from '@/lib/viz/chart-tokens';
import { watchThemeMode } from './kit/theme-watch';
import type { IslandChart, IslandChartInput } from './contract';

type View = ReturnType<typeof createVegaView>;

const FONT_ATTRS = [['font-family', 'fontFamily'], ['font-size', 'fontSize'], ['font-weight', 'fontWeight'], ['font-style', 'fontStyle']] as const;
/** Vega writes fonts as SVG attributes; the page's CSS outranks those, so they move to inline style. */
const promoteFontAttrs = (root: HTMLElement) => {
  for (const t of root.querySelectorAll<SVGElement>('svg text')) for (const [attr, prop] of FONT_ATTRS) {
    const v = t.getAttribute(attr);
    if (v && t.style[prop] !== v) t.style[prop] = v;
  }
};
const sizeOf = (el: HTMLElement) => ({ width: Math.max(80, Math.floor(el.clientWidth)), height: Math.max(60, Math.floor(el.clientHeight)) });
/** The story element's colour mode (its `light`/`dark` class), which the chart themes with. */
const colorModeOf = (el: HTMLElement): 'light' | 'dark' => (el.closest('.dark') ? 'dark' : 'light');
/** A chart that cannot draw keeps whatever the slot shows (the server's drawing) and says why once. */
const onError = (el: HTMLElement, error: unknown) => {
  el.setAttribute('data-mx-chart-error', error instanceof Error ? error.message : String(error));
};

export function mountChart({ element: el, envelope, rows }: IslandChartInput): IslandChart {
  let view: View | null = null;
  let vl: Record<string, unknown> | null = null;
  let current: IslandChartInput['rows'] = rows;
  let disposed = false;
  let colorMode = colorModeOf(el);
  // Legend wrap + x label angle are compile-time CONSTANTS baked into the parsed spec — when a resize
  // flips either decision the view is rebuilt; plain resizes stay signal-only (resizeVegaView).
  let legendFingerprint = 'null';
  const legendFingerprintOf = (spec: Record<string, unknown> | null, width: number) => JSON.stringify({
    legend: spec ? computeLegendPlan(spec, current, width) ?? null : null,
    xAngle: spec ? computeXLabelAngle(spec, current, width) : null,
  });

  const build = () => {
    const finish = beginChartRender(el);
    void (async () => {
      try {
        if (document.fonts?.ready) await document.fonts.ready;
        if (disposed) return;
        colorMode = colorModeOf(el);
        const resolved = resolveEnvelopeSpec(envelope, inferVizColumnsFromRows(current));
        if (!resolved.ok) throw new Error(resolved.error);
        vl = resolved.engine === 'vega-lite' ? resolved.spec : null;
        const size = sizeOf(el);
        const legendPlan = vl ? computeLegendPlan(vl, current, size.width) : null;
        const xLabelAngle = vl ? computeXLabelAngle(vl, current, size.width) : null;
        legendFingerprint = legendFingerprintOf(vl, size.width);
        const facetLayout = vl ? computeFacetLayoutPlan(vl, current, size.width, size.height) : null;
        const { vegaSpec, parserConfig } = toVegaSpec(resolved, colorMode, { legendPlan, xLabelAngle, facetLayout, categoryRange: chartTokenRangeFromElement(el) });
        const cs = getComputedStyle(el);
        resolveCssVarColors(vegaSpec, (name) => cs.getPropertyValue(name));
        if (disposed) return;
        view?.finalize();
        el.replaceChildren();
        view = createVegaView(vegaSpec, current, { renderer: 'svg', container: el, tooltipTheme: colorMode, ...(parserConfig ? { parserConfig } : {}), ...size, facetLayout });
        await injectNamedAssets(view, resolved.assets);
        await view.runAsync();
        promoteFontAttrs(el);
      } catch (error) {
        onError(el, error);
      } finally {
        finish();
      }
    })();
  };
  build();

  const resize = new ResizeObserver(() => {
    const v = view;
    if (!v) return;
    const size = sizeOf(el);
    if (vl) {
      const next = legendFingerprintOf(vl, size.width);
      if (next !== legendFingerprint) { build(); return; }
    }
    trackChartRender(el, () => resizeVegaView(v, { ...size, facetLayout: vl ? computeFacetLayoutPlan(vl, current, size.width, size.height) : null }).runAsync()).catch(() => {});
  });
  resize.observe(el);

  // Design-theme chart tokens (`--chart-1..5`) and light/dark both flow through this rebuild: a
  // `data-theme` or `class` flip on an ancestor recolors the chart, same as VegaChart's colorMode prop.
  const stopTheme = watchThemeMode(el, () => build(), () => colorModeOf(el) !== colorMode);

  return {
    update(next) {
      current = next;
      const v = view;
      if (!v) return;
      setMainData(v, next);
      trackChartRender(el, () => v.runAsync()).then(() => promoteFontAttrs(el), (error: unknown) => onError(el, error));
    },
    destroy() {
      disposed = true;
      resize.disconnect();
      stopTheme();
      view?.finalize();
    },
  };
}
