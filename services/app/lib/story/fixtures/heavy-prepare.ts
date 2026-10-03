/**
 * THE HEAVY PREPARE FIXTURES: the shapes that held the app's event loop for ~15 s when a backfill
 * prepared them on the request thread (2026-10-02). One dashboard of large, layered, faceted and
 * offset Vega-Lite charts over generated rows (a grouped bar on a continuous x — "xOffset dropped
 * because x is continuous" — among them), and one document of 28 data tables. Used by the
 * responsiveness test (__tests__/prepare-responsive.test.ts) and the local backfill reproduction.
 */

/** `rows` generated rows of (i, day, region, product, revenue, units), in SQL any engine here runs. */
const generated = (name: string, rows: number) => `<Query name="${name}">{\`
    with recursive n(i) as (select 0 union all select i + 1 from n where i < ${rows - 1})
    select i, date('2024-01-01', '+' || (i % 365) || ' days') as day,
      case i % 4 when 0 then 'north' when 1 then 'south' when 2 then 'east' else 'west' end as region,
      case i % 6 when 0 then 'alpha' when 1 then 'beta' when 2 then 'gamma' when 3 then 'delta' when 4 then 'epsilon' else 'zeta' end as product,
      (i * 7919) % 1000 + (i % 37) * 3.5 as revenue, (i * 104729) % 97 as units
    from n
  \`}</Query>`;

const question = (id: string, title: string, data: string, spec: Record<string, unknown>) =>
  `<GridItem w={6} id="g${id}"><Question title="${title}" data="$${data}" height="360px" viz={${JSON.stringify({ kind: 'vega-lite', spec })}} id="q${id}" /></GridItem>`;

const CHARTS: Array<[string, Record<string, unknown>]> = [
  ['Daily revenue, layered', { layer: [
    { mark: 'area', encoding: { x: { field: 'day', type: 'temporal' }, y: { aggregate: 'sum', field: 'revenue', type: 'quantitative' }, color: { field: 'region', type: 'nominal' } } },
    { mark: { type: 'line', point: true }, encoding: { x: { field: 'day', type: 'temporal' }, y: { aggregate: 'mean', field: 'revenue', type: 'quantitative' } } },
    { mark: 'rule', encoding: { y: { aggregate: 'mean', field: 'revenue', type: 'quantitative' } } },
  ] }],
  ['Grouped by product on a continuous axis', { mark: 'bar', encoding: { x: { field: 'day', type: 'temporal' }, xOffset: { field: 'product' }, y: { field: 'revenue', type: 'quantitative' }, color: { field: 'product', type: 'nominal' } } }],
  ['Every row', { mark: 'point', encoding: { x: { field: 'i', type: 'quantitative' }, y: { field: 'revenue', type: 'quantitative' }, color: { field: 'region', type: 'nominal' }, size: { field: 'units', type: 'quantitative' } } }],
  ['Faceted by region and product', { mark: 'line', encoding: { x: { field: 'day', type: 'temporal' }, y: { field: 'revenue', type: 'quantitative' }, row: { field: 'region' }, column: { field: 'product' } } }],
  ['Binned heatmap', { mark: 'rect', encoding: { x: { field: 'i', bin: { maxbins: 60 }, type: 'quantitative' }, y: { field: 'revenue', bin: { maxbins: 40 }, type: 'quantitative' }, color: { aggregate: 'count', type: 'quantitative' } } }],
  ['Stacked units', { mark: 'bar', encoding: { x: { field: 'day', timeUnit: 'yearmonthdate', type: 'ordinal' }, y: { aggregate: 'sum', field: 'units', type: 'quantitative' }, color: { field: 'region', type: 'nominal' } } }],
  ['Regression over points', { layer: [
    { mark: 'circle', encoding: { x: { field: 'units', type: 'quantitative' }, y: { field: 'revenue', type: 'quantitative' } } },
    { mark: 'line', transform: [{ regression: 'revenue', on: 'units' }], encoding: { x: { field: 'units', type: 'quantitative' }, y: { field: 'revenue', type: 'quantitative' } } },
    { mark: 'line', transform: [{ loess: 'revenue', on: 'units' }], encoding: { x: { field: 'units', type: 'quantitative' }, y: { field: 'revenue', type: 'quantitative' } } },
  ] }],
  ['Boxplots', { mark: 'boxplot', encoding: { x: { field: 'product', type: 'nominal' }, y: { field: 'revenue', type: 'quantitative' }, color: { field: 'region', type: 'nominal' }, xOffset: { field: 'region' } } }],
];

/** The heavy-chart dashboard. `variant` only changes a heading, so each copy is its own document. */
export function heavyChartsMarkup(variant = 0, rows = 4000): string {
  return `<Helmet>
  <title>Heavy charts ${variant}</title>
  ${generated('daily', rows)}
</Helmet>
<div data-design="tw" className="@container px-4 py-8 @2xl:px-8" id="root">
  <h1 className="text-3xl font-bold" id="head">Heavy charts ${variant}</h1>
  <Grid mode="flow" className="mt-6" id="grid">
    ${CHARTS.map(([title, spec], i) => question(String(i), title, 'daily', spec)).join('\n    ')}
  </Grid>
</div>`;
}

/** A document of `tables` data tables, each over its own generated query. */
export function manyTablesMarkup(variant = 0, tables = 28, rows = 400): string {
  const names = Array.from({ length: tables }, (_, i) => `t${i}`);
  return `<Helmet>
  <title>Many tables ${variant}</title>
  ${names.map((n) => generated(n, rows)).join('\n  ')}
</Helmet>
<div data-design="tw" className="px-4 py-8" id="root">
  <h1 className="text-3xl font-bold" id="head">${tables} tables ${variant}</h1>
  ${names.map((n, i) => `<h2 className="mt-6 text-xl font-semibold" id="h${i}">Table ${i}</h2>\n  <DataTable data="$${n}" height="300px" id="d${i}" />`).join('\n  ')}
</div>`;
}
