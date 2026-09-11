import {extname,join} from 'node:path';
import {createSql} from '@artifactbin/sql/local';
import {inferColumns} from '@artifactbin/utils/shape';
import {isQueryFailure,type Scalar} from '@artifactbin/contracts';
import {compileDatasetSql} from '../../app/lib/datasets/sql';
import {parseCsv} from '../../app/lib/data-ingest/csv';
import {coerceRows} from '../../app/lib/data-ingest/coerce';
import {resolveReference} from './reference';
import {readOptional,digest} from './files';
import {CliError,type ParsedCommand} from './commands';
import type {Workspace} from './workspace';

export function queryParameters(values:string[]=[]):Record<string,Scalar>{
 const params:Record<string,Scalar>=Object.create(null);
 for(const pair of values){
  const equal=pair.indexOf('=');const key=pair.slice(0,equal);const raw=pair.slice(equal+1);
  if(equal<1||Object.hasOwn(params,key))throw new CliError('invalid_parameter','Use each --param name=value once.');
  let value:unknown=raw;try{value=JSON.parse(raw);}catch{/* Plain strings need no quoting. */}
  if(value!==null&&!['string','boolean','number'].includes(typeof value)||typeof value==='number'&&!Number.isFinite(value))throw new CliError('invalid_parameter',`Parameter ${key} must be a scalar.`);
  params[key]=value as Scalar;
 }
 return params;
}

/** Local engines receive bytes and bound values; no HTTP client or credentials enter this boundary. */
export async function localQuery(workspace:Workspace,parsed:ParsedCommand,sql:string|undefined,server:string){
 const {flags,positionals}=parsed;if(flags.remote||flags.write)return null;
 const params=queryParameters(flags.param as string[]|undefined);
 const sources=[];
 for(const input of positionals){
  const ref=await resolveReference(input,{root:workspace.root,cwd:workspace.cwd,server});
  if(ref.kind!=='path'||ref.version||!['.csv','.json'].includes(extname(ref.path).toLowerCase()))return null;
  const bytes=await readOptional(join(workspace.root,ref.path));if(!bytes)throw new CliError('missing_file',`Missing dataset: ${input}.`);
  let rows:unknown;
  if(extname(ref.path).toLowerCase()==='.csv'){const csv=parseCsv(bytes.toString());rows=coerceRows(csv.headers,csv.rows);}
  else try{rows=JSON.parse(bytes.toString());}catch{throw new CliError('invalid_dataset',`${input} must contain JSON row objects.`);}
  if(!Array.isArray(rows)||!rows.every(row=>row&&typeof row==='object'&&!Array.isArray(row)))throw new CliError('invalid_dataset',`${input} must contain an array of row objects.`);
  sources.push({path:ref.path,bytes,rows:rows as Record<string,unknown>[]});
 }
 const results=[];
 for(const source of sources){
  if(flags.name&&flags.name!=='rows'&&flags.name!=='public.rows')throw new CliError('unknown_table','This dataset contains public.rows.');
  const columns=inferColumns(source.rows);const limit=Number(flags.limit??20);
  const query=sql??'select * from public.rows';
  const fingerprint=digest(JSON.stringify([source.path,digest(source.bytes),query,params,limit]));
  let offset=0;
  if(flags.cursor){
   let cursor:unknown;try{cursor=JSON.parse(Buffer.from(String(flags.cursor),'base64url').toString());}catch{/* Invalid cursors fail below. */}
   const page=cursor as {fingerprint?:unknown;offset?:unknown}|undefined;
   if(!page||page.fingerprint!==fingerprint||!Number.isSafeInteger(page.offset)||Number(page.offset)<0)throw new CliError('invalid_cursor','The cursor does not match these inputs.','Run the query without --cursor to start again.');
   offset=Number(page.offset);
  }
  const compiled=compileDatasetSql({kind:'stored',defaultSchema:'public',refreshSeconds:0,tables:[{schema:'public',name:'rows',columns,source:{schema:'main',table:'source_rows'}}]},query,params);
  const outcome=(await createSql().run({tables:{source_rows:{rows:source.rows,columns}},queries:[{name:'result',sql:compiled.sql}],params:Object.fromEntries(compiled.values.map((value,i)=>[String(i+1),value])),limit:limit+1,page:{name:'result',offset,limit:limit+1}})).result;
  if(!outcome||isQueryFailure(outcome))throw new CliError('query_failed',outcome?.error??'The local query produced no result.','Run afbin query -h for supported inputs.');
  const more=outcome.rows.length>limit;
  results.push({path:source.path,execution:'local',columns:outcome.columns,rows:outcome.rows.slice(0,limit),next_cursor:more?Buffer.from(JSON.stringify({fingerprint,offset:offset+limit})).toString('base64url'):null});
 }
 return {results};
}
