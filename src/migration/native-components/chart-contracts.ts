import type {NativeJson,NativeTypedAnalysis} from './analyze-contracts.ts';
export interface NativeChartMapping {
 sourceNode:string;nodeSha256:string;sourceSha256:string;analysisSha256:string;
 kind:'vega-lite'|'table'|'single_value';data:{kind:'table'|'ref';name:string};
 /** Exact saved attributes, including viz.spec. No normalized replacement recipe. */
 props:Readonly<Record<string,NativeJson>>;
 height:number;inGridItem:boolean;sha256:string;
}
export interface NativeChartAdapter {specifier:string;sha256:string;dependencies:readonly {path:string;sha256:string}[]}
export interface NativeChartMappingResult {mappings:readonly NativeChartMapping[];blockers:readonly {sourceNode:string;code:string}[]}
export type NativeMapCharts=(analysis:NativeTypedAnalysis)=>NativeChartMappingResult;

/** Chart.single() consumes all finite numeric coercions, unlike Cell first-row or Vega recipe semantics. */
export interface NativeSingleValuePresentation {label:unknown;text:string}
export type NativeChartNumberFormatter=(spec:string|undefined)=>(value:number)=>string;
