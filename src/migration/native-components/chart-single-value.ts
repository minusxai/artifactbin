import type {NativeChartNumberFormatter,NativeSingleValuePresentation} from './chart-contracts.ts';
import type {NativeChartTable} from './chart-runtime.ts';
import type {NativeJson} from './analyze-contracts.ts';
import {nativeChartCellText} from './chart-table.ts';
/** Exact retained islands/kit/data.tsx Chart.single(), not the first-row Vega
 * single-value recipe. The adapter supplies the retained numberFormatter. */
export function nativeChartSingleValue(table:NativeChartTable,props:Readonly<Record<string,NativeJson>>,numberFormatter:NativeChartNumberFormatter):NativeSingleValuePresentation{
 const viz=(props.viz??{}) as {yCols?:string[];singleValueConfig?:{prefix?:string;suffix?:string;label?:string;format?:string}};
 const cfg=viz.singleValueConfig??{},col=(viz.yCols??[table.columns.find(c=>c.type==='number')?.name??table.columns[0]?.name])[0];
 const nums=table.rows.map(row=>Number(row[col??''])).filter(Number.isFinite),value=nums.length?nums.reduce((a,b)=>a+b,0):NaN;
 return {label:cfg.label??props.title,text:`${cfg.prefix??''}${!Number.isFinite(value)?'—':cfg.format?numberFormatter(cfg.format)(value):nativeChartCellText(value)}${cfg.suffix??''}`};
}
