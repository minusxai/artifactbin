---
name: dataviz
description: Chart choice, truthful encodings and Vega-Lite or Vega authoring for native HTML pages.
---
## Read first

Use **Vega-Lite** for analytical charts; **Vega** for custom layouts/signals. They are separate libraries: Vega-Lite compiles to Vega. Use documented runtime imports; assume no globals, embed helper or automatic theme. Grammar examples follow.

Name question, unit, grain, source, period, timezone and missing/partial data. Read [runtime](html-runtime.md) and [datasets](html-datasets.md).

## Contents

[Choice](#choose-a-chart) · [Encodings](#encodings-and-theme) · [Layout](#layout-and-interaction) · [Data](#data-and-lifetime) · [Examples](#examples)

## Choose a chart

Use bars for categories, lines for time, histograms/boxplots for distribution, scatterplots for relationships and heatmaps for categorical pairs. Stacked bars show composition; donuts need few nonnegative parts. Tables show exact values. Prefer small multiples to crowded series.

## Encodings and theme

Declare nominal categories, ordinal order, quantitative magnitudes and temporal timestamps. Keep order/color stable across filters. Bars/areas start at zero; disclose narrowed line/scatter domains. Log scales require positive data. Match panel scales.

Missing is not zero. Null observations can create line gaps; absent rows cannot. Vega-Lite filtering connects valid points; choose break-path modes deliberately. Vega line marks support `defined`. Distinguish empty, loading and error states.

Aggregate once at the stated grain. Ratios need the right denominator/weighting. Unaggregated Vega-Lite tooltip fields can change grouping. Preserve calculation precision; format labels with units. `.1%` expects a fraction. The old compact default `.3~s` is useful for large numbers; offer exact values too.

Choose explicit timestamp offsets and reporting timezone before grouping days. Vega-Lite time units default to local time; UTC units use the `utc` prefix. UTC scales govern positioning, not arbitrary timezone conversion. Precompute reporting-zone buckets when needed; preserve date-only calendar semantics.

Preserve existing Chart choices: shared theme, transparent surface, restrained grids, readable labels, small line points and explicit formats. Categorical colors convey identity; lightness ramps convey magnitude; diverging scales need a meaningful center.

Old renderer token resolution, legend wrapping/selection and styled tooltips are **not automatic** in standalone libraries. Resolve font/colors from the chart's design-system scope; pass concrete sRGB colors, since CSS-variable/OKLCH strings can fail in expressions. Recompute configuration on documented theme changes. Keep category identity stable and check text, grids, ramps and explicit colors in both modes.

## Layout and interaction

Size the host. Single/layered Vega-Lite supports `width: "container"`. For Vega observe size, update dimensions, `resize()` and `runAsync()`. Test narrow hosts, hidden panels and long labels.

Provide title, units, `description` and an accessible table. Supplement color with labels/shapes. Necessary actions/information must work with keyboard/touch and without hover.

Tooltip fields need human titles/formats, not internal columns. Styled tooltips require a handler/plugin: escape text, keep overlays in the chart document/viewport, dismiss on outside action, Escape and teardown. Explain selection/reset; keep events view-scoped. Legend highlighting must not silently change totals. Query filters need loading/errors and stale-response protection.

## Data and lifetime

Read shared facts with `client.query` under linked `data-af-name`. Discover dataset IDs; collect all pages at one revision or use supported server aggregates. Disclose source truncation. Keep rows transient; persist only viewer filters/selections through `client` local state. `onBackendChange` means re-query; `watchQuery` observes local state. Selection is local. Keep credentials out of specs/files.

Retain one view per chart. Update named data then run the dataflow; discard superseded renders. On replacement call `view.finalize()`, disconnect observers, unsubscribe client listeners and remove tooltip/listeners. Rebuild for compile-time theme/layout changes while preserving intended viewer choices.

Offline needs local libraries/assets and permitted data. Download does not automatically snapshot GraphQL or pack arbitrary dependencies. Show unavailable states honestly; test the downloaded file without a network.

## Examples

Vega-Lite:

```json
{"$schema":"https://vega.github.io/schema/vega-lite/v6.json","description":"Illustrative completed tasks by category.","width":"container","height":180,"data":{"values":[{"category":"A","count":18},{"category":"B","count":12}]},"mark":"bar","encoding":{"y":{"field":"category","type":"nominal","sort":"-x","title":"Category"},"x":{"field":"count","type":"quantitative","scale":{"zero":true},"title":"Completed tasks"},"tooltip":[{"field":"category","type":"nominal","title":"Category"},{"field":"count","type":"quantitative","title":"Completed tasks","format":",.0f"}]}}
```

Vega: update via `view.data("rows", rows).runAsync()`.

```json
{"width":280,"height":160,"data":[{"name":"rows","values":[{"category":"A","count":18},{"category":"B","count":12}]}],"scales":[{"name":"x","type":"band","domain":{"data":"rows","field":"category"},"range":"width","padding":0.2},{"name":"y","type":"linear","domain":{"data":"rows","field":"count"},"range":"height","zero":true,"nice":true}],"axes":[{"orient":"bottom","scale":"x"},{"orient":"left","scale":"y"}],"marks":[{"type":"rect","from":{"data":"rows"},"encode":{"update":{"x":{"scale":"x","field":"category"},"width":{"scale":"x","band":1},"y":{"scale":"y","field":"count"},"y2":{"scale":"y","value":0},"fill":{"value":"#2980b9"}}}}]}
```

## Official references

[Vega-Lite docs](https://github.com/vega/vega-lite/tree/main/site); [Vega docs](https://github.com/vega/vega/tree/main).
