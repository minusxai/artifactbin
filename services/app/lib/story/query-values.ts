import type {Dataflow,Scalar} from './dataflow';
/** CLI and native query admission share exact declared names and scalar types. */
export function validateQueryValues(flow:Dataflow,values:Record<string,Scalar>):{code:string;names:string[]}|null{
 const declarations=new Map(flow.values.filter(value=>value.kind==='scalar').map(value=>[value.name,value]));
 const unknown=Object.keys(values).filter(name=>!declarations.has(name));if(unknown.length)return {code:'unknown_parameter',names:unknown};
 const invalid=Object.entries(values).filter(([name,value])=>{
  if(value===null)return false;const type=declarations.get(name)!.type;
  return type==='date'?typeof value!=='string'||!Number.isFinite(Date.parse(value)):typeof value!==type;
 }).map(([name])=>name);
 return invalid.length?{code:'invalid_parameter',names:invalid}:null;
}
