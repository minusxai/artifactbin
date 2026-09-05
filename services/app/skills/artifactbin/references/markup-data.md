---
name: markup-data
description: >-
  Queries, Values, Mutations, charts, DataTable settings and reader controls.
order: 1
---
## Read first

Declare data in `<Helmet>`; bind by name. One namespace: a TABLE (a `<Query>` or a table
`<Value>`) or a SCALAR (a `<Value>`), checked at publish — typos return `400` naming the token.

```jsx
<Helmet>
  <Value name="region" type="string" />
  <Value name="min_rev" type="number" default={1000} />
  <Query name="regions">{`select distinct region from ref_<datasetId> order by 1`}</Query>
  <Query name="sales">{`
    select region, sum(revenue) as revenue
    from ref_<datasetId>
    where ($region is null or region = $region) and revenue >= $min_rev
    group by 1 order by 2 desc
  `}</Query>
</Helmet>

<select value="$region" options="$regions" />
<Question title="Revenue by region" data="$sales" viz={{"kind":"vega-lite","spec":{"mark":"bar","encoding":{"x":{"field":"region","type":"nominal"},"y":{"field":"revenue","type":"quantitative"}}}}} height="430px" />
```

`ref:<id>` survives ONLY for images and recipes; `data="ref:<id>"`, inline
`data={[…]}` and the old Param control are retired and refused by name.

Editable cells: [editing](markup-editing.md).

## Contents

Declarations · Bindings: embeds · Bindings: controls.

## Declarations (Helmet only)

- `<Value name type default />` — a scalar the reader can change.
  `type`: `string | number | boolean | date` (default `string`); `default`
  must match it (dates `YYYY-MM-DD`); no default = `null`, which is how
  "$region is null" in SQL means "all". A scalar also travels in the LINK:
  the document accepts `?$region=EU` (empty = "all"), so you can hand your
  user a pre-filtered link — and a reader's own picks rewrite the address.
- `<Value name="tiny" type="table" value={[{…}, …]} />` — an inline table (flat
  objects; `columns={[{name,type}]}` optional). Read it in SQL by its bare
  name (`from tiny`) or bind it directly (`data="$tiny"`).
- `<Query name>{`select …`}</Query>` — SQL (DuckDB dialect) as a
  template-literal child, exactly one SELECT. A dataset artifact is the table
  `ref_<datasetId>` (one you own, or any public/unlisted one); another query
  or table Value is a table by its bare name (any order; cycles refused); a
  scalar Value is the bound parameter `$name`, never interpolated. Dry-run
  at publish against the real columns: a bad column is a
  `400 {"error":"invalid_sql"}` carrying the engine's message with candidate
  names. Results are cut at 10,000 rows; a query has 5 s. A FOLDER is a table
  too — `ref_<folderId>`, its children, which a document can list with
  `<Files data="$children" variant="icons|tiles" />`. Columns `id title format
  level visibility updated_at url thumbnail views sparkline`, computed per
  VIEWER: a stranger gets the `public` children, `thumbnail` (a card) is null
  for a private child AND for every folder, `views`/`sparkline` null unless you
  may edit the folder.
- `<Mutation name>{`insert into ref_<datasetId> (a) values ($a)`}</Mutation>`
  — a `<Query>` that WRITES (the dataset needs `access: readwrite`,
  [datasets](publishing-datasets.md)). Exactly one INSERT | UPDATE | DELETE
  naming exactly ONE dataset, which must be YOUR OWN (reading a public one
  you do not own is fine; writing it is not). It runs on demand, never at render:
  `<Button run="$name">` in the body, or `mx.mutate("name")` from your
  `<script>`; dry-run at publish, so a button that could not work is a `400`
  naming the fix. Anyone who can read the document can run it — a poll, a
  sign-up sheet — supplying VALUES only. DuckDB's `uuid()` and `now()` give a
  row its own id and timestamp.

## Bindings: embeds (body)

- `<Button run="$add">Add</Button>` — runs the named `<Mutation>`; busy while
  in flight, a refusal shown beside it.
- `<Question data="$table" viz={…} height="430px" />` — a chart over a
  declared table. The `viz` prop REQUIRES a `kind` discriminator:
  `{"kind":"vega-lite","spec":{…}}` for an inline spec (encoding fields are
  checked against the query's RESULT columns at publish),
  `{"kind":"recipe","recipe":"ref:<vizId>","bindings":{…}}` for a recipe
  artifact, `{"kind":"table"}` (the default when `viz` is absent) for a
  small themed table, and `{"kind":"single_value","yCols":["revenue"],
  "singleValueConfig":{"label":"Revenue","prefix":"$","format":",.0f"}}` for
  a bare KPI TILE (the column is SUMMED, so point it at a one-row aggregate);
  `singleValueConfig` anywhere else is refused with this shape named.
  `recipe` also takes a SHIPPED registry id — **`"minusx/trend@1"` is the
  KPI tile to prefer**: value + delta vs the previous period + sparkline, over
  a time-series query (`select <period>, <measure> … group by 1 order by 1`,
  ascending order is the contract):
  `{"kind":"recipe","recipe":"minusx/trend@1","bindings":{"date":"period",
  "value":["revenue"]},"columnFormats":{"revenue":{"format":"$,.0f",
  "alias":"Revenue"}}}` (several `value` columns = one card each; `params`:
  `compareMode: "last"|"previous"` — `previous` skips a partial current
  period; `trendColor`/`valueColor` — prefer a token like `"var(--chart-2)"`,
  which follows theme switches). All EIGHT shipped ids (slots validated at publish):
  `minusx/trend@1`, `minusx/funnel@1` (`stage`, `value`), `minusx/waterfall@1`
  (`category`, `value`), `minusx/radar@1` (`metric`, `value` multi, optional
  `series`), `minusx/combo@1` (`x`, `bar`, `line`, optional `series`),
  `minusx/single-value@1` (`value` — the FIRST row's cell; `params`: `label`,
  `caption`, `align`, `valueColor`), `minusx/choropleth@1` (`region`, `value`;
  `params.mapName`: `us-states`|`us-counties`|`world`|`india-states`),
  `minusx/point-map@1` (`lat`, `lng`, optional `size`/`color`; with
  `lat2`/`lng2` each row draws an origin→destination flow).
- `<Number data="$table" col="revenue" agg="sum" prefix="$" suffix=" M" format=",.0f" />`
  — one live aggregated figure, inline. `agg` defaults to `first` (the first
  row's cell), so a total needs `agg="sum"` written out; `avg`, `min`, `max`,
  `count` are the rest. [[ computedFigureRule ]]
- `<DataTable data="$table" columns={[…]} sort={{"col":…,"dir":"desc"}} height="420px" />`
  — THE way to show many rows: virtualised, sortable, honest about a cut
  result ("5,000 of 80,000", more on scroll). `columns` picks and orders:
  `{col, title, fmt, align, bar: true (a bar behind a number), colorScale:
  "sequential" | "diverging", width, kind: "image"}`; absent = every column.
  `kind: "image"` draws each cell's URL as a picture from our own copy of it,
  fetched on first view (declared, never sniffed). `fmt` and
  `<Number format>` are d3-format specs (`",.0f"`, `"$,.2f"`, `".1%"`); one
  that does not parse is refused at publish by name.

## Bindings: controls (body)

- **Kit controls** — the themed way to bind scalars two-way. Each takes a
  `label` and `value="$name"` (`checked="$name"` on `Switch`); a change writes
  the bound Value, typed by its declaration, and every query binding it re-runs:
  - `<Select value="$region" options="$regions" placeholder="All regions" />`
    — searchable. `options` is a table (column 1 the value, column 2 the
    label) or an inline array (`["day","week"]`, `[{"value":"EU","label":"Europe"}]`);
    a null-default scalar gets the "all" choice automatically.
  - `<Segmented value="$grain" options={["day","week","month"]} />` — prefer
    over Select when the options fit on one row.
  - `<Slider value="$min_rev" min={0} max={5000} step={100} prefix="$" format=",.0f" />`.
  - `<DatePicker value="$since" min max />` (a `date` Value), `<Switch checked="$flag" />` (a boolean).
  Dropdowns belong in a control row, never inside a `<GridItem>`.
- Native controls bind the same way, bare browser chrome: `<select value="$region"
  options="$regions" />`; `<input type="range|number|text|date" value="$x" />`
  (`checked="$flag"` for a checkbox); `<textarea value="$note" />`.
  While a re-run is in flight an embed keeps its rows, dims, and shows an
  "updating…" chip; a failed query shows the engine's message in its place.
