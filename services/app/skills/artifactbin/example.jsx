---
# The YAML fence is the document's metadata. The CLI adds and maintains
# id, edit_id, head_version, state and version after the first push.
title: Q3 sales review
template: dashboard   # dashboard | deck | editorial | plan | scrolly, or omit
theme: modernist      # afbin help themes lists the bundled themes
visibility: unlisted  # private | unlisted | public
---
<Helmet>
  {/* One Helmet per document: title, one style, one script, data declarations. */}
  <title>Q3 sales review</title>
  <style>{`.kpi { letter-spacing: -0.02em } /* custom CSS lives here, never inline */`}</style>
  {/* A Value is a reader-changeable scalar; SQL reads it as $region (null = all). */}
  <Value name="region" type="string" />
  {/* A relative CSV or JSON file is a dataset; push publishes it and rewrites the
      source to ref:<id>. SQL names the table public.rows, never the file. */}
  <Query name="regions" source="./sales.csv">{`select distinct region from public.rows order by 1`}</Query>
  <Query name="sales" source="./sales.csv">{`
    select month, sum(revenue) as revenue from public.rows
    where $region is null or region = $region group by 1 order by 1
  `}</Query>
  <Query name="by_region" source="./sales.csv">{`select region, sum(revenue) as revenue from public.rows group by 1 order by 2 desc`}</Query>
</Helmet>
{/* The body is static JSX: HTML prose plus kit components, styled with
    className (Tailwind), never style=. No CDN scripts, <script>, <iframe> or
    <form> here. Every body element gets a persistent id at publish, for its lifetime:
    Move a node with the same id; never reuse an id for another node. */}
<div data-design="tw" className="@container px-4 py-8 @2xl:px-8">
  <header className="max-w-prose">
    <p className="text-xs uppercase tracking-widest text-muted-foreground">Sales · Q3</p>
    <h1 className="mt-2 text-3xl @2xl:text-5xl font-bold tracking-tight">Revenue grew in every region but one</h1>
    <p className="mt-3 text-muted-foreground">Prose stays unwrapped; container prefixes like @2xl: start at phone width.</p>
  </header>
  {/* A bound control writes the Value; every query that reads $region re-runs. */}
  <Select label="Region" value="$region" options="$regions" placeholder="All regions" />
  {/* Grid mode="flow" makes columns; w is out of 12 and stacks on narrow screens. */}
  <Grid mode="flow" className="mt-6">
    <GridItem w={4}>
      {/* $sales binds a query result. Figures are computed from data, never typed in. */}
      <Card><CardHeader><CardTitle>Total revenue</CardTitle></CardHeader>
        <CardContent className="kpi text-4xl font-semibold">
          <Number data="$sales" col="revenue" agg="sum" prefix="$" format=",.0f" />
        </CardContent></Card>
    </GridItem>
    <GridItem w={8}>
      {/* Charts are Vega-Lite specs or shipped recipes, never hand-rolled <svg>. */}
      <Question title="Revenue by month" data="$sales" height="320px"
        viz={{"kind":"vega-lite","spec":{"mark":"line","encoding":{"x":{"field":"month","type":"temporal"},"y":{"field":"revenue","type":"quantitative"}}}}} />
    </GridItem>
  </Grid>
  <h2 className="mt-8 text-2xl font-semibold">By region</h2>
  <DataTable data="$by_region" height="240px" />
  {/* Images: <img src="ref:<imageId>" /> for an uploaded one, or a web URL; publish stores a copy. */}
  <Alert className="mt-6"><AlertTitle>Method</AlertTitle><AlertDescription>Revenue is summed from the monthly rows in sales.csv.</AlertDescription></Alert>
</div>
