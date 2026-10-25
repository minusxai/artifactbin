import type {NativeRegisteredQueryPlan,NativeQueryColumnType} from './query-plan-contracts.ts';
type LocalTable=NonNullable<NativeRegisteredQueryPlan['localTables']>[number];
const sqlName=(v:unknown):v is string=>typeof v==='string'&&/^[A-Za-z_][A-Za-z0-9_]{0,127}$/.test(v)&&!['__proto__','prototype','constructor'].includes(v.toLowerCase());
/** Exact compiled authored rows only. Mutable table actions require a separate runtime contract. */
export function nativeLocalTable(value:{name:string;columns?:readonly {name:string;type:string}[];rows?:readonly Record<string,unknown>[]}):LocalTable {
 if(!sqlName(value.name)||value.name.toLowerCase()==='_me'||!Array.isArray(value.columns)||!value.columns.length||!Array.isArray(value.rows)||value.rows.length>10000||value.rows.length*value.columns.length>1000000)throw Error('query_local_table_invalid');
 const names=new Set<string>();
 for(const column of value.columns){if(!sqlName(column.name)||names.has(column.name.toLowerCase())||!['string','number','boolean','date','timestamp','user'].includes(column.type))throw Error('query_local_table_invalid');names.add(column.name.toLowerCase());}
 const keys=new Set(value.columns.map(c=>c.name));
 for(const row of value.rows){
  if(!row||typeof row!=='object'||Array.isArray(row)||Object.keys(row).some(k=>!keys.has(k)))throw Error('query_local_table_invalid');
  for(const column of value.columns){const cell=row[column.name]??null;if(cell!==null&&(column.type==='number'?typeof cell!=='number'||!Number.isFinite(cell):column.type==='boolean'?typeof cell!=='boolean':typeof cell!=='string'))throw Error('query_local_table_invalid');}
 }
 return structuredClone({name:value.name,columns:value.columns as {name:string;type:NativeQueryColumnType}[],rows:value.rows as LocalTable['rows']});
}
