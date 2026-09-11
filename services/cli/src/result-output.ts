import {resolve} from 'node:path';
import {stringify} from 'yaml';
import {atomicWrite} from './files';
import {CliError,type ParsedCommand} from './commands';
import {rowsCsv} from './tabular';

function rowSet(value:unknown):Record<string,unknown>[] {
 const result=value as {rows?:unknown;results?:unknown[];artifacts?:unknown[]};
 if(Array.isArray(result?.artifacts))return result.artifacts as Record<string,unknown>[];
 if(Array.isArray(result?.rows))return result.rows as Record<string,unknown>[];
 if(result?.results?.length===1)return rowSet(result.results[0]);
 throw new CliError('ambiguous_output','A tabular representation requires exactly one row result.','Select one target and one --name, or use --format json or yaml.');
}
function table(rows:Record<string,unknown>[]):string{
 const keys=[...new Set(rows.flatMap(Object.keys))];
 const clean=(v:unknown)=>(v==null?'':typeof v==='object'?JSON.stringify(v):String(v)).replace(/[\x00-\x1f\x7f]/g,' ');
 const cells=[keys,...rows.map(row=>keys.map(key=>clean(row[key])))];
 const widths=keys.map((_,i)=>Math.max(...cells.map(row=>row[i].length)));
 return cells.map(row=>row.map((cell,i)=>cell.padEnd(widths[i])).join('  ').trimEnd()).join('\n')+'\n';
}
/** Data output is exclusive and private; structured operation results stay separate. */
export async function resultOutput(value:unknown,parsed:ParsedCommand,cwd:string,emit:(value:unknown)=>void,stdout:(value:string)=>void):Promise<void>{
 const {flags}=parsed;const format=String(flags.format??'json');
 if(!flags.output&&!flags.format){emit(value);return;}
 const text=format==='csv'?rowsCsv(rowSet(value)):format==='table'?table(rowSet(value)):format==='yaml'?stringify(value,{lineWidth:0}):JSON.stringify(value,null,2)+'\n';
 if(!flags.output||flags.output==='-'){stdout(text);return;}
 const path=resolve(cwd,String(flags.output));
 try{await atomicWrite(path,text,{exclusive:true});}
 catch(error){if((error as NodeJS.ErrnoException).code==='EEXIST')throw new CliError('output_exists',`Output already exists: ${path}.`,'Choose a new --output path.');throw error;}
 emit({output:path,format});
}
