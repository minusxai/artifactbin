---
name: templates-dashboard
description: >-
  The dashboard genre in full: beats, layout grammar, a copyable skeleton, Do/Don't. Read only for a long or intricate dashboard — the brief's sketch is enough for a short, plain one.
read_first_max: 6144
order: 4
---
## Read first

[[ template.description ]]

[[ template.personality ]]

Beats: [[ template.beats | join(' → ') ]]

PROSE BUDGET: the kicker, ONE quiet verdict sentence, tile labels of three words or
fewer, the status footer — nothing else. A sentence explaining what a chart shows
becomes that tile's ≤3-word label instead.

SKELETON (adapt cols/rows to the data; 12 columns × 86px rows):

  <Helmet>
    <Value name="region" type="string" /><Value name="grain" type="string" default="week" /><Value name="min_rev" type="number" default={0} />
    <Query name="regions">{`select distinct region from ref_<datasetId> order by 1`}</Query>
    <Query name="rev_by_week">{`select date_trunc($grain, day) period, sum(revenue) revenue from ref_<datasetId> where ($region is null or region = $region) and revenue >= $min_rev group by 1 order by 1`}</Query>
    <Query name="orders_by_week">{`select date_trunc($grain, day) period, count(*) orders from ref_<datasetId> where $region is null or region = $region group by 1 order by 1`}</Query>
    <Query name="kpi_aov">{`select sum(revenue) / count(*) aov from ref_<datasetId> where $region is null or region = $region`}</Query>
    <Query name="by_region">{`select region, sum(revenue) revenue from ref_<datasetId> group by 1 order by 2 desc`}</Query>
  </Helmet>
  <div data-design="tw" className="@container min-h-screen bg-background px-4 py-4 @2xl:px-6 text-foreground">
    <header className="border-b-2 border-foreground pb-3">
      <div className="flex items-baseline justify-between">
        <p className="text-xs uppercase tracking-widest font-semibold text-primary">Ops · Weekly</p>
        <span className="font-mono text-[11px] uppercase tracking-wider text-muted-foreground"><span className="text-primary">●</span> live · refreshed daily</span>
      </div>
      <h1 className="mt-2 text-base @2xl:text-lg font-medium tracking-tight">The verdict is one spoken sentence, set small.</h1>
    </header>
    <div className="flex flex-wrap items-end gap-4 py-3">
      <Select label="Region" value="$region" options="$regions" placeholder="All regions" />
      <Segmented label="Grain" value="$grain" options={["day","week","month"]} />
      <Slider label="Min revenue" value="$min_rev" min={0} max={5000} step={100} prefix="$" format=",.0f" />
    </div>
    <Grid>
      <GridItem x={0} y={0} w={6} h={3} className="rounded-md border border-border bg-card/50">
        <Question data="$rev_by_week" viz={{"kind":"recipe","recipe":"minusx/trend@1","bindings":{"date":"period","value":["revenue"]},"params":{"compareMode":"previous"},"columnFormats":{"revenue":{"format":"$,.0f","alias":"Revenue"}}}} />
      </GridItem>
      <GridItem x={6} y={0} w={3} h={3} className="rounded-md border border-border bg-card/50">
        <Question data="$orders_by_week" viz={{"kind":"recipe","recipe":"minusx/trend@1","bindings":{"date":"period","value":["orders"]},"columnFormats":{"orders":{"format":",.0f","alias":"Orders"}}}} />
      </GridItem>
      <GridItem x={9} y={0} w={3} h={3} className="rounded-md border border-border bg-card/50">
        <Question data="$kpi_aov" viz={{"kind":"single_value","yCols":["aov"],"singleValueConfig":{"label":"Avg order value","prefix":"$","format":",.2f"}}} />
      </GridItem>
      <GridItem x={0} y={3} w={8} h={5} className="rounded-md border border-border bg-card/50">
        <Question title="Revenue by week" data="$rev_by_week" viz={{"kind":"vega-lite","spec":{}}} />
      </GridItem>
      <GridItem x={8} y={2} w={4} h={6} className="rounded-md border border-border bg-card/50">
        <Question title="By region" data="$by_region" viz={{"kind":"vega-lite","spec":{}}} />
      </GridItem>
      <GridItem x={0} y={8} w={12} h={4} className="rounded-md border border-border bg-card/50">
        <DataTable data="$by_region" columns={[{"col":"region","title":"Region"},{"col":"revenue","title":"Revenue","fmt":"$,.0f","bar":true}]} />
      </GridItem>
    </Grid>
    <p className="mt-4 font-mono text-[11px] uppercase tracking-wider text-muted-foreground">ref tables · window covered · refreshed daily</p>
  </div>

## Rules

Type register — NO BOLD HEADLINES: the display face sits this genre out. The verdict is
body text, set small and matter-of-fact — never a display headline, never larger than
`text-lg`, never `font-bold`. The utility face carries every repeated signal (kickers,
tile labels, controls, chips, axes, digits), all `tabular-nums`.

FULL SCREEN: the grid owns the viewport — no `max-w-*` column anywhere. The
command bar is ONE compact band (~100px); air comes from tile padding, not page margins.

CONTROLS ARE MANDATORY: declare at least one shared `<Value>` in `<Helmet>`, bind it to a
visible control in the command bar, and make EVERY query that can respond to it do so.
Kit controls write their bound Value on change — the skeleton's three, plus `<DatePicker label="Since" value="$since" />` and `<Switch label="Compare"
checked="$flag" />`. `Select`'s `options` is a table (column 1 value, column 2 label) or
an inline array, and a null-default Value gets the "all" choice automatically;
`Segmented` beats Select when the options fit one row; `Slider` carries a live formatted
readout. Native `<select>`/`<input>` bind too; the kit controls are the default here.

THE LOOK (compose 3-4):
- The accent lives in exactly two places: the controls' active states and the hero
  chart's focal series; everything else is foreground, muted, hairlines. Charts inside
  tiles: gray series, the focal one accented, direct labels, no chart title repeating
  the tile's label.
- KPI tiles are TREND CARDS, not bare numbers: `minusx/trend@1` (big value, delta vs the
  previous period, sparkline) over a small ascending time-series query — ascending order
  is the contract. `single_value` survives only where history is meaningless (a ratio, a
  snapshot count).
- The anchor gauge: ONE oversized trend card (w 4-6, h 3) as the page's biggest object.
- Density rhythm: vary tile sizes with importance on a few shared row heights; near-equal
  boxes read as a spreadsheet.

TILE DISCIPLINE:
- The recipe's `columnFormats` (format/alias) does ALL the talking — no caption divs
  above or inside tiles. Same for `single_value`'s `singleValueConfig` (written anywhere
  else, it renders a table).
- Embeds fill their cells — NEVER `height=` on a `<Question>` inside a GridItem; size
  with `h`. One embed per GridItem.
- ONE `<Grid>` per section holds everything visual (readers drag and resize tiles in edit
  mode; hand-rolled flex/grid forfeits that); order GridItems top-left → bottom-right —
  on phones the grid stacks in SOURCE order.

Do
- Trend cards for the KPI band and the anchor gauge; the same quiet casing on every tile;
  reading-order GridItems.
Don't
- Bold or display-face headlines; prose between tiles; shadows or gradients on tiles; a
  bare number where its trend exists; zero controls; a query that ignores the controls
  without reason; dropdowns inside Grid tiles (they clip); `height=` on embeds inside
  cells; nested Grids; a Grid wrapping the command bar or footer.
- Entrance or reveal animation on tiles — hover states and the controls' own transitions
  are the only motion a dashboard needs.

Components: [markup.md](markup.md); publish API: [publishing.md](publishing.md).
