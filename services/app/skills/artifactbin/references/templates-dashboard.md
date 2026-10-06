---
name: templates-dashboard
description: >-
  The dashboard page type: the reader's job, three compositions the thesis chooses between, what the runtime needs from a positioned Grid, and the failure modes worth a rule.
order: 4
---
## Read first

[[ template.description ]]

[[ template.personality ]]

Beats, as options rather than a sequence: [[ template.beats | join(' · ') ]]

A dashboard is scanned and operated, not read: summary before detail, and
what needs attention reads at a glance. The design system owns the look (its
tiles, numerals, chart colours; its reference carries a dashboard specimen
when it fits); the thesis owns the layout. Pick ONE composition below from
the reader's job, name it in the Helmet record, and build that. The same
tile grid for every dashboard is the failure this page exists to prevent.

## Compositions

- **Shift briefing.** A computed finding leads, as one quiet spoken sentence;
  one explanatory comparison follows; then an inspectable ledger. For
  allocating attention from a snapshot ("which queue needs me now").
  Rejected default: a grid of eight equal KPI tiles that shows everything
  and prioritizes nothing.
- **Operations board.** A spatial or structural view of the system (a map, a
  lane diagram, a tree) with the exceptions adjacent and the controls as the
  centrepiece. For dispatch, monitoring a network, anything with a geography.
- **Monitoring grid.** The positioned Grid of trend cards and evidence tiles
  under one compact control band, when the job really is watching many equal
  signals over time. Only then; it is the default everyone else reaches for.

## What the runtime needs

- Controls are shared `<Value>`s in `<Helmet>` bound to kit controls
  (`Select`, `Segmented`, `Slider`, `DatePicker`, `Switch`), and every query
  that can respond to a control does. A null-default Value gets the "all"
  choice automatically; `Select`'s `options` is a table or an inline array.
- A positioned `<Grid>` holds tiles that readers drag and resize in edit
  mode: ONE `<Grid>` per section, GridItems in reading order (phones stack in
  source order), embeds fill their cell (`h` sizes them; never `height=` on a
  `<Question>` inside a cell), one embed per cell. Use the Question `title` prop
  for its heading; a separate sibling heading adds height and clips the chart.
  A flow Grid or plain HTML
  for anything that should grow with content.
- Trend cards are `minusx/trend@1` over a small ascending time series;
  `single_value` only where history is meaningless. The recipe's
  `columnFormats` does the labelling; no caption divs in tiles.
- [Editable tables](markup-editing.md) sit outside the Grid.

Skeleton of the runtime pieces (publishable as is; the composition is yours):

  <Helmet>
    <Value name="region" type="string" />
    <Import name="sales" src="ref:abc123" />
    <Query name="regions">{`select distinct region from sales.rows order by 1`}</Query>
    <Query name="rev_by_week">{`select date_trunc('week', day) period, sum(revenue) revenue from sales.rows where $region is null or region = $region group by 1 order by 1`}</Query>
  </Helmet>
  <div data-design="tw" className="@container min-h-screen px-4 py-4 @2xl:px-6 text-foreground">
    <header className="border-b-2 border-foreground pb-3">
      <p className="t-label">Ops · Weekly</p>
      <h1 className="mt-2 t-body">The verdict is one spoken sentence, set small.</h1>
    </header>
    <div className="flex flex-wrap items-end gap-4 py-3">
      <Select label="Region" value="$region" options="$regions" placeholder="All regions" />
    </div>
    <Grid>
      <GridItem x={0} y={0} w={6} h={3} className="rounded-md border border-border bg-card/50">
        <Question data="$rev_by_week" viz={{"kind":"recipe","recipe":"minusx/trend@1","bindings":{"date":"period","value":["revenue"]},"params":{"compareMode":"last"},"columnFormats":{"revenue":{"format":"$,.0f","alias":"Revenue"}}}} />
      </GridItem>
    </Grid>
  </div>

Trend `compareMode`: use `last`; `previous` only to exclude an incomplete
current period, and label it. Statistical qualifiers override label length:
"average of monthly medians" must not become "median resolution".

## Rules

Do
- One clear verdict, using the system's hierarchy; consistent roles carry
  repeated signals, `tabular-nums` on digits.
- Use the system's accent and chart-series roles consistently. Active
  controls and important exceptions remain distinguishable; label series.
- Vary tile sizes with importance; near-equal boxes read as a spreadsheet.

Don't
- Decoration that competes with operating signals; a bare number where its
  trend exists; zero controls; a query that ignores the controls without reason.
- Nested Grids; a Grid wrapping the command bar; `height=` on embeds inside
  cells; entrance or reveal animation on tiles.

Components: [markup.md](markup.md); publish API: [publishing.md](publishing.md).
