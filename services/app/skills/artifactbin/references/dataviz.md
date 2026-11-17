---
name: dataviz
description: "Read before drawing any chart: chart choice, truthful encodings and af-chart (Vega-Lite or Vega) in a native HTML page."
---
## Read first

Draw every analytical chart with **`<af-chart>`** (`import '@afbin/chart'`; contract: `head -40 components/chart.ts`): it runs the chart's SQL, draws Vega-Lite or Vega, sizes to its width, takes the page's design tokens in light and dark, wraps legends, shows loading, empty and error states, lists the drawn values and tears down. Raw Vega stays for custom work. Maps and regions: deck.gl ([maps](maps.md)); diagrams: Pele ([diagrams](diagrams.md)).

Name question, unit, grain, source, period, timezone and missing data. See [runtime](runtime.md) and [datasets](datasets.md).

## af-chart

```html
<af-chart label="Completed tasks by category"
  sql="select category, count(*) as n from tasks where done group by category order by n desc">
<script type="application/json">{"mark":"bar","encoding":{
  "x":{"field":"category","type":"nominal","sort":null,"title":"Category"},
  "y":{"field":"n","type":"quantitative","title":"Completed tasks"},
  "tooltip":[{"field":"category","title":"Category"},
    {"field":"n","type":"quantitative","title":"Completed tasks","format":","}]}}</script>
</af-chart>
<script type="module">import '@afbin/chart';</script>
```

Rows bind as the dataset `main`: write no `data` (a spec's own `values` draw instead). Data is one of `sql`, `dataset="NAME"` (a link's `data-af-name`), `rows` (objects) or `query`, a statement from `` sql`…` `` with bound values: set it again to filter (`chart.query = sql`… where city = ${city}``). A recipe names columns: `{"recipe":"trend","bindings":{"date":"week","value":"n"}}` (also funnel, waterfall, radar, single-value, combo). `url` data is refused; `data-af-chart="ready"` marks a drawn chart. `node scripts/sql.mjs query ID 'SQL' --chart chart.json --chart-output chart.png` draws the same description as an image before you publish (`--chart-width N --chart-height N --chart-theme light|dark`).

Custom work keeps the element: `chart.view` (and the `af-chart-ready` event's `{view, rows}`) is the live Vega View for signals and listeners; `draw` replaces the renderer while af-chart keeps data, states, size and teardown. Or import `@afbin/vega` (`parse(spec, config, {ast:true})`, `new View(runtime, {expr: expressionInterpreter, container})`; themed tooltip built in) and `@afbin/vega-lite` (`compile`), which suit the no-eval CSP. Never bare `vega` or globals.

## Contents

[Choice](#choose-a-chart) · [Encodings](#encodings-and-theme) · [Layout](#layout-and-interaction) · [Data](#data-and-lifetime) · [Examples](#examples)

## Choose a chart

Use bars for categories, lines for time, histograms/boxplots for distribution, scatterplots for relationships and heatmaps for categorical pairs. Stacked bars show composition; donuts need few nonnegative parts. Tables show exact values. Prefer small multiples to crowded series. Draw one chart per question asked, not every kind: `examples/csv-dashboard.html` has each, with a map and charts that filter each other.

## Encodings and theme

Declare nominal categories, ordinal order, quantitative magnitudes and temporal timestamps. Keep order/color stable across filters. Bars/areas start at zero; disclose narrowed line/scatter domains. Log scales require positive data. Match panel scales.

Missing is not zero. Null observations can create line gaps; absent rows cannot. Vega-Lite filtering connects valid points; choose break-path modes deliberately. Vega line marks support `defined`. Distinguish empty, loading and error states.

Aggregate once at the stated grain, in SQL for a dataset (`sql` GROUP BY, [datasets](datasets.md#read)). Ratios need the right denominator/weighting. Unaggregated Vega-Lite tooltip fields can change grouping. Preserve calculation precision; format labels with units. `.1%` expects a fraction. `.3~s` compacts large numbers; offer exact values too.

Choose timestamp offsets and reporting timezone before grouping. Vega-Lite time units default to local time; UTC units use the `utc` prefix. UTC scales govern positioning, not arbitrary timezone conversion. Precompute reporting-zone buckets; keep date-only semantics.

Set chart styling explicitly through Vega-Lite `config`; native Vega uses parser config/mark encodings. Categorical colors convey identity; lightness ramps convey magnitude; diverging scales need a meaningful center.

af-chart resolves the tokens to concrete sRGB and rebuilds when they change; a spec's own `config` wins. A raw view must do this itself: resolve font/colors from the design-system scope (CSS-variable/OKLCH strings can fail in expressions), observe `data-af-dark`, `data-af-design-system` and class/style changes, rebuild, and disconnect on teardown. Check text, grids, ramps and explicit colors in both modes.

## Layout and interaction

af-chart fills its width (`height`, default 320). A raw view sizes its host: single/layered Vega-Lite supports `width: "container"`; for Vega observe size, update dimensions, `resize()` and `runAsync()`. Test narrow hosts, hidden panels and long labels.

Provide title, units, `description` (af-chart's label) and an accessible table. Supplement color with labels/shapes. Actions must work by keyboard/touch, without hover.

Tooltips list fields by `title`: name each for readers, never raw columns (`{"field":"pts","type":"quantitative","title":"Points","format":","}`); a `title` field is the heading. `format` errors on nominal fields. Add no other tooltip handler. Explain selection/reset; keep events view-scoped. Honor `prefers-reduced-motion`: avoid animated transitions/auto-play, keep static updates usable, and remove media listeners on teardown. Legend highlighting must not silently change totals.

## Data and lifetime

Import CSV through the dataset flow. CSV fields may be strings: preserve identifiers, parse declared numeric/date fields, reject non-finite values (blanks are not zero). Read rows as [datasets](datasets.md#read) says, from the table named by the link's `data-af-name`. Disclose source truncation. Keep rows transient; persist only viewer filters/selections through `@afbin/state`. `sql.watch` reruns on change; `onResolverChange` supports managed re-querying. Keep credentials out of specs/files.

A raw view: retain one per chart, update named data then run the dataflow, discard superseded renders; on replacement `view.finalize()`, disconnect observers and stop listeners. Rebuild for compile-time theme/layout changes while preserving viewer choices.

A download carries the rows its reader's `sql` may read (none past 16 MiB, and the copy says so) and the hosted libraries, so charts draw offline; declared queries and writes need the app. Show unavailable states honestly; test downloads offline.

## Examples

Vega-Lite with its own values:

```json
{"description":"Completed tasks by category.","data":{"values":[{"category":"A","count":18},{"category":"B","count":12}]},"mark":"bar","encoding":{"y":{"field":"category","type":"nominal","sort":"-x","title":"Category"},"x":{"field":"count","type":"quantitative","title":"Completed tasks"}}}
```

Vega, raw or as an af-chart `chart` (`data-name="rows"` fills `rows` with its rows; a raw view updates with `view.data("rows", rows).runAsync()`):

```json
{"width":280,"height":160,"data":[{"name":"rows","values":[{"category":"A","count":18},{"category":"B","count":12}]}],"scales":[{"name":"x","type":"band","domain":{"data":"rows","field":"category"},"range":"width","padding":0.2},{"name":"y","type":"linear","domain":{"data":"rows","field":"count"},"range":"height","zero":true,"nice":true}],"axes":[{"orient":"bottom","scale":"x"},{"orient":"left","scale":"y"}],"marks":[{"type":"rect","from":{"data":"rows"},"encode":{"update":{"x":{"scale":"x","field":"category"},"width":{"scale":"x","band":1},"y":{"scale":"y","field":"count"},"y2":{"scale":"y","value":0},"fill":{"value":"#2980b9"}}}}]}
```

## Official references

[Vega-Lite docs](https://github.com/vega/vega-lite/tree/main/site); [Vega docs](https://github.com/vega/vega).
