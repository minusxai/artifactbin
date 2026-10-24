/** Exact retained Question table presentation (islands/kit/data.tsx): up to
 * 200 rows, browser runtime locale, numeric maximumFractionDigits=2. */
export function nativeChartCellText(value:unknown):string{return typeof value==='number'?new Intl.NumberFormat(undefined,{maximumFractionDigits:2}).format(value):String(value??'');}
export function nativeChartVisibleRows<T>(rows:readonly T[]):T[]{return rows.slice(0,200);}
