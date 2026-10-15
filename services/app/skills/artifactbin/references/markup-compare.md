---
name: markup-compare
description: >-
  Comparison tables: a few items side by side across measures with <DataTable transpose>, the best value per measure bold.
---
## Read first

`<DataTable transpose>` compares a few items: each row of its query becomes a
column (at most 6, headed by `header`), each metric a row. It is a DataTable to
look at, but not sortable or editable: no `columns`, `sort`, `rowKey` or `<Column>`.

```jsx
<Helmet>
  <Import name="langs" src="ref:cmp123" />
  <Query name="picks">{`select * from langs.rows where name in ('Go', 'Rust', 'Ruby')`}</Query>
</Helmet>

<DataTable data="$picks" transpose header="name" edge metrics={[
  {"col":"cost","title":"Cost per run","fmt":"$,.2f","better":"low"},
  {"col":"score","title":"Score","fmt":".1f","better":"high"}]} />
```

## Metrics

Each metric is `{"col", "title", "fmt", "better", "rank", "sub"}`; only `col`
is required, and without `metrics` every column but `header` is one.

- `fmt` — a d3-format spec, as in DataTable `columns`.
- `better` — `"high"` or `"low"`: the best value is bold when at least two
  items have one; ties bold every tied item.
- `rank` — a column drawn as a small `#n` after the value.
- `sub` — a column drawn as a small line under the value (a range, a note).

`edge` adds a last column naming the leader and its margin over the runner-up:
"Rust by 25% vs Go" (the runner-up is named when more than two items compete),
"tied: Go, Rust" on a tie. Missing values draw "–" and never win.

Order the items in the query. A query returning more than 6 rows shows the
first 6 and says how many were left out: filter it to the items to compare.
