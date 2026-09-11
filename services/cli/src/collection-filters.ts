import {enumArgument} from './arguments';
import {CliError} from './errors';
/** Filter schemas are finite; values belonging to users retain their exact spelling. */
export function collectionFilters(command:string,entries:string[]=[]):Record<string,string>{
 const schemas:Record<string,Record<string,readonly string[]|null>>={
  list:{search:null,visibility:['private','unlisted','public'],relationship:['all','owned','shared']},
  comment:{state:['open','resolved','all'],author:null},
 };
 const schema=schemas[command]??{};const result:Record<string,string>={};
 for(const entry of entries){const equal=entry.indexOf('='),key=entry.slice(0,equal),value=entry.slice(equal+1);
  if(equal<1||!value||!Object.hasOwn(schema,key))throw new CliError('invalid_filter',`Use a supported filter: ${Object.keys(schema).join(', ')}.`,`Run afbin ${command} -h.`);
  if(Object.hasOwn(result,key))throw new CliError('duplicate_filter',`Specify --filter ${key}=value once.`);
  result[key]=schema[key]?enumArgument(value,schema[key]!,'filter'):value;
 }
 return result;
}
