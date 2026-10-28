---
# CLI maintains id, edit_id and version.
title: Q3 sales review
template: dashboard
theme: volta
visibility: unlisted
---
<Helmet>
<title>Q3 sales review</title>
<style>{`.kpi { letter-spacing: -0.02em } /* custom CSS lives here */`}</style>
{/* Import sales.csv as ref:<id>; SQL reads sales.rows. */}
<Import name="sales" src="ref:abc123" />
{/* $region: reader state; $monthly: query rows. */}
<Value name="region" type="string" />
<Query name="regions">{`select distinct region from sales.rows order by 1`}</Query>
<Query name="monthly">{`
select month, sum(revenue) as revenue from sales.rows
where $region is null or region = $region group by 1 order by 1
`}</Query>
{/* ntf123: tasks dataset (id:number, status:string). */}
<Import name="tasks" src="ref:ntf123" />
<Value name="task_id" type="number" default={1} />
<Value name="status" type="string" default="Done" />
<Mutation name="change_status" expectedAffected={1}>{`
update tasks.rows set status = $status where id = $task_id
`}</Mutation>
</Helmet>
{/* static JSX; className; persistent id; no CDN scripts. */}
<div data-design="tw" className="@container px-4 py-8 @2xl:px-8">
<header className="max-w-prose">
<h1 className="text-3xl @2xl:text-5xl font-bold">Revenue grew in most regions</h1>
<p>Start at phone width; expand with @2xl:.</p>
</header>
<Select label="Region" value="$region" options="$regions" placeholder="All regions" />
<Grid mode="flow" className="mt-6">
<GridItem w={4}>
<Card><CardHeader><CardTitle>Total revenue</CardTitle></CardHeader>
<CardContent className="kpi text-4xl font-semibold">
<Cell data="$monthly" col="revenue" agg="sum" prefix="$" format=",.0f" />
</CardContent></Card>
</GridItem>
<GridItem w={8}>
{/* Vega-Lite or shipped recipes, never hand-rolled <svg>. */}
<Chart title="Revenue by month" data="$monthly" height="320px"
viz={{"kind":"vega-lite","spec":{"mark":"line","encoding":{"x":{"field":"month","type":"temporal"},"y":{"field":"revenue","type":"quantitative"}}}}} />
</GridItem>
</Grid>
<Button run="$change_status">Complete selected task</Button>
</div>
