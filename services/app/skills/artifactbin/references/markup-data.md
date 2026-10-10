---
name: markup-data
description: >-
  Data: SQL for the data in Helmet, JSX for the view, bound by $name.
order: 1
---
## Read first

`<Helmet>` holds datasets/state/reads/writes via `<Import>`/`<Value>`/`<Query>`/`<Mutation>`. Views bind `data="$query"`, `value="$value"`, `run="$mutation"`; no SQL.

```jsx
<Helmet>
  <Import name="sales" src="ref:abc123" />
  <Value name="region" type="string" />
  <Query name="regions">{`select distinct region from sales.rows order by 1`}</Query>
  <Query name="by_region">{`
    select region, sum(revenue) as revenue
    from sales.rows
    where $region is null or region = $region
    group by 1 order by 2 desc
  `}</Query>
</Helmet>

<Select label="Region" value="$region" options="$regions" placeholder="All regions" />
<Question title="Revenue by region" data="$by_region" viz={{"kind":"vega-lite","spec":{"mark":"bar","encoding":{"x":{"field":"region","type":"nominal"},"y":{"field":"revenue","type":"quantitative"}}}}} height="430px" />
```

[Write forms](markup-data-example.md). [Attachments](markup-upload.md).
SQLite rules and every function: [SQL](markup-sql.md). Editable cells: [editing](markup-editing.md).

## Declarations (Helmet only)

- `<Import name="sales" src="ref:<id>" />` — a stored dataset or folder. SQL reads
  it as `sales.rows` (a multi-table dataset: `sales.<table>`). IDs: `afbin add --json` / `afbin push`. Folder children use `<Import name="kids" src="ref:<folderId>" />` and SQL over `kids.rows`, which a document can list with `<Files data="$children" variant="icons|tiles" />` after declaring a children query. Columns `id title format level visibility updated_at url thumbnail views sparkline`; per VIEWER, strangers see only public children.
- `<Value name type default />` — a page value the reader changes. `type`:
  `string | number | boolean | date | user`; no default = `null`, so
  `$region is null` means "all".<!--bundle:skip--> `?$region=EU` seeds a pre-filtered link; picks rewrite the link. `url={false}` excludes it both ways.<!--/bundle:skip-->
- `<Value name="tiny" type="table" value={[{…}]} />` — inline rows; SQL reads
  `tiny`, the view binds `$tiny`. Local mutations may change them until reload.
  [Local state](markup-state.md).
- `<Query name>{`select …`}</Query>` — a function `(params) → rows`: one SELECT.
  `$name` is a page value, bound, never spliced. A query reads imports, table
  values and other queries by name, in any order (cycles are refused). Publish checks real columns; errors name the correction.<!--bundle:skip--> A result shows its first [[ displayRows ]] rows and pages the rest;
  a query stops at 10,000 rows and 5 s.<!--/bundle:skip--> Dates are ISO text; the
  library adds `date_add`, `date_part`, `date_format`, `date_series`,
  `to_timezone`, `dayname` and more ([SQL](markup-sql.md)).
- `<Query name source="ref:<id>">` — ONLY for a connected Postgres dataset:
  Postgres SQL, run inside that database. [Catalogs](databases.md).
- `<Mutation name expectedAffected={1} reset="note">{`insert into sales.rows …`}</Mutation>`
  — `(args) → result`: one INSERT/UPDATE/DELETE on one import or table value, run by a control. `$name` reads page state unless control `args=` overrides it; built-ins come from context. `expectedAffected` refuses a write that changed another
  number of rows; `reset` returns those values to their defaults after it commits.

After-write notifications: [notification queries](markup-notifications.md).

Built-ins are never declared and never written: `$_me.id`, `$_now` and `$_tz`
come from the platform; `$_row.<column>` and `$_value` from the control that
runs a mutation.
<!--bundle:skip-->

[[ builtinTable ]]
<!--/bundle:skip-->

Markup reads `$_me.id` too, and `$_row.<column>` inside a `<For>` or `<Column>`.
A guest's `$_me.id` is null, so a mutation that binds it needs a signed-in
reader. The current time is `$_now`, never `'now'`. A new row's id: `uuid()`.
<!--bundle:skip-->
Queries run in the browser if its data may be held there, otherwise server-side; both use identical SQLite/functions/`$_now`.
<!--/bundle:skip-->

First read [chart authoring](markup-data-authoring.md).

## Bindings: embeds (body)

- `<Question data="$q" viz={…} height="430px" />` — a chart. `viz` needs `kind`:
  `{"kind":"vega-lite","spec":{…}}` (encoding fields checked against the result
  at publish), `{"kind":"table"}` (the default), `{"kind":"single_value",
  "yCols":["revenue"],"singleValueConfig":{"label":"Revenue","prefix":"$","format":",.0f"}}`
  (a KPI of a one-row aggregate), or `{"kind":"recipe","recipe":"minusx/trend@1",
  "bindings":{"date":"period","value":["revenue"]}}` — **the KPI tile to
  prefer**: value, delta and sparkline over `select <period>, <measure> … group by 1 order by 1`.
  Shipped recipes: `minusx/trend@1`, `minusx/funnel@1`, `minusx/waterfall@1`,
  `minusx/radar@1`, `minusx/combo@1`, `minusx/single-value@1`, and the deprecated
  `minusx/choropleth@1` and `minusx/point-map@1` ([maps](markup-maps.md)); slots
  in [chart authoring](markup-data-authoring.md).
- `<Number data="$q" col="revenue" agg="sum" prefix="$" suffix=" M" format=",.0f" />`
  — one live figure inline. `agg` defaults to `first` (the first row's cell);
  a total is `sum`, and `last`, `avg`, `median`, `min`, `max`, `count` exist. [[ computedFigureRule ]]
- `<DataTable data="$q" rowKey="id" columns={[…]} height="420px" />` — sortable,
  virtualised; `columns` picks `{col, title, fmt, align, bar, colorScale, width, kind: "image"}`,
  or `<Column col title>` children hold a control per row ([editing](markup-editing.md)).
  `fmt` and `format` are d3-format specs (`",.0f"`, `".1%"`).<!--bundle:skip-->
  `kind: "image"` draws each cell's URL as a picture from our own copy, fetched
  on first view.<!--/bundle:skip-->
- `<For each={$q} keyBy="id">…{$_row.name}…</For>` — a template per row. [Keyed repeats](markup-repeat.md).
- `{($_row.is_open) && (<Button …/>)}` shows markup only while a value or row
  field is true. [Conditions](markup-state.md).
- `<User userId="$_me.id" />`, `<User userId="$_row.booked_by" />` — a person by account id.

## Bindings: controls (body)

- A kit control binds a page value two-way: `label` plus `value="$name"`
  (`checked="$name"` on `Switch`). A change writes the value and every query
  that reads it re-runs.
  `<Select value="$region" options="$regions" />` (a query's first column is the
  value, its second the label, or an inline `["day","week"]`), `<Segmented>`,
  `<Slider min max format>`, `<DatePicker>`, `<Switch>`, `<Input type>`,
  `<Textarea rows>`. [Multi-select](markup-select.md).
- `<Button set={{"day": "$_row.day"}}>` sets page values on click, instantly,
  with no SQL: from another value (`"$other"`), a row field or a literal.
- `<Button run="$book">` runs a mutation: busy while it runs, a refusal shown
  beside it. `args={{"note": "$draft"}}` fills an argument from another value.
  Inside a `<For>` or a DataTable `<Column>` the row is `$_row`.

[User fields](databases-users.md) · [shared apps](apps.md).
