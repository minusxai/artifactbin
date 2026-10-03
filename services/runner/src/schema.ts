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
export const AGENT_TABLES:Table[]=[
 {name:'hosted_conversations',columns:[text('owner',true),text('artifact_id',true),{name:'revision',type:'INTEGER',notNull:true,default:'0'}],primaryKey:['owner','artifact_id']},
 {name:'hosted_branches',columns:[text('id',true),text('owner',true),text('artifact_id',true),text('request_key',true),data('input',true),text('program_source'),text('run_id'),{name:'cursor',type:'INTEGER',notNull:true,default:'0'},data('checkpoint'),data('result'),{...text('status',true),default:"'pending'"},{name:'created_at',type:'TIMESTAMPTZ',notNull:true,default:'now()'}],primaryKey:['id'],indexes:[{name:'idx_hosted_request',columns:['owner','request_key'],unique:true},{name:'idx_hosted_pending',columns:['status','created_at']}]}
];
export const SCHEDULE_TABLES:Table[]=[
 {name:'runner_schedules',columns:[text('id',true),text('owner',true),data('spec',true),{name:'next_due_at',type:'TIMESTAMPTZ',notNull:true},text('active_request'),{name:'enabled',type:'BOOLEAN',notNull:true,default:'true'}],primaryKey:['id']},
 {name:'runner_schedule_occurrences',columns:[text('request_id',true),text('schedule_id',true),{name:'scheduled_at',type:'TIMESTAMPTZ',notNull:true},data('spec',true),text('run_id'),{...text('status',true),default:"'pending'"}],primaryKey:['request_id'],indexes:[{name:'idx_runner_occurrence',columns:['schedule_id','scheduled_at'],unique:true}]}
];
export async function ensureRunnerTables(db:RunnerDatabase,tables:Table[]){for(const statement of renderSchema(tables))await db.query(statement);}
