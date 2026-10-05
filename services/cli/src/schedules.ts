import {randomUUID} from 'node:crypto';
import {CliError} from './errors';
import type {HttpClient} from './http';
import type {Workspace} from './workspace';
import {recoverableOperation} from './recoverable-operation';

type Options=Record<string,string|boolean|string[]>;
const fields=['cron','timezone','input','max-attempts','retry-backoff'];
/** Schedule syntax stays separate from transport; the server owns cron and timezone semantics. */
export function validateScheduleArguments(positionals:string[],options:Options):void {
 const [action,id]=positionals;
 if(!['create','list','get','update','pause','resume','delete','run','history'].includes(action))throw new CliError('invalid_arguments','Choose schedule create, list, get, update, pause, resume, delete, run or history.');
 const needsId=!['create','list'].includes(action);
 if(positionals.length!==(needsId?2:1)||needsId&&!/^[A-Za-z0-9_-]{1,128}$/.test(id))throw new CliError('invalid_arguments','Use one schedule ID returned by schedule create or list.');
 if(action==='create'){
  for(const key of ['artifact','cron','timezone'])if(typeof options[key]!=='string'||!String(options[key]).trim())throw new CliError('invalid_arguments',`schedule create requires --${key}.`);
  if(!/^[A-Za-z0-9]{6,12}$/.test(String(options.artifact)))throw new CliError('invalid_reference','--artifact requires a published artifact ID; schedules execute its live head.');
 }else if(options.artifact!==undefined)throw new CliError('invalid_arguments','--artifact applies only to schedule create.');
 if(!['create','update'].includes(action)&&fields.some(key=>options[key]!==undefined))throw new CliError('invalid_arguments','Schedule configuration flags apply only to create or update.');
 if(action==='update'&&!fields.some(key=>options[key]!==undefined))throw new CliError('invalid_arguments','schedule update requires at least one configuration flag.');
 for(const key of ['cron','timezone'])if(options[key]!==undefined&&!String(options[key]).trim())throw new CliError('invalid_arguments',`--${key} must not be empty.`);
 for(const key of ['max-attempts','retry-backoff'])if(options[key]!==undefined&&(!/^\d+$/.test(String(options[key]))||!Number.isSafeInteger(Number(options[key]))||Number(options[key])<1))throw new CliError('invalid_arguments',`--${key} requires a positive integer.`);
 if(options.input!==undefined)parseInput(String(options.input));
 if(options.request!==undefined&&(action!=='run'||typeof options.request!=='string'||!options.request.trim()||options.request.length>128))throw new CliError('invalid_arguments','--request applies only to schedule run and requires a stable nonempty ID (up to 128 characters).');
}
function parseInput(value:string):unknown {try{return JSON.parse(value);}catch{throw new CliError('invalid_input','Schedule input must be valid JSON.','Pass --input \'{"key":"value"}\' or --input null.');}}
/** Thin client of the same authenticated scheduling endpoints used by the app. */
export async function scheduleCommand(workspace:Workspace,client:HttpClient,positionals:string[],options:Options):Promise<Record<string,unknown>> {
 const [action,id]=positionals;const path=`/schedules${id?`/${id}`:''}`;
 if(action==='list'||action==='get')return client.request(path);
 if(action==='history')return client.request(`${path}/history`);
 if(action==='delete')return client.request(path,'DELETE');
 if(action==='pause'||action==='resume')return client.request(path,'PATCH',{enabled:action==='resume'});
 if(action==='run'){
  const body=options.request!==undefined?{requestId:String(options.request)}:{};
  return recoverableOperation(workspace,client,{path:`${path}/run`,method:'POST',body,prepare:async()=>({body:{requestId:options.request??randomUUID()}})});
 }
 const body:Record<string,unknown>={};
 if(action==='create')body.artifactId=options.artifact;
 for(const key of ['cron','timezone'])if(options[key]!==undefined)body[key]=options[key];
 if(options.input!==undefined)body.input=parseInput(String(options.input));
 if(options['max-attempts']!==undefined)body.maxAttempts=Number(options['max-attempts']);
 if(options['retry-backoff']!==undefined)body.retryBackoffSeconds=Number(options['retry-backoff']);
 return client.request(path,action==='create'?'POST':'PATCH',body);
}
