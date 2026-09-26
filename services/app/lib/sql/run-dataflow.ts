/** Server composition of the shared dataflow evaluator. CLI supplies its own local engine. */
import {runQueries} from './engine';
import {evaluateDataflow,type ImportTables,type RunDataflowOptions} from './dataflow-core';
import type {CompiledDataflow} from '../story/compiled-dataflow';
export type {ImportTables,RunDataflowOptions} from './dataflow-core';
export const runDataflow=(flow:CompiledDataflow,imports:ImportTables,opts:RunDataflowOptions={})=>evaluateDataflow({run:runQueries},flow,imports,opts);
