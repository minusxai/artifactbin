/**
 * Internal: light-DOM stylesheet for af-chart: the plot slot (drawings stack in one grid cell, so
 * a rebuilt chart replaces the old one without a gap), the status line, the data-source label
 * and the values table.
 * Used by: chart.ts.
 */
import { dataSourceStyles } from './data-source-label';
const C = 'af-chart';
export const chartStyles = `
${C}{display:block;min-width:0;color:var(--foreground,CanvasText);` +
  `font-family:var(--font-body,inherit)}
${C}>script{display:none}
${C}>.af-chart-plot{display:grid;width:100%;min-width:0}
${C}>.af-chart-plot>div{grid-area:1/1;min-width:0;min-height:0}
${C}>.af-chart-plot svg{display:block}
${C}>.af-chart-status{margin:0;padding:.5rem 0;font-size:.875rem;` +
  `color:var(--muted-foreground,GrayText)}
${C}>.af-chart-status[data-kind=error]{color:var(--destructive,#b91c1c)}
${C}>[hidden]{display:none}
${C}>.af-chart-values{margin-top:.5rem;font-size:.8125rem}
${C}>.af-chart-values>summary{cursor:pointer;color:var(--muted-foreground,GrayText)}
${C} .af-chart-scroll{overflow:auto;max-height:20rem}
${C} .af-chart-values table{border-collapse:collapse;width:100%;margin-top:.5rem;` +
  `font-variant-numeric:tabular-nums}
${C} .af-chart-values th,${C} .af-chart-values td{padding:4px 8px;text-align:left;` +
  `border-bottom:1px solid var(--border,#e5e7eb)}
${C} .af-chart-values td.af-chart-number{text-align:right}
${C} .af-chart-values p{margin:.5rem 0 0;color:var(--muted-foreground,GrayText)}
${C}>.af-data-source{margin-top:.5rem}
` + dataSourceStyles;
