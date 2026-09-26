import {join} from 'node:path';
import type {Scalar} from '@artifactbin/contracts';
import {inferColumns} from '@artifactbin/utils/shape';
import {declarationsOf} from '../../app/lib/story/helmet';
import {validateQueryValues} from '../../app/lib/story/query-values';
import {selectQueries} from '../../app/lib/story/compiled-flow';
import {parseDocument} from './document';
import {parseResourceFile,readResourceSource} from './resource-file';
import {readOptional,digest} from './files';
import {CliError,type ParsedCommand} from './commands';
import {datasetFileRows,isDatasetFile} from './dataset-file';
import {compileLocal,runLocal} from './local-dataflow';
import type {Workspace} from './workspace';

export async function localDocumentQuery(workspace:Workspace,path:string,source:Buffer,flags:ParsedCommand['flags'],values:Record<string,Scalar>){
 const declared=declarationsOf(parseDocument(source.toString()).body);
 if(!declared)throw new CliError('invalid_markup','The local document contains invalid JSX.','Run afbin validate on this file.');
 const tables=new Map<string,{rows:Record<string,unknown>[];columns:ReturnType<typeof inferColumns>}>();const fingerprints:string[]=[];
 const table=async(id:string)=>{
  if(tables.has(id))return tables.get(id);
  const entry=Object.entries(workspace.tracking?.files??{}).find(([,tracked])=>tracked.id===id);
  if(!entry)throw new CliError('missing_local_input',`Dataset ${id} has no local copy.` ,`Run afbin pull ${id} to make its data available locally.`);
  let [input]=entry;let bytes=await readOptional(join(workspace.root,input));
  if(!bytes)throw new CliError('missing_local_input',`Local dataset ${input} is missing.`);
  if(/\.ya?ml$/i.test(input)){
   const resource=parseResourceFile(bytes.toString());const native=await readResourceSource(resource,input,workspace.root);
   if(!native)throw new CliError('missing_local_input',`Dataset ${input} requires remote inputs.`);
   input=native.path;bytes=Buffer.from(native.bytes,'base64');
  }
  if(!isDatasetFile(input))throw new CliError('invalid_dataset',`${input} must be CSV, JSON or GeoJSON rows.`);
  const rows=datasetFileRows(input,bytes);
  fingerprints.push(digest(bytes));const found={rows,columns:inferColumns(rows)};tables.set(id,found);return found;
 };
 const flow=await compileLocal(declared,table);
 const invalid=validateQueryValues(flow,values);if(invalid)throw new CliError(invalid.code,`${invalid.code}: ${invalid.names.join(', ')}.`,'Use exact declared scalar names and types.');
 const names=flow.queries.map(query=>query.name);if(flags.name&&!names.includes(String(flags.name)))throw new CliError('unknown_query',`Choose a declared query: ${names.join(', ')}.`);
 const selected=flags.name?[String(flags.name)]:names;
 if(flags.cursor&&selected.length!==1)throw new CliError('invalid_cursor','Select one query with --name before paging.');
 for(const q of selectQueries(flow,{only:selected}))if(q.engine==='postgres')throw new CliError('remote_query',`<Query name="${q.name}"> runs inside a connected database, which has no local copy.`,'Run it against the server: afbin query <id> --name '+q.name);
 const limit=Number(flags.limit??20),fingerprint=digest(JSON.stringify([path,digest(source),fingerprints,selected,values,limit]));let offset=0;
 if(flags.cursor){
  try{const cursor=JSON.parse(Buffer.from(String(flags.cursor),'base64url').toString());if(cursor.fingerprint!==fingerprint||!Number.isSafeInteger(cursor.offset)||cursor.offset<0)throw Error();offset=cursor.offset;}
  catch{throw new CliError('invalid_cursor','The cursor no longer matches the local inputs.','Restart this query without --cursor.');}
 }
 const results=[];
 for(const name of selected){
  const state=await runLocal(flow,table,{values,only:[name],page:{name,offset,limit:limit+1}});
  if(state.errors[name])throw new CliError('query_failed',state.errors[name]);const out=state.tables[name];if(!out)continue;
  results.push({path,name,execution:'local',...out,rows:out.rows.slice(0,limit),next_cursor:out.rows.length>limit?Buffer.from(JSON.stringify({fingerprint,offset:offset+limit})).toString('base64url'):null});
 }
 return {results};
}
