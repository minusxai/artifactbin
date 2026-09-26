---
name: markup-data-authoring
description: Chart authoring.
---
## Read first

<!--bundle:skip-->
## Theme, legends and labels

Leave color ranges and schemes unset: categorical and continuous scales use
the theme. Do not add literal colors or named palettes unless the user explicitly
requests custom colors. For thematic emphasis, use `"var(--chart-2)"` (or another
`--chart-1` through `--chart-5` token); these also work in inline spec scale ranges
and follow theme changes. Explicit colors and schemes override theme defaults.

Give every data axis a readable `title`, including known units, and retain tick
labels. Use `format` for currency, percentages and dates; do not guess units.
Do not set `axis: null`, `labels: false` or `title: null` on ordinary data axes.
Axis-free sparklines and directly labeled diagrams are exceptions.

Encode series/categories as a field on `color`, `shape` or `strokeDash` so the
renderer can build a legend. Keep legends for multiple series and continuous
color/size measures; name the measure and units in `title`. Use `legend: null`
only when direct labels convey the same meaning or the legend is redundant.
For layered charts, explicitly encode each series rather than coloring each
layer with a literal. Recipe `columnFormats` aliases provide readable names.
<!--/bundle:skip-->

<!--bundle:skip-->
## Inline theme-token example

An explicit range can emphasize categories while following theme switches:

```jsx
<Helmet>
  <Value name="totals" type="table" value={[{"region":"EU","revenue":100},{"region":"NA","revenue":200}]} />
</Helmet>
<Question data="$totals" height="280px" viz={{"kind":"vega-lite","spec":{"mark":"bar","encoding":{"x":{"field":"region","type":"nominal","title":"Region"},"y":{"field":"revenue","type":"quantitative","title":"Revenue"},"color":{"field":"region","type":"nominal","scale":{"range":["var(--chart-1)","var(--chart-2)"]}}}}}} />
```

The renderer resolves CSS token strings inside the spec, including scale ranges;
omit the range for the default theme palette. Use a stored dataset for shared data;
the inline table here only makes the example self-contained.
<!--/bundle:skip-->

<!--bundle:skip-->
## Recipe slots

Slots are validated at publish: funnel `stage`, `value`; waterfall `category`,
`value`; radar `metric`, `value`, optional `series`; combo `x`, `bar`, `line`,
optional `series`; single-value `value` (the FIRST row's cell) with `params`
`label`, `caption`, `align`, `valueColor`. Trend `params`: `compareMode:
"last"|"previous"` — `previous` skips a partial current period — and
`trendColor`/`valueColor`, best as a token like `"var(--chart-2)"`.
<!--/bundle:skip-->

## Build chart attributes without counting braces

Construct the viz object as JSON, then serialize it inside ONE JSX expression.
<!--bundle:skip-->
For example, in task-local Python (no SDK):

```python
import json
viz = {"kind": "vega-lite", "spec": {"mark": "bar", "encoding": {
    "x": {"field": "region", "type": "nominal"},
    "y": {"field": "revenue", "type": "quantitative"}}}}
chart = '<Question data="$sales" viz={' + json.dumps(viz) + '} />'
```

<!--/bundle:skip-->
Use the generated element in the document. JavaScript's `JSON.stringify` works
the same way. After a brace error, regenerate the attribute from the object;
do not repeatedly patch a guessed run of closing braces.<!--bundle:skip--> A failed publish did
not change stored markup. Read it again before an exact-text edit.<!--/bundle:skip-->

## Preserve what the statistic means

Check the input row's grain before aggregating. Averages or medians of group
medians are not the average or median of the underlying observations. Preserve
the supplied groups, or explicitly label the derived statistic (for example,
"average of monthly medians").<!--bundle:skip--> If a function is unavailable, changing the
function also requires rechecking the interpretation and labels.<!--/bundle:skip--> Never silently
substitute `avg` for `median`.
