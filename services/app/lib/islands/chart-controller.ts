/**
 * THE CHART CONTROLLER — a `<Question>` chart as a FRAMEWORK-FREE controller over lib/viz (what
 * components/viz/VegaChart does inside React effects). Never imported statically: `chart.ts` loads
 * it on demand, so Vega arrives only when a chart must be drawn in the browser (its table changed,
 * or the reader interacts; docs/phase2-architecture.md §2.4).
 *
 * Builds the view, re-feeds rows, follows resizes and speaks the readiness contract
 * (`data-mx-chart-state`) through lib/viz/render-readiness. Not ported from VegaChart (parity gaps):
 * the shared multi-series tooltip guide, interactive-map zoom and view persistence, the legend-wrap
 * rebuild on resize, theme-change rebuilds.
 */
import { beginChartRender, trackChartRender } from '@/lib/viz/render-readiness';
import { computeFacetLayoutPlan, computeLegendPlan, computeXLabelAngle, createVegaView, injectNamedAssets, resizeVegaView, resolveEnvelopeSpec, setMainData, toVegaSpec } from '@/lib/viz/render-vega';
import { inferVizColumnsFromRows } from '@/lib/viz/query-data';
import { chartTokenRangeFromElement, resolveCssVarColors } from '@/lib/viz/chart-tokens';
import type { ChartController, ChartOptions, ChartRows } from './chart';

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
const message = (error: unknown) => (error instanceof Error ? error.message : String(error));

export function mountChart(el: HTMLElement, { envelope, rows, colorMode, onError }: ChartOptions): ChartController {
  let view: View | null = null;
  let vl: Record<string, unknown> | null = null;
  let current: ChartRows = rows;
  let disposed = false;
  const finish = beginChartRender(el);
  void (async () => {
    try {
      if (document.fonts?.ready) await document.fonts.ready;
      const resolved = resolveEnvelopeSpec(envelope, inferVizColumnsFromRows(current));
      if (!resolved.ok) throw new Error(resolved.error);
      vl = resolved.engine === 'vega-lite' ? resolved.spec : null;
      const legendPlan = vl ? computeLegendPlan(vl, current, el.clientWidth) : null;
      const xLabelAngle = vl ? computeXLabelAngle(vl, current, el.clientWidth) : null;
      const size = sizeOf(el);
      const facetLayout = vl ? computeFacetLayoutPlan(vl, current, size.width, size.height) : null;
      const { vegaSpec, parserConfig } = toVegaSpec(resolved, colorMode, { legendPlan, xLabelAngle, facetLayout, categoryRange: chartTokenRangeFromElement(el) });
      const cs = getComputedStyle(el);
      resolveCssVarColors(vegaSpec, (name) => cs.getPropertyValue(name));
      if (disposed) return;
      el.replaceChildren();
      view = createVegaView(vegaSpec, current, { renderer: 'svg', container: el, tooltipTheme: colorMode, ...(parserConfig ? { parserConfig } : {}), ...size, facetLayout });
      await injectNamedAssets(view, resolved.assets);
      await view.runAsync();
      promoteFontAttrs(el);
    } catch (error) {
      onError?.(message(error));
    } finally {
      finish();
    }
  })();
  const resize = new ResizeObserver(() => {
    const v = view;
    if (!v) return;
    const size = sizeOf(el);
    trackChartRender(el, () => resizeVegaView(v, { ...size, facetLayout: vl ? computeFacetLayoutPlan(vl, current, size.width, size.height) : null }).runAsync()).catch(() => {});
  });
  resize.observe(el);
  return {
    update(next) {
      current = next;
      const v = view;
      if (!v) return;
      setMainData(v, next);
      trackChartRender(el, () => v.runAsync()).then(() => promoteFontAttrs(el), (error: unknown) => onError?.(message(error)));
    },
    dispose() {
      disposed = true;
      resize.disconnect();
      view?.finalize();
    },
  };
}
