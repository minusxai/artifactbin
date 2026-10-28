import {enumArgument} from './arguments';
import {CliError} from './errors';
/** Filter schemas are finite; values belonging to users retain their exact spelling. */
export function collectionFilters(command:string,entries:string[]=[]):Record<string,string>{
 const schemas:Record<string,Record<string,readonly string[]|null>>={
  list:{search:null,visibility:['private','unlisted','public'],relationship:['all','owned','shared']},
  comment:{state:['open','resolved','all'],author:null},
  log:{author:null,since:null,until:null},
 };
 const schema=schemas[command]??{};const result:Record<string,string>={};
 for(const entry of entries){const equal=entry.indexOf('='),key=entry.slice(0,equal),value=entry.slice(equal+1);
  if(equal<1||!value||!Object.hasOwn(schema,key))throw new CliError('invalid_filter',`Use a supported filter: ${Object.keys(schema).join(', ')}.`,`Run afbin ${command} -h.`);
  if(Object.hasOwn(result,key))throw new CliError('duplicate_filter',`Specify --filter ${key}=value once.`);
  if(command==='log'&&(key==='since'||key==='until')&&Number.isNaN(Date.parse(value)))throw new CliError('invalid_filter',`--filter ${key} takes an ISO-8601 date or timestamp.`,'For example --filter since=2026-01-01.');
  result[key]=schema[key]?enumArgument(value,schema[key]!,'filter'):value;
 }
 if(command==='log'&&result.since&&result.until&&Date.parse(result.since)>Date.parse(result.until))throw new CliError('invalid_filter','The history interval ends before it starts.','Order --filter since and --filter until.');
 return result;
}
