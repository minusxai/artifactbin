/** Server composition of the shared dataflow evaluator. CLI supplies its own local engine. */
import {runQueries} from './engine';
import {queryRows} from '../datasets/query-rows';
import {evaluateDataflow,type DatasetTables,type RunDataflowOptions} from './dataflow-core';
import type {Dataflow} from '../story/dataflow';
export type {DatasetTables,RunDataflowOptions} from './dataflow-core';
export const runDataflow=(flow:Dataflow,datasets:DatasetTables,opts:RunDataflowOptions={})=>evaluateDataflow({run:runQueries,queryRows},flow,datasets,opts);
