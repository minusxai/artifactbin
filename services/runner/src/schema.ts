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
 {name:'hosted_conversations',columns:[text('owner',true),text('artifact_id',true),{name:'revision',type:'INTEGER',notNull:true,default:'0'},{...text('input_buffer',true),default:"''"}],primaryKey:['owner','artifact_id']},
 {name:'hosted_branches',columns:[text('id',true),text('owner',true),text('artifact_id',true),text('request_key',true),data('input',true),text('program_source'),text('run_id'),{name:'cancel_pending',type:'BOOLEAN',notNull:true,default:'false'},{name:'cursor',type:'INTEGER',notNull:true,default:'0'},data('checkpoint'),data('result'),{...text('status',true),default:"'pending'"},{name:'created_at',type:'TIMESTAMPTZ',notNull:true,default:'now()'}],primaryKey:['id'],indexes:[{name:'idx_hosted_request',columns:['owner','request_key'],unique:true},{name:'idx_hosted_pending',columns:['status','created_at']}]}
];
export const SCHEDULE_TABLES:Table[]=[
 {name:'runner_schedules',columns:[text('id',true),text('owner',true),data('spec',true),{name:'next_due_at',type:'TIMESTAMPTZ',notNull:true},text('active_request'),{name:'enabled',type:'BOOLEAN',notNull:true,default:'true'},{name:'deleted',type:'BOOLEAN',notNull:true,default:'false'}],primaryKey:['id'],indexes:[{name:'idx_schedule_due',columns:['enabled','next_due_at']},{name:'idx_schedule_owner',columns:['owner','id']}]},
 {name:'runner_schedule_occurrences',columns:[text('request_id',true),text('schedule_id',true),{name:'scheduled_at',type:'TIMESTAMPTZ',notNull:true},{...text('status',true),default:"'pending'"}],primaryKey:['request_id'],indexes:[{name:'idx_runner_occurrence',columns:['schedule_id','scheduled_at'],unique:true},{name:'idx_occurrence_status',columns:['status']}]},
 {name:'runner_schedule_attempts',columns:[text('id',true),text('occurrence_id',true),{name:'attempt_number',type:'INTEGER',notNull:true},text('request_id',true),text('run_id'),{...text('status',true),default:"'pending'"},{name:'next_attempt_at',type:'TIMESTAMPTZ',notNull:true},text('error'),data('result'),data('envelope'),text('lease_token'),{name:'lease_until',type:'TIMESTAMPTZ'}],primaryKey:['id'],indexes:[{name:'idx_attempt_number',columns:['occurrence_id','attempt_number'],unique:true},{name:'idx_attempt_request',columns:['request_id'],unique:true},{name:'idx_attempt_dispatch',columns:['status','next_attempt_at','lease_until']}]}
];
export async function ensureRunnerTables(db:RunnerDatabase,tables:Table[]){for(const statement of renderSchema(tables))await db.query(statement);}
