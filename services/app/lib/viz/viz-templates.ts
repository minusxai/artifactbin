/**
 * SHIPPED recipe registry (the `recipe` source kind).
 *
 * A recipe instance stores ONLY the reference — {kind: 'recipe', recipe: 'x',
 * bindings} — and the spec is materialized at render time from this registry. Shipped
 * recipes are app code: they can't be deleted or shadowed, so a reference is safe
 * (workspace-authored `.viz` recipes can be, so they re-materialize on every read —
 * `recipe-file.ts`). The `@1` is a behavior contract: changing a builder's output in a
 * visually meaningful way means shipping `@2` and keeping `@1` frozen.
 */
import type { ColumnFormatConfig } from '@/lib/validation';
import type { VizResultColumn } from './types';

interface VizTemplateBinding {
  name: string;
  label: string;
  /** Column kinds this slot accepts (drives drop-zone hints; not enforced hard). */
  accepts: ReadonlyArray<'nominal' | 'quantitative' | 'temporal'>;
  /** Optional slots may be unbound (e.g. radar's series). */
  optional?: boolean;
  /** Multi-capable slots accept an array of columns (e.g. radar's value → one series each). */
  multi?: boolean;
}

type VizFormats = Record<string, ColumnFormatConfig> | undefined;

/** Display name for a bound column (alias wins). */
const aliasOf = (formats: VizFormats, column: string): string =>
  formats?.[column]?.alias || column;

/**
 * A vega expression rendering `ref` as a formatted number per the column's config.
 * A d3 `format` string is the vega-tier vocabulary and wins outright; the legacy
 * DOM-grid fields (decimalPoints/prefix/suffix) are honored as a fallback.
 * Strings are JSON-escaped into the expression.
 */
const numExpr = (ref: string, formats: VizFormats, column: string): string => {
  const cfg = formats?.[column];
  if (cfg?.format) return `format(${ref}, '${cfg.format.replace(/'/g, '')}')`;
  const pattern = cfg?.decimalPoints != null ? `,.${cfg.decimalPoints}f` : '.3~s';
  const core = `format(${ref}, '${pattern}')`;
  const pre = cfg?.prefix ? `${JSON.stringify(cfg.prefix)} + ` : '';
  const suf = cfg?.suffix ? ` + ${JSON.stringify(cfg.suffix)}` : '';
  return `${pre}${core}${suf}`;
};

type VizTemplateEngine = 'vega-lite' | 'vega';

type VizParams = Record<string, unknown> | null | undefined;

interface VizTemplate {
  id: string;
  /** The icon-grid type this recipe implements. */
  vizType: 'funnel' | 'waterfall' | 'radar' | 'trend' | 'single_value' | 'combo';
  /** Grammar of the materialized spec ('vega' skips the VL compile). */
  engine: VizTemplateEngine;
  bindings: ReadonlyArray<VizTemplateBinding>;
  /**
   * Materialize the full spec from bound column names (+ optional column formats and recipe
   * params). `columns` carries the query-result column KINDS when known at render time, so a
   * recipe can pick a temporal vs. discrete axis from the actual type rather than guessing.
   */
  build(bindings: Record<string, string | string[]>, formats?: VizFormats, params?: VizParams, columns?: VizResultColumn[]): Record<string, unknown>;
}

// ── funnel ─────────────────────────────────────────────────────────────
// Classic ECharts funnel: one tapered trapezoid PER STAGE (each spans its own value
// down to the next stage's; the last tapers to a tip), single hue with ZEBRA
// alternation (the two opacities below) so adjacent stages read as distinct bands.
// Stage order = data order. `orientation` param: 'vertical' (default, stages run
// top→bottom) or 'horizontal' (stages run left→right, taper vertical).
const FUNNEL_OPACITY_ODD = 0.92;
const FUNNEL_OPACITY_EVEN = 0.74;
const funnel: VizTemplate = {
  id: 'funnel',
  vizType: 'funnel',
  engine: 'vega-lite',
  bindings: [
    { name: 'stage', label: 'Stages', accepts: ['nominal', 'temporal'] },
    { name: 'value', label: 'Value', accepts: ['quantitative'] },
  ],
  build(bindings, formats, params) {
    const stage = String(bindings.stage);
    const value = String(bindings.value);
    const horizontal = (params as Record<string, unknown> | null | undefined)?.orientation === 'horizontal';
    const fmt = formats?.[value]?.format;
    // Clean tooltip (Stage + Value + % of top) — otherwise the auto encoding tooltip
    // leaks the recipe's internal geometry fields (__mx_x0/__mx_pos/…).
    const tooltip = [
      { field: stage, type: 'nominal', title: aliasOf(formats, stage) },
      { field: '__mx_value', type: 'quantitative', title: aliasOf(formats, value), ...(fmt ? { format: fmt } : {}) },
      { field: '__mx_pct', type: 'quantitative', title: '% of top', format: '.1f' },
    ];
    // The stage-sequence axis (rank positions) and the taper axis (±width/2). Each
    // band is its own two-point ranged area: the fold emits a top edge (this stage's
    // width at rank) and a bottom edge (the NEXT stage's width at rank+1) — linear
    // interpolation between them is the trapezoid. detail=rank splits the areas.
    const seq = {
      field: '__mx_pos', type: 'quantitative', axis: null,
      scale: horizontal ? { zero: false } : { reverse: true, zero: false },
    };
    const seqMid = {
      field: '__mx_mid', type: 'quantitative', axis: null,
      scale: horizontal ? { zero: false } : { reverse: true, zero: false },
    };
    const taper = { field: '__mx_x0', type: 'quantitative', axis: null };
    const taper2 = { field: '__mx_x1' };
    const center = { datum: 0, axis: null };
    // Text layers keep one row per stage (the fold doubled them) and sit at the
    // band's CENTER (rank + 0.5).
    const labelFilter = [{ filter: "datum.__mx_edge === '__mx_wa'" }];
    return {
      transform: [
        { aggregate: [{ op: 'sum', field: value, as: '__mx_value' }], groupby: [stage] },
        { window: [{ op: 'rank', as: '__mx_rank' }] },
        { window: [{ op: 'first_value', field: '__mx_value', as: '__mx_first' }], frame: [null, null] },
        // Next stage's width; the LAST stage tapers to a tip (ECharts minSize 0).
        { window: [{ op: 'lead', field: '__mx_value', as: '__mx_next' }], frame: [0, 1] },
        { calculate: 'datum.__mx_next != null ? datum.__mx_next : 0', as: '__mx_wb' },
        { calculate: 'datum.__mx_value', as: '__mx_wa' },
        { fold: ['__mx_wa', '__mx_wb'], as: ['__mx_edge', '__mx_w'] },
        { calculate: "datum.__mx_edge === '__mx_wa' ? datum.__mx_rank : datum.__mx_rank + 1", as: '__mx_pos' },
        { calculate: 'datum.__mx_rank + 0.5', as: '__mx_mid' },
        { calculate: '-datum.__mx_w / 2', as: '__mx_x0' },
        { calculate: 'datum.__mx_w / 2', as: '__mx_x1' },
        { calculate: 'datum.__mx_value / datum.__mx_first * 100', as: '__mx_pct' },
        { calculate: `${numExpr('datum.__mx_value', formats, value)} + ' (' + format(datum.__mx_pct, '.1f') + '%)'`, as: '__mx_label' },
      ],
      layer: [
        {
          mark: { type: 'area', interpolate: 'linear' },
          encoding: {
            ...(horizontal
              ? { x: seq, y: taper, y2: taper2 }
              : { y: seq, x: taper, x2: taper2 }),
            detail: { field: '__mx_rank' },
            // One thematic series; stage names and values are directly labeled.
            color: { datum: aliasOf(formats, value), type: 'nominal', legend: null },
            // Zebra: alternate band opacity on stage parity (odd ranks the brighter one).
            fillOpacity: {
              condition: { test: 'datum.__mx_rank % 2 === 1', value: FUNNEL_OPACITY_ODD },
              value: FUNNEL_OPACITY_EVEN,
            },
            tooltip,
          },
        },
        {
          transform: labelFilter,
          mark: { type: 'text', dy: -7, fontWeight: 'bold', tooltip: false },
          encoding: {
            ...(horizontal ? { x: seqMid, y: center } : { y: seqMid, x: center }),
            text: { field: stage, type: 'nominal' },
          },
        },
        {
          transform: labelFilter,
          mark: { type: 'text', dy: 8, tooltip: false },
          encoding: {
            ...(horizontal ? { x: seqMid, y: center } : { y: seqMid, x: center }),
            text: { field: '__mx_label', type: 'nominal' },
          },
        },
      ],
    };
  },
};

// ── waterfall ──────────────────────────────────────────────────────────
// Floating bars on a running total, data order preserved (waterfall order is
// semantic). Increases use the theme palette; decreases use the danger red —
// matching the classic ECharts waterfall. Value labels ride each bar.

const WATERFALL_COLOR_DOMAIN = ['Increase', 'Decrease', 'Total'];

const waterfall: VizTemplate = {
  id: 'waterfall',
  vizType: 'waterfall',
  engine: 'vega-lite',
  bindings: [
    { name: 'category', label: 'Steps', accepts: ['nominal', 'temporal'] },
    { name: 'value', label: 'Value', accepts: ['quantitative'] },
  ],
  build(bindings, formats) {
    const category = String(bindings.category);
    const value = String(bindings.value);
    const yTitle = aliasOf(formats, value);
    const catTitle = aliasOf(formats, category);
    const fmt = formats?.[value]?.format;
    const numTip = (field: string, title: string) => ({ field, type: 'quantitative', title, ...(fmt ? { format: fmt } : {}) });
    const x = { field: category, type: 'nominal', sort: null, title: catTitle };
    return {
      transform: [
        { aggregate: [{ op: 'sum', field: value, as: '__mx_amount' }], groupby: [category] },
        { window: [{ op: 'sum', field: '__mx_amount', as: '__mx_sum' }] },
        { calculate: 'datum.__mx_sum - datum.__mx_amount', as: '__mx_prev' },
        { calculate: "datum.__mx_amount < 0 ? 'Decrease' : 'Increase'", as: '__mx_direction' },
        { calculate: `datum.__mx_amount >= 0 ? '+' + ${numExpr('datum.__mx_amount', formats, value)} : ${numExpr('datum.__mx_amount', formats, value)}`, as: '__mx_label' },
      ],
      layer: [
        {
          mark: { type: 'bar', cornerRadiusEnd: 2 },
          encoding: {
            x,
            y: { field: '__mx_prev', type: 'quantitative', title: yTitle },
            y2: { field: '__mx_sum' },
            color: {
              field: '__mx_direction', type: 'nominal',
              scale: { domain: WATERFALL_COLOR_DOMAIN }, legend: { title: null },
            },
            // Clean tooltip (Step + change + running total) — no __mx internals leak.
            tooltip: [{ field: category, type: 'nominal', title: catTitle }, numTip('__mx_amount', yTitle), numTip('__mx_sum', 'Running total')],
          },
        },
        {
          // Keep signed labels outside either end of the bar, regardless of its color.
          mark: { type: 'text', dy: { expr: 'datum.__mx_amount < 0 ? 14 : -8' }, tooltip: false },
          encoding: {
            x,
            y: { field: '__mx_sum', type: 'quantitative', title: yTitle },
            text: { field: '__mx_label', type: 'nominal' },
          },
        },
        // Closing Total bar shares the same thematic scale and legend.
        {
          transform: [
            { aggregate: [{ op: 'sum', field: '__mx_amount', as: '__mx_total' }] },
            { calculate: "'Total'", as: category },
          ],
          mark: { type: 'bar', cornerRadiusEnd: 2 },
          encoding: {
            x,
            y: { field: '__mx_total', type: 'quantitative', title: yTitle },
            y2: { datum: 0 },
            color: { datum: 'Total', type: 'nominal', scale: { domain: WATERFALL_COLOR_DOMAIN }, legend: { title: null } },
            tooltip: [{ field: category, type: 'nominal', title: catTitle }, numTip('__mx_total', yTitle)],
          },
        },
        {
          transform: [
            { aggregate: [{ op: 'sum', field: '__mx_amount', as: '__mx_total' }] },
            { calculate: "'Total'", as: category },
            { calculate: numExpr('datum.__mx_total', formats, value), as: '__mx_total_label' },
          ],
          mark: { type: 'text', dy: -8, fontWeight: 'bold', tooltip: false },
          encoding: {
            x,
            y: { field: '__mx_total', type: 'quantitative', title: yTitle },
            text: { field: '__mx_total_label', type: 'nominal' },
          },
        },
      ],
    };
  },
};


// ── radar ──────────────────────────────────────────────────────────────
// NATIVE VEGA (no polar coordinates in vega-lite). Adapted from the official Vega
// radar example: angular point scale over metrics, linear radial scale, closed
// series polygons via trig, rule spokes, metric labels. Values SUM-aggregate per
// metric×series; the radial domain is [0, max] shared across metrics (bind
// pre-normalized values when metrics use different units).
const radar: VizTemplate = {
  id: 'radar',
  vizType: 'radar',
  engine: 'vega',
  bindings: [
    { name: 'metric', label: 'Metrics', accepts: ['nominal'] },
    { name: 'value', label: 'Value', accepts: ['quantitative'], multi: true },
    { name: 'series', label: 'Series', accepts: ['nominal'], optional: true },
  ],
  build(bindings, formats) {
    const metric = String(bindings.metric);
    const value = bindings.value;
    const series = bindings.series;
    const m = JSON.stringify(metric);
    const values = (Array.isArray(value) ? value : [value]).map(String);
    const multi = values.length > 1;
    const angular = (of: string) => `scale('angular', ${of}[${m}])`;
    // Multiple value columns fold into series (the measures ARE the series);
    // otherwise the optional series binding groups the rows. With neither, the
    // single series is NAMED AFTER the value column (alias when set) so the legend
    // reads like the classic ECharts radar ("revenue"), and the legend always shows.
    const seriesExpr = series && !multi
      ? `datum[${JSON.stringify(String(series))}]`
      : JSON.stringify(aliasOf(formats, values[0]));
    // Wide data: folded series names ARE column names — remap the aliased ones so
    // the legend shows display names (chained ternary over aliased columns only).
    const aliased = values.filter(v => formats?.[v]?.alias);
    const aliasRemap = aliased.length > 0
      ? [{
          type: 'formula', as: '__mx_series',
          expr: aliased.reduce(
            (acc, v) => `datum.__mx_series === ${JSON.stringify(v)} ? ${JSON.stringify(formats![v].alias)} : (${acc})`,
            'datum.__mx_series'),
        }]
      : [];
    const gridStroke = 'rgba(139, 148, 158, 0.35)'; // neutral in both modes
    const RINGS = 4;
    return {
      autosize: { type: 'fit', contains: 'padding' },
      signals: [
        { name: 'radius', update: 'min(width, height) / 2 * 0.72' },
      ],
      data: [
        { name: 'main' },
        {
          name: 'table',
          source: 'main',
          transform: multi
            ? [
                { type: 'fold', fields: values, as: ['__mx_series', '__mx_fold_value'] },
                ...aliasRemap,
                { type: 'aggregate', groupby: [String(metric), '__mx_series'], fields: ['__mx_fold_value'], ops: ['sum'], as: ['__mx_value'] },
              ]
            : [
                { type: 'formula', as: '__mx_series', expr: seriesExpr },
                { type: 'aggregate', groupby: [String(metric), '__mx_series'], fields: [values[0]], ops: ['sum'], as: ['__mx_value'] },
              ],
        },
        { name: 'keys', source: 'table', transform: [{ type: 'aggregate', groupby: [metric] }] },
        // grid levels for the concentric ring polygons (ECharts-style)
        { name: 'rings', transform: [{ type: 'sequence', start: 1, stop: RINGS + 1, as: 'lvl' }] },
      ],
      scales: [
        // First metric at 12 o'clock (ECharts convention): angles run from -PI/2,
        // stopping one step short of the full turn so first/last don't overlap.
        {
          name: 'angular', type: 'point', padding: 0,
          range: { signal: `[-PI/2, 3*PI/2 - 2*PI/max(1, length(data('keys')))]` },
          domain: { data: 'table', field: metric },
        },
        { name: 'radial', type: 'linear', range: [0, { signal: 'radius' }], zero: true, nice: false, domain: { data: 'table', field: '__mx_value' } },
        { name: 'color', type: 'ordinal', domain: { data: 'table', field: '__mx_series' }, range: 'category' },
      ],
      legends: [{ fill: 'color', symbolType: 'circle' }],
      marks: [
        {
          type: 'group',
          encode: { enter: { x: { signal: 'width / 2' }, y: { signal: 'height / 2' } } },
          marks: [
            // concentric grid polygons, one per level
            {
              type: 'group',
              from: { data: 'rings' },
              marks: [
                {
                  type: 'line',
                  from: { data: 'keys' },
                  encode: {
                    update: {
                      interpolate: { value: 'linear-closed' },
                      x: { signal: `radius * (parent.lvl / ${RINGS}) * cos(${angular('datum')})` },
                      y: { signal: `radius * (parent.lvl / ${RINGS}) * sin(${angular('datum')})` },
                      stroke: { value: gridStroke },
                      strokeWidth: { value: 1 },
                      fill: { value: 'rgba(139, 148, 158, 0.045)' },
                    },
                  },
                },
              ],
            },
            // spokes
            {
              type: 'rule',
              from: { data: 'keys' },
              encode: {
                update: {
                  x: { value: 0 },
                  y: { value: 0 },
                  x2: { signal: `radius * cos(${angular('datum')})` },
                  y2: { signal: `radius * sin(${angular('datum')})` },
                  stroke: { value: gridStroke },
                  strokeWidth: { value: 1 },
                },
              },
            },
            // series polygons + vertex points
            {
              type: 'group',
              from: { facet: { data: 'table', name: 'facet', groupby: '__mx_series' } },
              marks: [
                {
                  type: 'line',
                  from: { data: 'facet' },
                  encode: {
                    update: {
                      interpolate: { value: 'linear-closed' },
                      x: { signal: `scale('radial', datum.__mx_value) * cos(${angular('datum')})` },
                      y: { signal: `scale('radial', datum.__mx_value) * sin(${angular('datum')})` },
                      stroke: { scale: 'color', field: '__mx_series' },
                      strokeWidth: { value: 2 },
                      fill: { scale: 'color', field: '__mx_series' },
                      fillOpacity: { value: 0.15 },
                    },
                  },
                },
                {
                  type: 'symbol',
                  from: { data: 'facet' },
                  encode: {
                    update: {
                      x: { signal: `scale('radial', datum.__mx_value) * cos(${angular('datum')})` },
                      y: { signal: `scale('radial', datum.__mx_value) * sin(${angular('datum')})` },
                      fill: { scale: 'color', field: '__mx_series' },
                      size: { value: 70 },
                      tooltip: { signal: `{${JSON.stringify(aliasOf(formats, metric))}: datum[${m}], 'Series': datum.__mx_series, 'Value': ${numExpr('datum.__mx_value', formats, values[0])}}` },
                    },
                  },
                },
                // Invisible hover HALO over each vertex: the visible dot is a ~9px hit
                // target, so without this the tooltip reads as broken ("hover shows
                // nothing") unless the cursor lands exactly on it. A large near-zero-
                // opacity symbol is still painted, so it captures hover and carries
                // the same tooltip.
                {
                  type: 'symbol',
                  from: { data: 'facet' },
                  encode: {
                    update: {
                      x: { signal: `scale('radial', datum.__mx_value) * cos(${angular('datum')})` },
                      y: { signal: `scale('radial', datum.__mx_value) * sin(${angular('datum')})` },
                      fill: { scale: 'color', field: '__mx_series' },
                      fillOpacity: { value: 0.001 },
                      size: { value: 900 },
                      tooltip: { signal: `{${JSON.stringify(aliasOf(formats, metric))}: datum[${m}], 'Series': datum.__mx_series, 'Value': ${numExpr('datum.__mx_value', formats, values[0])}}` },
                    },
                  },
                },
              ],
            },
            // metric labels
            {
              type: 'text',
              from: { data: 'keys' },
              encode: {
                update: {
                  x: { signal: `(radius + 12) * cos(${angular('datum')})` },
                  y: { signal: `(radius + 12) * sin(${angular('datum')})` },
                  text: { field: metric },
                  align: { signal: `cos(${angular('datum')}) > 0.05 ? 'left' : (cos(${angular('datum')}) < -0.05 ? 'right' : 'center')` },
                  baseline: { signal: `sin(${angular('datum')}) > 0.05 ? 'top' : (sin(${angular('datum')}) < -0.05 ? 'bottom' : 'middle')` },
                },
              },
            },
          ],
        },
      ],
    };
  },
};

// Trend card layout (the recipe follows). The KPI header forms a centered two-column lockup: the value is RIGHT
// aligned to an inner edge; the metric, delta pill, and period are LEFT aligned from the opposite edge. The pill hugs
// its rendered text — JetBrains Mono is monospace (≈0.62em advance), so its pixel width is
// length × fontSize × 0.62 + padding. The KPI block anchors to the top of the card. Tall dashboard tiles grow the
// chart, while the oversized value can borrow space from its quiet edge.
const MONO_ADVANCE = 0.62;
const VALUE_ADVANCE = 0.57;
const VALUE_TRACKING_EM = -0.05;
const valueColX = "bandwidth('slot') * 0.56";
const rightColX = "bandwidth('slot') * 0.62";
const deltaTextExpr = "!isValid(datum.__mx_pct) ? '—' : (datum.__mx_pct > 0 ? '↗ ' : (datum.__mx_pct < 0 ? '↘ ' : '→ ')) + format(abs(datum.__mx_pct), '.1f') + '%'";
const pillWidthExpr = `length(datum.__mx_deltatext) * deltaSize * ${MONO_ADVANCE} + 20`;
// Slightly tighter value tracking converts unused vertical room beside the
// date row into a taller number without crossing the center gutter.
const valueFontExpr = `max(18, min(valueSize, bandwidth('slot') * 0.54 / max(length(datum.__mx_valuetext) * ${VALUE_ADVANCE}, 1)))`;
const valueTrackingExpr = `(${valueFontExpr}) * ${VALUE_TRACKING_EM}`;
// History-fade + area-veil gradients need rgba stops of the series color.
const seriesRgba = (alpha: number) =>
  `'rgba(' + rgb(scale('color', datum.__mx_series)).r + ',' + rgb(scale('color', datum.__mx_series)).g + ',' + rgb(scale('color', datum.__mx_series)).b + ',${alpha})'`;
const pctExpr = "(isValid(datum.__mx_prev) && datum.__mx_prev !== 0) ? (datum.__mx_value - datum.__mx_prev) / abs(datum.__mx_prev) * 100 : null";
const deltaColor = { up: '#27ae60', down: '#c0392b', flat: '#8b949e' };
const deltaTint = { up: 'rgba(39,174,96,0.12)', down: 'rgba(192,57,43,0.12)', flat: 'rgba(139,148,158,0.12)' };

/** The trend card's sparkline: veil, fading line, hover targets and the beacon at the latest point. */
const trendSparkMarks = (interp: string, pointTooltipExpr: string) => [
  {
    type: 'area',
    name: '__mx_spark_area',
    from: { data: 'card' },
    encode: {
      update: {
        interpolate: { value: interp },
        x: { scale: '__mx_spark_x', field: '__mx_idx' },
        y: { scale: '__mx_spark_y', field: '__mx_disp' },
        y2: { signal: 'plotBottom' },
        fill: { signal: `{gradient: 'linear', x1: 0, y1: 0, x2: 0, y2: 1, stops: [{offset: 0, color: scale('color', datum.__mx_series)}, {offset: 1, color: ${seriesRgba(0)}}]}` },
        fillOpacity: { value: 0.16 },
      },
    },
  },
  {
    type: 'line',
    name: '__mx_spark_line',
    from: { data: 'card' },
    encode: {
      update: {
        interpolate: { value: interp },
        x: { scale: '__mx_spark_x', field: '__mx_idx' },
        y: { scale: '__mx_spark_y', field: '__mx_disp' },
        // History fades in from the past: near-transparent at the
        // oldest point, full series color at the latest.
        stroke: { signal: `{gradient: 'linear', x1: 0, y1: 0, x2: 1, y2: 0, stops: [{offset: 0, color: ${seriesRgba(0.14)}}, {offset: 0.55, color: ${seriesRgba(0.55)}}, {offset: 1, color: scale('color', datum.__mx_series)}]}` },
        strokeWidth: { value: 2.5 },
        strokeCap: { value: 'round' },
        strokeJoin: { value: 'round' },
      },
      hover: { strokeWidth: { value: 3.5 } },
    },
  },
  // Large transparent hit targets preserve the clean chart while
  // making every point easy to inspect with a mouse or trackpad.
  {
    type: 'symbol',
    name: '__mx_hover_points',
    from: { data: 'card' },
    encode: {
      update: {
        x: { scale: '__mx_spark_x', field: '__mx_idx' },
        y: { scale: '__mx_spark_y', field: '__mx_disp' },
        fill: { scale: 'color', field: '__mx_series' },
        fillOpacity: { value: 0 },
        strokeOpacity: { value: 0 },
        size: { value: 360 },
        tooltip: { signal: pointTooltipExpr },
      },
      hover: {
        fillOpacity: { value: 0.18 },
        size: { value: 360 },
      },
    },
  },
  // The beacon: a soft halo + solid core marking "now" at the
  // end of the fading-history ribbon.
  {
    type: 'symbol',
    name: '__mx_latest_point',
    from: { data: '__mx_latest' },
    interactive: false,
    encode: {
      update: {
        x: { scale: '__mx_spark_x', field: '__mx_idx' },
        y: { scale: '__mx_spark_y', field: '__mx_disp' },
        fill: { scale: 'color', field: '__mx_series' },
        fillOpacity: { value: 0.14 },
        size: { value: 300 },
      },
    },
  },
  {
    type: 'symbol',
    name: '__mx_latest_core',
    from: { data: '__mx_latest' },
    encode: {
      update: {
        x: { scale: '__mx_spark_x', field: '__mx_idx' },
        y: { scale: '__mx_spark_y', field: '__mx_disp' },
        fill: { scale: 'color', field: '__mx_series' },
        size: { value: 60 },
      },
      hover: { size: { value: 90 } },
    },
  },
];

/** The trend card's KPI lockup: delta pill, metric label, the big value, delta text and period. */
const trendKpiMarks = (sparkline: boolean, valueColor: string | null, dateLabelExpr: string) => [
  // The delta pill: the KPI's one piece of chrome — a tinted chip
  // hugging the delta text, colored by direction.
  {
    type: 'rect',
    name: '__mx_delta_pill',
    from: { data: 'kpi' },
    interactive: false,
    encode: {
      update: {
        x: { signal: rightColX },
        x2: { signal: `${rightColX} + datum.__mx_pillw` },
        y: { signal: 'contextCenter - deltaSize * 0.82' },
        y2: { signal: 'contextCenter + deltaSize * 0.82' },
        cornerRadius: { signal: 'deltaSize * 0.82' },
        fill: { signal: `!isValid(datum.__mx_pct) ? '${deltaTint.flat}' : (datum.__mx_pct > 0 ? '${deltaTint.up}' : (datum.__mx_pct < 0 ? '${deltaTint.down}' : '${deltaTint.flat}'))` },
      },
    },
  },
  // KPI marks deliberately render last so the data can pass behind them
  // without compromising the number's hierarchy.
  {
    type: 'text',
    from: { data: 'kpi' },
    interactive: false,
    encode: {
      update: {
        x: { signal: rightColX },
        y: { signal: 'contextCenter - deltaSize * 0.82 - 6' },
        align: { value: 'left' },
        baseline: { value: 'bottom' },
        text: { signal: "upper(replace(datum.__mx_series, /_/g, ' '))" },
        fontSize: { signal: 'labelSize' },
        fontWeight: { value: '600' },
        letterSpacing: { value: 1.2 },
        limit: { signal: "bandwidth('slot') * 0.34" },
        opacity: { value: 0.7 },
      },
    },
  },
  {
    type: 'text',
    from: { data: 'kpi' },
    interactive: false,
    encode: {
      update: {
        x: { signal: valueColX },
        y: { signal: sparkline ? `16 + (${valueFontExpr}) / 2` : 'height / 2' },
        align: { value: 'right' },
        baseline: { value: 'middle' },
        text: { field: '__mx_valuetext' },
        fontSize: { signal: valueFontExpr },
        fontWeight: { value: 'bold' },
        letterSpacing: { signal: valueTrackingExpr },
        fill: valueColor ? { value: valueColor } : { scale: 'color', field: '__mx_series' },
      },
    },
  },
  {
    type: 'text',
    from: { data: 'kpi' },
    interactive: false,
    encode: {
      update: {
        x: { signal: `${rightColX} + datum.__mx_pillw / 2` },
        y: { signal: 'contextCenter' },
        baseline: { value: 'middle' },
        align: { value: 'center' },
        text: { field: '__mx_deltatext' },
        fontSize: { signal: 'deltaSize' },
        fontWeight: { value: 'bold' },
        fill: { signal: `!isValid(datum.__mx_pct) ? '${deltaColor.flat}' : (datum.__mx_pct > 0 ? '${deltaColor.up}' : (datum.__mx_pct < 0 ? '${deltaColor.down}' : '${deltaColor.flat}'))` },
      },
    },
  },
  {
    type: 'text',
    from: { data: 'kpi' },
    interactive: false,
    encode: {
      update: {
        x: { signal: rightColX },
        y: { signal: 'contextCenter + deltaSize * 0.82 + 6' },
        baseline: { value: 'top' },
        align: { value: 'left' },
        text: { signal: dateLabelExpr },
        fontSize: { signal: 'dateSize' },
        limit: { signal: "bandwidth('slot') * 0.34" },
        opacity: { value: 0.62 },
      },
    },
  },
];

// ── trend ──────────────────────────────────────────────────────────────
// KPI cards on the NATIVE VEGA engine: one card per bound measure — big value,
// delta vs the comparison period, period labels, and a sparkline.
// Comparison semantics:
// 'last' = last vs second-to-last (includes the possibly-partial current period);
// 'previous' = second-to-last vs third-to-last with 3+ points (skips the partial
// period); exactly 2 points always compare directly. Rows are consumed in QUERY
// ORDER (SQL owns semantics — ORDER BY the date ascending).
//
// Params: compareMode ('last'|'previous'), sparkline (boolean, default true),
// smooth (boolean, default true — basis spline; false = monotone through points),
// valueFontSize/deltaFontSize/labelFontSize/dateFontSize (numbers — each size is
// independently adjustable; defaults are responsive signals),
// trendColor/valueColor — either a theme token reference ('var(--foreground)',
// 'var(--chart-2)': resolved per build from the surrounding theme scope, so it
// follows theme AND mode switches — see resolveCssVarColors), or a raw CSS
// color (hex/rgb/named, never oklch: the gradients go through d3-color), which
// is a deliberate pin. trendColor drives the series everywhere it paints;
// valueColor the big numeral alone, defaulting to trendColor. Omit both and
// the theme's --chart tokens stay in charge.
//
// Composition: the KPI block is a two-column strip (full-height value on the
// left / centered label + delta pill + period stack on the right) at the top of
// the card. The sparkline clears the compact right stack but may pass beneath the
// oversized value at its quiet, transparent left edge. The line stroke fades in
// from the past (near-transparent history → full series color at the latest point)
// and terminates in a single beacon dot.
const trend: VizTemplate = {
  id: 'trend',
  vizType: 'trend',
  engine: 'vega',
  bindings: [
    { name: 'date', label: 'Date / Order', accepts: ['temporal', 'nominal'] },
    { name: 'value', label: 'Values', accepts: ['quantitative'], multi: true },
  ],
  build(bindings, formats, params) {
    const date = String(bindings.date);
    const values = (Array.isArray(bindings.value) ? bindings.value : [bindings.value]).map(String);
    const multi = values.length > 1;
    const p = (params ?? {}) as Record<string, unknown>;
    const compareMode = p.compareMode === 'previous' ? 'previous' : 'last';
    const sparkline = p.sparkline !== false;
    /*
     * Color pins. Default is the themed `category` range (--chart tokens), the
     * theme-following path; `trendColor` pins the SERIES color — one string,
     * every card, and everything derived (sparkline, gradients, beacon, the
     * numeral's default fill) follows because it all reads scale('color', …).
     * `valueColor` overrides the numeral alone, falling back to the series.
     * Strings only: hex/rgb/named — the gradients go through d3-color
     * (rgb(scale(…))), which cannot parse oklch; a junk value is ignored, the
     * same fail-open stance as every other param.
     */
    const trendColor = typeof p.trendColor === 'string' && p.trendColor.trim() !== '' ? p.trendColor.trim() : null;
    const valueColor = typeof p.valueColor === 'string' && p.valueColor.trim() !== '' ? p.valueColor.trim() : trendColor;
    // Ordinal scales pair domain and range by index — one entry per measure.
    const colorRange: string[] | 'category' = trendColor ? values.map(() => trendColor) : 'category';

    // Base row per compareMode: 'last' bases on the
    // final point; 'previous' on the second-to-last when 3+ points exist (the
    // 2-point case always compares the two directly).
    const baseExpr = compareMode === 'previous'
      ? 'datum.__mx_idx === (datum.__mx_n >= 3 ? datum.__mx_n - 1 : datum.__mx_n)'
      : 'datum.__mx_idx === datum.__mx_n';

    // Per-card value formatting: cards carry their ORIGINAL column in __mx_col, so
    // the format expression chains a ternary across the bound measures.
    const valueTextExpr = values.slice(1).reduce(
      (acc, v) => `datum.__mx_col === ${JSON.stringify(v)} ? ${numExpr('datum.__mx_value', formats, v)} : (${acc})`,
      numExpr('datum.__mx_value', formats, values[0]),
    );

    // Period labels: d3 time pattern from the date column's format (when it looks
    // like one), else readable defaults; non-date strings pass through raw. The
    // visible period label stays SHORT ("Nov 30 vs Oct 31"); tooltips keep the
    // full unambiguous date.
    const dateCfg = formats?.[date]?.format;
    const customDateFmt = dateCfg && dateCfg.includes('%') ? dateCfg.replace(/'/g, '') : null;
    const labelDateFmt = customDateFmt ?? '%b %d';
    const tooltipDateFmt = customDateFmt ?? '%b %d, %Y';
    const fmtDate = (ref: string, fmt: string) => `(toDate(${ref}) ? timeFormat(toDate(${ref}), '${fmt}') : '' + ${ref})`;
    const pointTooltipExpr = `{'Metric': replace(datum.__mx_series, /_/g, ' '), 'Date': ${fmtDate('datum.__mx_date', tooltipDateFmt)}, 'Value': ${valueTextExpr}}`;
    const dateLabelExpr = `${fmtDate('datum.__mx_date', labelDateFmt)} + (isValid(datum.__mx_prev_date) ? ' vs ' + ${fmtDate('datum.__mx_prev_date', labelDateFmt)} : '')`;

    // Folded series names ARE column names — remap aliased ones for display (same
    // chained-ternary idiom as radar). __mx_col keeps the original for formats.
    const aliased = values.filter(v => formats?.[v]?.alias);
    const aliasRemap = aliased.length > 0
      ? [{
          type: 'formula', as: '__mx_series',
          expr: aliased.reduce(
            (acc, v) => `datum.__mx_series === ${JSON.stringify(v)} ? ${JSON.stringify(formats![v].alias)} : (${acc})`,
            'datum.__mx_series'),
        }]
      : [];

    const sizeSignal = (name: string, override: unknown, responsive: string) => ({
      name,
      update: typeof override === 'number' && Number.isFinite(override) ? String(override) : responsive,
    });

    const interp = p.smooth === false ? 'monotone' : 'basis';

    return {
      autosize: { type: 'fit', contains: 'padding' },
      signals: [
        // Only the left value grows into poster scale. Supporting type responds
        // independently, so enlarging the number never inflates the right stack.
        // The vertical cap sits high enough that the per-text width fit (the
        // 0.54-bandwidth left column) is what usually binds — so the number
        // grows leftward to fill its column instead of stalling mid-card.
        sizeSignal('valueSize', p.valueFontSize, "clamp(min(bandwidth('slot') / 3.4, height * 0.6), 32, 176)"),
        sizeSignal('deltaSize', p.deltaFontSize, "clamp(min(bandwidth('slot') * 0.04, height * 0.07), 12, 20)"),
        sizeSignal('labelSize', p.labelFontSize, "clamp(min(bandwidth('slot') * 0.035, height * 0.06), 11, 17)"),
        sizeSignal('dateSize', p.dateFontSize, "clamp(min(bandwidth('slot') * 0.032, height * 0.055), 11, 16)"),
        // The plot clears the compact RIGHT stack only. The oversized value is
        // intentionally free to hang into the plot's quiet, transparent left edge.
        { name: 'contextHeight', update: 'labelSize + deltaSize * 1.64 + dateSize + 16' },
        { name: 'contextCenter', update: sparkline ? 'contextHeight / 2 + 16' : 'height / 2' },
        { name: 'plotTop', update: 'contextCenter + contextHeight / 2 + 4' },
        { name: 'plotBottom', update: 'max(height - 14, plotTop + 20)' },
      ],
      data: [
        { name: 'main' },
        {
          name: 'points',
          source: 'main',
          transform: [
            { type: 'formula', as: '__mx_date', expr: `datum[${JSON.stringify(date)}]` },
            ...(multi
              ? [
                  { type: 'fold', fields: values, as: ['__mx_series', '__mx_fold_value'] },
                  { type: 'formula', as: '__mx_col', expr: 'datum.__mx_series' },
                  ...aliasRemap,
                  { type: 'aggregate', groupby: ['__mx_date', '__mx_col', '__mx_series'], fields: ['__mx_fold_value'], ops: ['sum'], as: ['__mx_value'] },
                ]
              : [
                  { type: 'formula', as: '__mx_col', expr: JSON.stringify(values[0]) },
                  { type: 'formula', as: '__mx_series', expr: JSON.stringify(aliasOf(formats, values[0])) },
                  { type: 'aggregate', groupby: ['__mx_date', '__mx_col', '__mx_series'], fields: [values[0]], ops: ['sum'], as: ['__mx_value'] },
                ]),
            { type: 'window', groupby: ['__mx_series'], ops: ['row_number'], as: ['__mx_idx'] },
            { type: 'window', groupby: ['__mx_series'], ops: ['lag', 'lag'], fields: ['__mx_value', '__mx_date'], params: [1, 1], as: ['__mx_prev', '__mx_prev_date'] },
            { type: 'joinaggregate', groupby: ['__mx_series'], ops: ['count'], as: ['__mx_n'] },
            // Dense series (daily grain and finer) draw a calm ribbon: the marks
            // ride a centered moving average while KPI math and tooltips keep
            // the TRUE values. Sparse series draw their raw points.
            { type: 'window', groupby: ['__mx_series'], ops: ['mean'], fields: ['__mx_value'], frame: [-2, 2], as: ['__mx_ma'] },
            { type: 'formula', as: '__mx_disp', expr: 'datum.__mx_n >= 30 ? datum.__mx_ma : datum.__mx_value' },
          ],
        },
      ],
      scales: [
        { name: 'slot', type: 'band', domain: { data: 'points', field: '__mx_series' }, range: 'width', paddingInner: 0.08 },
        { name: 'color', type: 'ordinal', domain: { data: 'points', field: '__mx_series' }, range: colorRange },
      ],
      marks: [
        {
          type: 'group',
          from: { facet: { data: 'points', name: 'card', groupby: '__mx_series' } },
          data: [
            {
              name: 'kpi',
              source: 'card',
              transform: [
                { type: 'filter', expr: baseExpr },
                // Materialize the formatted value so its type can fit the left
                // column without spilling into the right-side context stack.
                { type: 'formula', as: '__mx_valuetext', expr: valueTextExpr },
                { type: 'formula', as: '__mx_pct', expr: pctExpr },
                // Materialize the rendered delta string so the pill can measure it.
                { type: 'formula', as: '__mx_deltatext', expr: deltaTextExpr },
                { type: 'formula', as: '__mx_pillw', expr: pillWidthExpr },
              ],
            },
            {
              name: '__mx_latest',
              source: 'card',
              transform: [{ type: 'filter', expr: 'datum.__mx_idx === datum.__mx_n' }],
            },
          ],
          encode: {
            update: {
              x: { scale: 'slot', field: '__mx_series' },
              width: { signal: "bandwidth('slot')" },
              height: { signal: 'height' },
            },
          },
          ...(sparkline
            ? {
                scales: [
                  { name: '__mx_spark_x', type: 'point', domain: { data: 'card', field: '__mx_idx' }, range: [{ signal: "bandwidth('slot') * 0.04" }, { signal: "bandwidth('slot') * 0.96" }] },
                  { name: '__mx_spark_y', type: 'linear', domain: { data: 'card', field: '__mx_disp' }, nice: true, zero: false, range: [{ signal: 'plotBottom' }, { signal: 'plotTop' }] },
                ],
              }
            : {}),
          marks: [
            ...(sparkline ? trendSparkMarks(interp, pointTooltipExpr) : []),
            ...trendKpiMarks(sparkline, valueColor, dateLabelExpr),
          ],
        },
      ],
    };
  },
};

// ── single-value ───────────────────────────────────────────────────────
// One bound measure rendered as a cardless data poster. The FIRST query row owns
// the value (matching the classic single-value viz); SQL owns which row that is.
// The field alias and numeric format come from columnFormats. Typography scales to
// the container, while the optional params remain a compact customization surface:
// showLabel, label, caption, align, valueFontSize, labelFontSize, captionFontSize,
// and valueColor.
const singleValue: VizTemplate = {
  id: 'single-value',
  vizType: 'single_value',
  engine: 'vega',
  bindings: [
    { name: 'value', label: 'Value', accepts: ['quantitative'] },
  ],
  build(bindings, formats, params) {
    const value = String(bindings.value);
    const p = (params ?? {}) as Record<string, unknown>;
    const rawLabel = typeof p.label === 'string' ? p.label : aliasOf(formats, value);
    const label = rawLabel.toUpperCase();
    const caption = typeof p.caption === 'string' ? p.caption : '';
    const showLabel = p.showLabel !== false && label.length > 0;
    const align = p.align === 'left' || p.align === 'right' ? p.align : 'center';
    const x = align === 'left' ? 'width * 0.06' : align === 'right' ? 'width * 0.94' : 'width / 2';
    const formattedValue = numExpr('datum.__mx_value', formats, value);
    const displayValue = `isValid(datum.__mx_value) ? ${formattedValue} : '—'`;
    const valueColor = typeof p.valueColor === 'string' && p.valueColor.trim()
      ? { value: p.valueColor.trim() }
      : { signal: `scale('color', ${JSON.stringify(label || value)})` };
    const sizeSignal = (name: string, override: unknown, responsive: string) => ({
      name,
      update: typeof override === 'number' && Number.isFinite(override) ? String(override) : responsive,
    });

    return {
      autosize: { type: 'fit', contains: 'padding' },
      signals: [
        sizeSignal('valueSize', p.valueFontSize, 'clamp(min(width / 5.2, height * 0.3), 28, 112)'),
        sizeSignal('labelSize', p.labelFontSize, 'clamp(valueSize * 0.2, 10, 18)'),
        sizeSignal('captionSize', p.captionFontSize, 'clamp(valueSize * 0.17, 9, 15)'),
        { name: 'valueY', update: showLabel || caption ? 'height * 0.5' : 'height / 2' },
      ],
      data: [
        { name: 'main' },
        {
          name: 'kpi',
          source: 'main',
          transform: [
            { type: 'formula', as: '__mx_value', expr: `datum[${JSON.stringify(value)}]` },
            { type: 'window', ops: ['row_number'], as: ['__mx_idx'] },
            { type: 'filter', expr: 'datum.__mx_idx === 1' },
          ],
        },
      ],
      scales: [
        { name: 'color', type: 'ordinal', domain: [label || value], range: 'category' },
      ],
      marks: [
        ...(showLabel ? [{
          type: 'text',
          name: '__mx_label',
          interactive: false,
          encode: {
            update: {
              x: { signal: x },
              y: { signal: 'valueY - valueSize * 0.78' },
              align: { value: align },
              baseline: { value: 'middle' },
              text: { value: label },
              fontSize: { signal: 'labelSize' },
              fontWeight: { value: 650 },
              letterSpacing: { value: 1.1 },
              opacity: { value: 0.68 },
            },
          },
        }] : []),
        {
          type: 'text',
          name: '__mx_value',
          from: { data: 'kpi' },
          encode: {
            update: {
              x: { signal: x },
              y: { signal: 'valueY' },
              align: { value: align },
              baseline: { value: 'middle' },
              text: { signal: displayValue },
              fontSize: { signal: `min(valueSize, width / max(length(${displayValue}) * 0.64, 1))` },
              fontWeight: { value: 700 },
              fill: valueColor,
              tooltip: { signal: `{'Metric': ${JSON.stringify(rawLabel || value)}, 'Value': ${displayValue}}` },
            },
            hover: {
              opacity: { value: 0.82 },
            },
          },
        },
        ...(caption ? [{
          type: 'text',
          name: '__mx_caption',
          interactive: false,
          encode: {
            update: {
              x: { signal: x },
              y: { signal: 'valueY + valueSize * 0.82' },
              align: { value: align },
              baseline: { value: 'middle' },
              text: { value: caption },
              fontSize: { signal: 'captionSize' },
              opacity: { value: 0.58 },
            },
          },
        }] : []),
      ],
    };
  },
};

// ── combo ─────────────────────────────────────────────────────────────
// Canonical dual-axis composition: quiet bars establish magnitude, one crisp line
// carries the contrasting measure. An optional categorical split colors/groups both
// layers consistently. Both layers share one X encoding and color scale while their
// Y scales resolve independently. A temporal x column gets a real temporal scale;
// everything else stays ordinal, because combo charts compare aligned
// periods/categories rather than interpolate a continuous domain.
const combo: VizTemplate = {
  id: 'combo',
  vizType: 'combo',
  engine: 'vega-lite',
  bindings: [
    { name: 'x', label: 'X-Axis', accepts: ['nominal', 'temporal'] },
    { name: 'bar', label: 'Bars', accepts: ['quantitative'] },
    { name: 'line', label: 'Line', accepts: ['quantitative'] },
    { name: 'series', label: 'Color / Split', accepts: ['nominal'], optional: true },
  ],
  build(bindings, formats, params, columns) {
    const x = String(bindings.x);
    const bar = String(bindings.bar);
    const line = String(bindings.line);
    const series = typeof bindings.series === 'string' && bindings.series ? bindings.series : null;
    const p = (params ?? {}) as Record<string, unknown>;
    const barTitle = aliasOf(formats, bar);
    const lineTitle = aliasOf(formats, line);
    const xTitle = aliasOf(formats, x);
    const seriesTitle = series ? aliasOf(formats, series) : null;
    const barOpacity = typeof p.barOpacity === 'number' && Number.isFinite(p.barOpacity)
      ? Math.min(1, Math.max(0.1, p.barOpacity))
      : 0.72;
    const lineWidth = typeof p.lineWidth === 'number' && Number.isFinite(p.lineWidth)
      ? Math.min(8, Math.max(1, p.lineWidth))
      : 3;
    const linePoints = p.linePoints !== false;
    const xFormat = formats?.[x]?.format;
    const isTimeFormat = xFormat?.includes('%') === true;
    const axis = (column: string, title: string, extra?: Record<string, unknown>) => ({
      title,
      ...(formats?.[column]?.format ? { format: formats[column].format } : {}),
      ...extra,
    });
    // A DATE x gets a real TEMPORAL scale — auto-spaced, auto-formatted ticks (bare
    // years/months), exactly like a plain bar/line — decided from the column KIND when it's
    // known at render time. Fall back to a time-format signal only when kinds aren't threaded
    // (validate/detach with no data). Everything else keeps the ordinal category axis: combo
    // compares aligned periods/categories and must support a nominal x.
    const xKind = columns?.find(c => c.name === x)?.kind;
    const xTemporal = xKind === 'temporal' || (xKind == null && isTimeFormat);
    const xEncoding = xTemporal
      ? { field: x, type: 'temporal', axis: { title: xTitle, labelOverlap: true } }
      : {
          field: x,
          type: 'ordinal',
          sort: null,
          // An ordinal date axis can't take axis.format (Vega reads a `%b %Y` pattern as a
          // NUMBER format and aborts); a labelExpr parses the category value as a date instead.
          axis: {
            title: xTitle,
            labelOverlap: true,
            ...(xFormat
              ? isTimeFormat
                ? { labelExpr: `utcFormat(toDate(datum.value), '${xFormat.replace(/'/g, '')}')` }
                : { format: xFormat }
              : {}),
          },
        };
    const xTooltip = xTemporal
      ? { field: x, type: 'temporal', title: xTitle, ...(xFormat ? { format: xFormat, formatType: 'utc' } : {}) }
      : { field: x, type: 'ordinal', title: xTitle, ...(xFormat ? { format: xFormat } : {}) };
    const tooltip = (column: string, title: string) => [
      xTooltip,
      ...(series ? [{ field: series, type: 'nominal', title: seriesTitle }] : []),
      {
        field: column,
        type: 'quantitative',
        aggregate: 'sum',
        title,
        ...(formats?.[column]?.format ? { format: formats[column].format } : {}),
      },
    ];
    const seriesColor = (title: string) => series
      ? { field: series, type: 'nominal', title: seriesTitle, legend: { title: null } }
      : { datum: title, type: 'nominal', legend: { title: null } };

    return {
      layer: [
        {
          mark: { type: 'bar', opacity: barOpacity, tooltip: true },
          encoding: {
            x: xEncoding,
            y: {
              field: bar,
              type: 'quantitative',
              aggregate: 'sum',
              axis: axis(bar, barTitle),
            },
            color: seriesColor(barTitle),
            tooltip: tooltip(bar, barTitle),
          },
        },
        {
          mark: {
            type: 'line',
            strokeWidth: lineWidth,
            strokeCap: 'round',
            strokeJoin: 'round',
            point: linePoints ? { filled: true, size: 64 } : false,
            tooltip: true,
          },
          encoding: {
            x: xEncoding,
            y: {
              field: line,
              type: 'quantitative',
              aggregate: 'sum',
              axis: axis(line, lineTitle, { orient: 'right', grid: false }),
            },
            color: seriesColor(lineTitle),
            tooltip: tooltip(line, lineTitle),
          },
        },
      ],
      resolve: { scale: { y: 'independent' } },
    };
  },
};

export const VIZ_TEMPLATES: Record<string, VizTemplate> = {
  [funnel.id]: funnel,
  [waterfall.id]: waterfall,
  [radar.id]: radar,
  [trend.id]: trend,
  [singleValue.id]: singleValue,
  [combo.id]: combo,
};

/** Registry lookup for a recipe source; null for unknown ids. */
export function getTemplate(recipeId: string): VizTemplate | null {
  return VIZ_TEMPLATES[recipeId] ?? null;
}

type MaterializeResult =
  | { ok: true; spec: Record<string, unknown>; engine: VizTemplateEngine }
  | { ok: false; error: string };

/** Materialize a recipe source into its grammar spec. */
export function materializeRecipe(source: {
  recipe: string;
  bindings: Record<string, string | string[]>;
  columnFormats?: Record<string, ColumnFormatConfig> | null;
  params?: Record<string, unknown> | null;
}, columns?: VizResultColumn[]): MaterializeResult {
  const template = getTemplate(source.recipe);
  if (!template) {
    return { ok: false, error: `unknown recipe "${source.recipe}" — available: ${Object.keys(VIZ_TEMPLATES).join(', ')}` };
  }
  const empty = (v: string | string[] | undefined) => v == null || v === '' || (Array.isArray(v) && v.length === 0);
  const missing = template.bindings.filter(b => !b.optional && empty(source.bindings[b.name]));
  if (missing.length > 0) {
    return { ok: false, error: `recipe "${source.recipe}" is missing binding${missing.length > 1 ? 's' : ''}: ${missing.map(b => b.name).join(', ')}` };
  }
  const badMulti = template.bindings.find(b => !b.multi && Array.isArray(source.bindings[b.name]));
  if (badMulti) {
    return { ok: false, error: `recipe "${source.recipe}" binding "${badMulti.name}" takes a single column, not an array` };
  }
  return {
    ok: true,
    spec: template.build(source.bindings, source.columnFormats ?? undefined, source.params, columns),
    engine: template.engine,
  };
}
