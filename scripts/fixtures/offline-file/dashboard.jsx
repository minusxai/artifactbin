<Helmet>
  <title>Regional sales</title>
  <Import name="sales_data" src="ref:Ds1a2b" />
  <Import name="targets_data" src="ref:Tg9z8y" />
  <Value name="region" type="string" />
  <Value name="note" type="string" />
  <Query name="regions">{`select distinct region from sales_data.rows order by 1`}</Query>
  <Query name="sales">{`select region, month, revenue from sales_data.rows where $region is null or region = $region order by 1, 2`}</Query>
  <Query name="matches">{`select count(*) as n from targets_data.rows where $note is null or region like $note`}</Query>
  <Mutation name="add">{`insert into sales_data.rows (region, month, revenue) values ('north', '2026-09', 1)`}</Mutation>
</Helmet>
<div className="@container p-8 space-y-6">
  <h1 className="text-3xl font-bold tracking-tight">Regional sales</h1>
  <p className="text-muted-foreground">Revenue by region and month, as the offline file gate expects it.</p>
  <div className="flex flex-wrap gap-4">
    <Select label="Region" value="$region" options="$regions" placeholder="All regions" />
    <Input label="Region pattern" value="$note" placeholder="e.g. we%" />
  </div>
  <DataTable data="$sales" columns={[{"col":"region","title":"Region"},{"col":"month","title":"Month"},{"col":"revenue","title":"Revenue","fmt":"$,.0f"}]} />
  <Question title="Revenue by month" data="$sales" viz={{"kind":"vega-lite","spec":{"mark":"bar","encoding":{"x":{"field":"month","type":"nominal"},"y":{"field":"revenue","type":"quantitative","aggregate":"sum"}}}}} height="300px" />
  <p>Matching rows: <Number data="$matches" col="n" /></p>
  <Button run="$add">Add a row</Button>
</div>
