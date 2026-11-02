/** Persisted dataflow snapshots captured before compiler retirement. These are inputs to
 * the supported stored-flow evaluator; this helper performs no source compilation. */
import {createHash} from 'node:crypto';
import type {DatasetColumn, Scalar, ColumnType} from '@artifactbin/contracts';
import type {CompiledDataflow} from '@/lib/dataflow';
import fixtures from './stored-dataflows.json';
type ImportSource = {kind:'dataset'|'folder'|'postgres';tables:Array<{name:string;columns:DatasetColumn[]}>;probe?:(sql:string,params:Record<string,Scalar>,types:Record<string,ColumnType>)=>Promise<{columns:DatasetColumn[];params:string[]}>};
export type TestSource=DatasetColumn[]|ImportSource;
export async function compiledSource(source:string,sources:Record<string,TestSource>={},opts:{bindings?:boolean}={}):Promise<CompiledDataflow>{
 const key=createHash('sha256').update(JSON.stringify([source,sources,opts])).digest('hex');
 const flow=(fixtures as unknown as Record<string,CompiledDataflow>)[key];
 if(!flow)throw new Error(`Missing persisted dataflow fixture: ${key}`);
 return structuredClone(flow);
}
export const compiledOf=(children:string,sources:Record<string,TestSource>={}):Promise<CompiledDataflow>=>compiledSource(`<Helmet>${children}</Helmet>`,sources,{bindings:false});
