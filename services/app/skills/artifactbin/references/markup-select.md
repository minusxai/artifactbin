---
name: markup-select
description: Standalone multi-select filters and JSON-array values.
---
## Read first

A standalone `<Select multiple valueFormat="json">` binds a **string** Value
holding a JSON array of strings; `"[]"` means no selection.

## Standalone multi-select

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

Done or dismissal commits and re-runs dependent queries; Escape cancels.
`allowCreate` permits new strings. Use `url={false}` for a temporary field.
