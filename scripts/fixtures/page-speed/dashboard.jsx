<Helmet>
  <title>Perf C dashboard</title>
  <Import name="sales" src="ref:{{sales}}" />
  <Value name="region" type="string" />
  <Query name="regions">{`select distinct region from sales.rows order by 1`}</Query>
  <Query name="monthly">{`
    select month, sum(revenue) as revenue, sum(units) as units from sales.rows
    where $region is null or region = $region group by 1 order by 1
  `}</Query>
  <Query name="by_product">{`
    select product, sum(revenue) as revenue from sales.rows
    where $region is null or region = $region group by 1 order by 2 desc
  `}</Query>
</Helmet>
<div data-design="tw" className="@container px-4 py-8 @2xl:px-8" id="X34b">
  <h1 className="text-3xl font-bold" id="P2pT">Sales dashboard</h1>
  <Select label="Region" value="$region" options="$regions" placeholder="All regions" id="G2uA" />
  <Grid mode="flow" className="mt-6" id="QKcb">
    <GridItem w={6} id="Mzpb">
      <Card id="beP4"><CardHeader id="CrIU"><CardTitle id="hxFu">Total revenue</CardTitle></CardHeader>
        <CardContent className="text-4xl font-semibold" id="emS6"><Number data="$monthly" col="revenue" agg="sum" prefix="$" format=",.0f" id="M5Qz" /></CardContent></Card>
    </GridItem>
    <GridItem w={6} id="FHUP">
      <Card id="tceN"><CardHeader id="hVUX"><CardTitle id="agxi">Total units</CardTitle></CardHeader>
        <CardContent className="text-4xl font-semibold" id="Vk1q"><Number data="$monthly" col="units" agg="sum" format=",.0f" id="OU7D" /></CardContent></Card>
    </GridItem>
    <GridItem w={6} id="Cajh">
      <Question title="Revenue by month" data="$monthly" height="300px" viz={{"kind":"vega-lite","spec":{"mark":"line","encoding":{"x":{"field":"month","type":"temporal"},"y":{"field":"revenue","type":"quantitative"}}}}} id="AVkX" />
    </GridItem>
    <GridItem w={6} id="tL9g">
      <Question title="Revenue by product" data="$by_product" height="300px" viz={{"kind":"vega-lite","spec":{"mark":"bar","encoding":{"x":{"field":"product","type":"nominal"},"y":{"field":"revenue","type":"quantitative"}}}}} id="EPuJ" />
    </GridItem>
  </Grid>
  <h2 className="mt-8 text-2xl font-semibold" id="JcDo">Monthly detail</h2>
  <DataTable data="$monthly" height="300px" id="dIQl" />
</div>
