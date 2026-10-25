import type {MigrationQueryFlow} from '../query-preparation-contracts.ts';
/** Trusted migration inventory mapping; never supplied by a page request. Exact refs are not guessed or normalized. */
export interface NativeQueryDatasetMapping {sourceRef:string;targetDatasetId:string}
export type NativeQueryColumnType='string'|'number'|'boolean'|'date'|'timestamp'|'user';
/** Compatible immutable target registered-page-queries QueryPlan payload (registration attached by the host). */
export interface NativeRegisteredQueryPlan {
 localTables?:readonly {name:string;columns:{name:string;type:NativeQueryColumnType}[];rows:Record<string,string|number|boolean|null>[]}[];
 scalars:Record<string,{type:NativeQueryColumnType;default:string|number|boolean|null}>;
 queries:readonly {name:string;sql:string;dependencies:readonly string[];source?:string}[];
 imports:readonly {alias:string;binding:string;table:string}[];
}
export interface NativeRegisteredQueryPlanInput {
 flow:Pick<MigrationQueryFlow,'values'|'queries'|'imports'>;
 datasets:readonly NativeQueryDatasetMapping[];
}
