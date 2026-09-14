import type {DuckDBConnection} from '@duckdb/node-api';
import type {DatasetColumn} from '@artifactbin/contracts';

type Plan = {type?:string; children?:Plan[]; expressions?:Array<{type?:string;index?:number}>; function_data?:{table?:string}; column_indexes?:Array<{index?:number}>; projection_ids?:number[];projection_map?:number[];left_projection_map?:number[];right_projection_map?:number[];join_type?:string};
/** Preserve identity only through proven direct projections, never by matching output names. */
export async function userColumnLineage(conn:DuckDBConnection,sql:string,tables:Record<string,{columns:DatasetColumn[]}>,columns:DatasetColumn[]):Promise<DatasetColumn[]> {
 if(!Object.values(tables).some(t=>t.columns.some(c=>c.type==='user')))return columns;
 const result=await conn.runAndReadAll(`SELECT json_serialize_plan('${sql.replaceAll("'", "''")}') AS plan`);
 const parsed=JSON.parse(String(result.getRowObjects()[0]?.plan)) as {error?:boolean;plans?:Plan[]};
 if(parsed.error)return columns;
 function walk(plan:Plan):Array<DatasetColumn|undefined> {
  const children=(plan.children??[]).map(walk);
  if(plan.type==='LOGICAL_GET') {
   const source=tables[plan.function_data?.table??'']?.columns??[];
   const selected=(plan.column_indexes??[]).map(c=>source[c.index??-1]);
   return plan.projection_ids?.length?plan.projection_ids.map(i=>selected[i]):selected;
  }
  if(plan.type==='LOGICAL_PROJECTION')return (plan.expressions??[]).map(e=>e.type==='BOUND_REF'?children[0]?.[e.index??-1]:undefined);
  if(['LOGICAL_FILTER','LOGICAL_ORDER_BY','LOGICAL_LIMIT','LOGICAL_TOP_N','LOGICAL_DISTINCT'].includes(plan.type??''))return plan.projection_map?.length?plan.projection_map.map(i=>children[0]?.[i]):children[0]??[];
  if(plan.type==='LOGICAL_CROSS_PRODUCT')return children.flat();
  if(plan.type==='LOGICAL_COMPARISON_JOIN'&&['INNER','LEFT','RIGHT','OUTER','SINGLE'].includes(plan.join_type??'')){
   const left=plan.left_projection_map?.length?plan.left_projection_map.map(i=>children[0]?.[i]):children[0]??[];
   const right=plan.right_projection_map?.length?plan.right_projection_map.map(i=>children[1]?.[i]):children[1]??[];
   return [...left,...right];
  }
  return [];
 }
 const lineage=parsed.plans?.[0]?walk(parsed.plans[0]):[];
 return columns.map((column,index)=>lineage[index]?.type==='user'?{...lineage[index]!,name:column.name}:column);
}
