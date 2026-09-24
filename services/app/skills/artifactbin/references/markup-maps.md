---
name: markup-maps
description: >-
  Maps with <DeckGL>: points, regions, arcs, hexagon bins, heatmaps, H3 and 3D,
  over a street basemap or bundled boundaries, or your own GeoJSON.
order: 3
---
## Read first

Every map is one `<DeckGL>`: deck.gl layers in deck.gl's own JSON dialect
(`"@@type"`, `"@@="` accessors), drawn from one bound query. Write layers the
way you would for deck.gl or pydeck. The Vega recipes `minusx/choropleth@1`
and `minusx/point-map@1` still render but are deprecated: use `<DeckGL>`.

```jsx
<DeckGL data="$stores" height="420px" basemap="auto" tooltip={["city","orders"]}
  layers={[{"@@type":"ScatterplotLayer","getPosition":"@@=[lng, lat]",
    "getRadius":"@@=sqrt(orders)","radiusScale":800,"getFillColor":"@@=category(region)"}]} />
```

- `data="$query"` binds the rows every layer reads. `height` sets the box.
- `basemap`: `auto` (street map following the theme; the default), `light`,
  `dark` or `none`. Region maps (a choropleth over boundaries) usually read best
  with `none`; points, arcs and density want streets and places under them.
- The view fits the data. Set `initialViewState={{"longitude":77.6,
  "latitude":12.97,"zoom":10,"pitch":45,"bearing":0}}` only to frame it
  deliberately; `pitch` tilts the camera for 3D layers.
- `tooltip`: `true` (the default; the row's columns), a list of columns, or
  `false`. Readers get zoom and reset buttons; scrolling and dragging move it.

## Layers

| `@@type` | Reads | Key props |
|---|---|---|
| `ScatterplotLayer` | points | `getPosition`, `getRadius`, `radiusScale`, `radiusMinPixels`, `getFillColor` |
| `ArcLayer` | origin→destination | `getSourcePosition`, `getTargetPosition`, `getSourceColor`, `getTargetColor`, `getWidth` |
| `GeoJsonLayer` | regions/shapes | `data:"boundary:<id>"` + `@@join`, or your GeoJSON rows; `getFillColor`, `getLineColor`, `extruded`, `getElevation` |
| `ColumnLayer` | 3D bars at points | `getPosition`, `getElevation`, `elevationScale`, `radius` |
| `HexagonLayer` | hexagon bins of points | `getPosition`, `radius` (metres), `extruded`, `elevationScale`, `getColorWeight` |
| `GridLayer` | square bins of points | `getPosition`, `cellSize` (metres), `extruded` |
| `HeatmapLayer` | density | `getPosition`, `getWeight`, `radiusPixels` |
| `H3HexagonLayer` | H3 cells | `getHexagon` (an H3 index column), `getFillColor`, `extruded`, `getElevation` |

Layers stack in order: a boundary first, points over it. Each layer takes only
its documented deck.gl props; anything else (`image`, `loadOptions`, a URL) is
refused at publish, as is a column the query does not return.

## Accessors

A `get…` prop takes a literal (`[255,140,0]`, `3`) or an `"@@="` expression
over one row: column names, numbers, `'strings'`, `[a, b]`, `+ - * / %`,
comparisons, `&&`, `||`, `!` and `cond ? a : b`, with `sqrt`, `log`, `log10`,
`abs`, `min`, `max`, `round`, `floor` and `ceil`. `@@function` and JavaScript
are refused. Two functions pick THEME colours — prefer them to raw RGB:

- `"@@=ramp(value)"` spreads a number's range over a sequential scale;
- `"@@=category(region)"` gives each distinct value its own chart colour.

Both are for `get…Color` props only. Aggregating layers colour their own
bins; leave their colours alone.

## Regions: bundled boundaries

A `GeoJsonLayer` with `"data":"boundary:<id>"` draws a bundled boundary set;
`"@@join":["<feature property>","<query column>"]` copies each query row onto
the feature it names, so accessors read your columns:

```jsx
<DeckGL data="$by_state" basemap="none" tooltip={["state","revenue"]}
  layers={[{"@@type":"GeoJsonLayer","data":"boundary:india-states",
    "@@join":["name","state"],"getFillColor":"@@=ramp(revenue)",
    "getLineColor":[255,255,255],"lineWidthMinPixels":1}]} />
```

Bundled: `world` (countries), `us-states`, `us-counties`, `india-states`. All
key on `name`: make the query's region values match those names exactly.

## Your own GeoJSON

Any other geography — sales territories, districts, delivery zones — is your
own GeoJSON, published as a dataset: `afbin add zones.geojson --json`. Each
feature becomes a row: its properties as columns plus a `geometry` column.
Query it like any rows (filter, join metrics in SQL), then draw it with a
`GeoJsonLayer` WITHOUT `data`:

```jsx
<Query name="zones" source="ref:<geojsonId>">{`select zone, orders, geometry from public.rows`}</Query>
…
<DeckGL data="$zones" tooltip={["zone","orders"]}
  layers={[{"@@type":"GeoJsonLayer","getFillColor":"@@=ramp(orders)"}]} />
```

Keep `geometry` in the select. The file must be named `.geojson` (TopoJSON:
convert it first). Coordinates are longitude, latitude (WGS84).

## Points, flows and density

```jsx
<DeckGL data="$trips" initialViewState={{"longitude":78,"latitude":21,"zoom":4,"pitch":40}}
  layers={[
    {"@@type":"HexagonLayer","getPosition":"@@=[pickup_lng, pickup_lat]","radius":20000,"extruded":true,"elevationScale":50},
    {"@@type":"ArcLayer","getSourcePosition":"@@=[pickup_lng, pickup_lat]","getTargetPosition":"@@=[drop_lng, drop_lat]","getWidth":1}
  ]} />
```

Aggregate in SQL when the rows are many: a map over 100k raw points is a
heavy page; bin with `HexagonLayer`/`GridLayer`, or pre-aggregate to cells.
