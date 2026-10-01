/** Server composition of the shared dataflow evaluator. CLI supplies its own local engine. */
import {runManyQueries,runQueries} from './engine';
import {evaluateDataflow,evaluateDataflowMany,type ImportTables,type RunDataflowOptions} from './dataflow-core';
import type {CompiledDataflow} from '../story/data';
export type {ImportTables,RunDataflowOptions} from './dataflow-core';
const engine={run:runQueries,runMany:runManyQueries};
export const runDataflow=(flow:CompiledDataflow,imports:ImportTables,opts:RunDataflowOptions={})=>evaluateDataflow(engine,flow,imports,opts);
export const runDataflowMany=(flow:CompiledDataflow,imports:ImportTables,opts:Parameters<typeof evaluateDataflowMany>[3],runs:Parameters<typeof evaluateDataflowMany>[4])=>evaluateDataflowMany(engine,flow,imports,opts,runs);
