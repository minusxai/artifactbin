import type {Table,Column} from '@artifactbin/contracts';
import {renderSchema} from '@artifactbin/utils';
import type {RunnerDatabase} from './store';
const text=(name:string,notNull=false):Column=>({name,type:'TEXT',notNull});
const data=(name:string,notNull=false):Column=>({name,type:'JSONB',notNull});
/** In the OSS co-host these belong to app storage. A standalone controller owns the run tables in its private database. */
export const RUN_TABLES:Table[]=[
 {name:'runner_runs',columns:[text('id',true),text('owner',true),text('request_key',true),text('fingerprint',true),text('status',true),data('request',true),text('admitted_at',true),text('started_at'),data('receipt'),data('output')],primaryKey:['id'],indexes:[{name:'idx_runner_request',columns:['owner','request_key'],unique:true}]},
 {name:'runner_events',columns:[text('run_id',true),{name:'sequence',type:'INTEGER',notNull:true},data('event',true)],primaryKey:['run_id','sequence']}
];
export async function ensureRunnerTables(db:RunnerDatabase,tables:Table[]){for(const statement of renderSchema(tables))await db.query(statement);}
