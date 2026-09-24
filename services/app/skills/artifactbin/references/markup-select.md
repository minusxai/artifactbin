---
name: markup-select
description: Standalone multi-select filters and JSON-array values.
---
## Standalone multi-select

`multiple valueFormat="json"` works on a standalone Select as well as a cell
editor. Bind a **string** Value containing a JSON array of strings; `"[]"`
means no selections. Here an empty selection means all rows:

```jsx
<Helmet>
  <Value name="regions" type="string" default="[]" />
  <Value name="sales" type="table" value={[{"region":"EU","revenue":100},{"region":"NA","revenue":200}]} />
  <Query name="region_options">{`select distinct region from sales order by region`}</Query>
  <Query name="filtered">{`
    select * from sales
    where $regions is null or $regions = '[]'
       or list_contains(cast($regions as varchar[]), region)
  `}</Query>
</Helmet>
<Select label="Regions" multiple valueFormat="json" value="$regions" options="$region_options" />
<DataTable data="$filtered" />
```

Done or dismissal commits the selection and re-runs dependent queries; Escape
cancels the draft. `allowCreate` permits new strings. Use JSON, not comma splitting:
commas inside a choice are data. The Value travels in the link by default;
use `url={false}` for a temporary form field. For a shared app, read its rows and
option list from a stored dataset instead of the tiny inline demonstration table.
