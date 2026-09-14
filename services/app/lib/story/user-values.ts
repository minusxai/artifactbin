import type {Dataflow} from './dataflow';
import type {ResolvedRef} from './refs';

/** Resolve inherited field contracts once per execution, using the caller's existing reference loader. */
export async function resolveUserValues(flow:Dataflow,load:(id:string)=>Promise<Pick<ResolvedRef,'columns'|'catalog'>|null|undefined>):Promise<Dataflow> {
 const values=await Promise.all(flow.values.map(async value=>{
  if(value.kind!=='scalar'||!value.source)return value;
  const source=await load(value.source);
  const column=(source?.catalog?.tables.find(t=>t.schema==='public'&&t.name==='rows')?.columns??source?.columns)?.find(c=>c.name===value.column);
  if(!column||column.type!=='user')throw new Error(`Value ${value.name} must bind an available user column`);
  return {...value,type:column.type,constraints:column.constraints};
 }));
 return {...flow,values};
}
