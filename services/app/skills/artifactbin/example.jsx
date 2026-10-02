---
# CLI maintains id, edit_id, head_version, state and version.
title: Q3 sales review
template: dashboard
theme: modernist
visibility: unlisted
---
<Helmet>
<title>Q3 sales review</title>
<style>{`.kpi { letter-spacing: -0.02em } /* custom CSS lives here */`}</style>
{/* afbin add sales.csv --json gives its ref:<id> (abc123 here); SQL reads sales.rows. */}
<Import name="sales" src="ref:abc123" />
{/* $region is reader state; data="$monthly" binds query rows to the view. */}
<Value name="region" type="string" />
<Query name="regions">{`select distinct region from sales.rows order by 1`}</Query>
<Query name="monthly">{`
select month, sum(revenue) as revenue from sales.rows
where $region is null or region = $region group by 1 order by 1
`}</Query>
<Query name="by_region">{`select region, sum(revenue) as revenue from sales.rows group by 1 order by 2 desc`}</Query>
{/* Tasks: afbin help users; columns id:number, title:string, status:string,
assignee:user. Replace ntf123 with that published dataset's ID. */}
<Import name="tasks" src="ref:ntf123" />
<Value name="task_id" type="number" default={1} />
<Value name="status" type="string" default="Done" />
<Mutation name="change_status" expectedAffected={1}>{`
update tasks.rows set status = $status where id = $task_id
`}</Mutation>
{/* Actor shown separately: Task Review pricing is now Done.
Joined recipients only; rules combine per user/run. */}
<Notify name="status_notice" on="change_status">{`
select assignee as "to", 'Task ' || title || ' is now ' || status as message
from tasks.rows where id = $task_id
`}</Notify>
</Helmet>
{/* Body: static JSX, HTML and kit components, Tailwind className, no CDN scripts.
Each node has a persistent id: keep it when moving; never reuse it. */}
<div data-design="tw" className="@container px-4 py-8 @2xl:px-8">
<header className="max-w-prose">
<h1 className="text-3xl @2xl:text-5xl font-bold">Revenue grew in every region but one</h1>
<p>Container prefixes like @2xl: start at phone width.</p>
</header>
{/* Changing $region reruns its queries. */}
<Select label="Region" value="$region" options="$regions" placeholder="All regions" />
{/* Grid columns: w is out of 12; narrow screens stack. */}
<Grid mode="flow" className="mt-6">
<GridItem w={4}>
{/* data="$monthly" binds computed query rows. */}
<Card><CardHeader><CardTitle>Total revenue</CardTitle></CardHeader>
<CardContent className="kpi text-4xl font-semibold">
<Number data="$monthly" col="revenue" agg="sum" prefix="$" format=",.0f" />
</CardContent></Card>
</GridItem>
<GridItem w={8}>
{/* Vega-Lite or shipped recipes, never hand-rolled <svg>. */}
<Question title="Revenue by month" data="$monthly" height="320px"
viz={{"kind":"vega-lite","spec":{"mark":"line","encoding":{"x":{"field":"month","type":"temporal"},"y":{"field":"revenue","type":"quantitative"}}}}} />
</GridItem>
</Grid>
<h2 className="mt-8 text-2xl font-semibold">By region</h2>
<DataTable data="$by_region" height="240px" />
<Button run="$change_status">Complete selected task</Button>
</div>
