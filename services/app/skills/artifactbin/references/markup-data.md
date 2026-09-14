---
name: markup-data
description: >-
  Data.
order: 1
---
## Read first

Declare Queries/table Values and scalar Values in `<Helmet>`; bind by name.

```jsx
<Helmet>
  <Value name="region" type="string" />
  <Value name="min_rev" type="number" default={1000} />
  <Query name="regions" source="ref:abc123">{`select distinct region from public.rows order by 1`}</Query>
  <Query name="sales" source="ref:abc123">{`
    select region, sum(revenue) as revenue
    from public.rows
    where ($region is null or region = $region) and revenue >= $min_rev
    group by 1 order by 2 desc
  `}</Query>
</Helmet>

<select value="$region" options="$regions" />
<Question title="Revenue by region" data="$sales" viz={{"kind":"vega-lite","spec":{"mark":"bar","encoding":{"x":{"field":"region","type":"nominal"},"y":{"field":"revenue","type":"quantitative"}}}}} height="430px" />
```

Published artifacts use `ref:<id>` in source, image and recipe attributes. SQL names tables.
`data="ref:<id>"`, inline `data={[…]}` and Param are refused. [Catalogs](databases.md).

Editable cells: [editing](markup-editing.md).

## Contents

Declarations · Bindings: embeds · Bindings: controls.

## Declarations (Helmet only)

- `<Value name type default />` — a scalar the reader can change.
  `type`: `string | number | boolean | date | user` (default `string`); `default`
  must match it (dates `YYYY-MM-DD`); no default = `null`, which is how
  "$region is null" in SQL means "all". A scalar also travels in the LINK:
  the document accepts `?$region=EU` (empty = "all"), so you can hand your
  user a pre-filtered link — and a reader's own picks rewrite the address.
- `<Value name="tiny" type="table" value={[{…}, …]} />` — an inline table (flat
  objects; `columns={[{name,type}]}` optional). Read it in SQL by its bare
  name (`from tiny`) or bind it directly (`data="$tiny"`).
  Local Mutations may edit its rows; dependent local Queries re-run. `_signals`
  is the implicit one-row scalar table and accepts `UPDATE` only. [Examples and
  reload semantics](markup-state.md).
- `<Query name source="ref:abc123">{`select …`}</Query>` — SQL as a
  template-literal child, exactly one SELECT over that dataset’s exposed tables.
  Without `source`, SQL runs locally in DuckDB; another query
  or table Value is a table by its bare name (any order; cycles refused); a
  scalar Value is the bound parameter `$name`, never interpolated. Dry-run
  at publish against the real columns: a bad column is a
  `400 {"error":"invalid_sql"}` carrying the engine's message with candidate
  names. Results are cut at 10,000 rows; a query has 5 s. A FOLDER is a table
  too — use `source="ref:<folderId>"` and query `public.rows` for its children, which a document can list with
  `<Files data="$children" variant="icons|tiles" />`. Columns `id title format
  level visibility updated_at url thumbnail views sparkline`, computed per
  VIEWER: a stranger gets the `public` children, `thumbnail` (a card) is null
  for a private child AND for every folder, `views`/`sparkline` null unless you
  may edit the folder.
- `<Mutation name source="ref:abc123">{`insert into public.rows (a) values ($a)`}</Mutation>`
  — a `<Query>` that WRITES (the dataset needs `access: readwrite`,
  [datasets](databases.md)). Exactly one INSERT | UPDATE | DELETE
  naming one shared dataset. Runs on demand, never at render:
  `<Button run="$name">` in the body, or `mx.mutate("name")` from your
  `<script>`; dry-run at publish, so a button that could not work is a `400`
  naming the fix. Data policies permit viewer actions; without a policy only editors write. Callers supply VALUES only.
  Bound write controls disable automatically; filters and live reads still work. DuckDB's `uuid()` and `now()` give a
  row its own id and timestamp.

A Mutation targeting `_signals` or an inline table is local; it never changes
datasets or permissions. Dataset Mutations require
`access: readwrite`. See [composable state](markup-state.md).

First read [chart authoring](markup-data-authoring.md).

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
  — virtualised, sortable, with more rows on scroll. `columns` picks and orders:
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


[Keyed templates](markup-repeat.md).

## User fields

`user` is a nullable account ID, displayed by name in DataTable. Declare identity
columns in a stored dataset, not as free-text labels:

```jsx
<Dataset kind="stored">
  <Table schema="public" name="rows"
    columns={[
      {"name":"id","type":"number"},
      {"name":"assigned_to","type":"user","constraints":{"memberOf":["current"]}},
      {"name":"completed_by","type":"user","constraints":{"self":true}}
    ]}
    rows={[{"id":1,"assigned_to":null,"completed_by":null}]} />
</Dataset>
```

`memberOf` is always a nonempty array of unique references. Membership in ANY
listed document is sufficient; other constraints combine with AND. Eligible
members are its owner and registered users explicitly shared on it, including
registered accounts matching pending invitations. Public-link visitors are not
members. Omission permits any valid account ID but does not expose a global user
search. `self: true` permits only the logged-in user's ID when that field is
written; unrelated edits do not revalidate historical identity fields. Null
means unset. All actual non-null writes, including SQL expressions and whole
replacement imports, are checked on the server.

`"current"` binds once when the dataset is first referenced by a report owned by
its owner. The server stores that report's concrete reference. Until then the
field must remain null. Reusing the dataset in another report never rebinds it.
Use `"ref:<reportId>"` when the report already exists. Membership follows the
fixed report's current share list. The picker only lists scopes its viewer can
read.

```jsx
<Helmet>
  <Value name="person" source="ref:tsk123" column="assigned_to" />
  <Query name="tasks" source="ref:tsk123">{`select * from public.rows`}</Query>
  <Mutation name="assign" source="ref:tsk123" expectedAffected={1}>{`
    update public.rows set assigned_to=$_value where id=$_row.id
  `}</Mutation>
  <Mutation name="complete" source="ref:tsk123" expectedAffected={1}>{`
    update public.rows set completed_by=$_me where id=$_row.id
  `}</Mutation>
</Helmet>
<Select label="Person filter" value="$person" />
<DataTable data="$tasks" rowKey="id">
  <Column col="id" />
  <Column col="assigned_to"><Select label="Assign task" value="$_row.assigned_to" run="$assign" /></Column>
  <Column col="completed_by" />
  <Column col="action"><Button run="$complete">Complete</Button></Column>
</DataTable>
```

The standalone Value inherits its user type and constraints from `public.rows`'s
named column. Names such as `person` and `assign` are author-chosen. User Selects
get searchable choices from field metadata; no `options` query is needed.
Direct SQL projections, aliases, filters and ordering preserve user metadata;
computed text such as `upper(assigned_to)` is ordinary text. `$_me` is reserved
and bound by the server to the actual caller, never a client-supplied Value or
the report owner. Mutations using it require login. In queries it is null for
anonymous readers. PostgreSQL catalogs remain read-only.
