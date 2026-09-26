/**
 * A LOCAL DOCUMENT'S DATAFLOW: compiled and run in this process, over the
 * workspace's own copies of what it imports — the same compiler and the same
 * SQLite engine the server uses (app lib/story/compile-dataflow,
 * lib/sql/dataflow-core). A query that runs inside a connected database has
 * no local copy to run over, and says so.
 */
import './sqlite-wasm';
import type {Row} from '@artifactbin/contracts';
import {createSqliteSql} from '@artifactbin/sql/sqlite';
import type {DatasetColumn} from '../../app/lib/story/dataset-shape';
import type {Dataflow,DataflowState} from '../../app/lib/story/dataflow';
import type {CompiledDataflow} from '../../app/lib/story/compiled-dataflow';
import {compileWithLoader} from '../../app/lib/story/compile-dataflow';
import {evaluateDataflow,type ImportTables,type RunDataflowOptions} from '../../app/lib/sql/dataflow-core';
import {CliError} from './errors';

/** A dataset's rows as the workspace holds them, or undefined when it has no local copy. */
export type LocalTable=(ref:string)=>Promise<{rows:Row[];columns:DatasetColumn[]}|undefined>;

/** The artifacts a document's declarations name — what a local run must find copies of. */
export const declaredRefs=(flow:Dataflow):string[]=>[...new Set([...flow.imports.map(i=>i.ref),...flow.queries.flatMap(q=>q.source?[q.source]:[])])];

/** Compile a local document against its local copies; the compiler's own messages when it does not compile. */
export async function compileLocal(flow:Dataflow,table:LocalTable):Promise<CompiledDataflow>{
 const result=await compileWithLoader(flow,async ref=>{const found=await table(ref);return found?{kind:'dataset',tables:[{name:'rows',columns:found.columns}]}:null;});
 if(!result.ok)throw new CliError('invalid_query',result.errors.map(error=>error.message).join('\n'),'Fix the declarations, or run afbin validate on this file.');
 return result.compiled;
}

/** Run a compiled local document over its local copies. */
export async function runLocal(flow:CompiledDataflow,table:LocalTable,opts:RunDataflowOptions):Promise<DataflowState>{
 const imports:ImportTables={};
 for(const i of flow.imports){const found=await table(i.ref);if(found)imports[i.name]={rows:found};}
 const sql=createSqliteSql();
 return evaluateDataflow({run:input=>sql.run(input)},flow,imports,opts);
}
