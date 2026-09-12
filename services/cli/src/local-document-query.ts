import {join} from 'node:path';
import {createSql} from '@artifactbin/sql/local';
import {isQueryFailure,type Scalar} from '@artifactbin/contracts';
import {inferColumns} from '@artifactbin/utils/shape';
import {parseJsx} from '../../app/lib/jsx';
import {splitHelmet} from '../../app/lib/story/helmet';
import {selectedQueries,type Dataflow} from '../../app/lib/story/dataflow';
import {validateQueryValues} from '../../app/lib/story/query-values';
import {evaluateDataflow,type DatasetTables} from '../../app/lib/sql/dataflow-core';
import {compileDatasetSql} from '../../app/lib/datasets/sql';
import {parseCsv} from '../../app/lib/data-ingest/csv';
import {coerceRows} from '../../app/lib/data-ingest/coerce';
import {parseDocument} from './document';
import {parseResourceFile,readResourceSource} from './resource-file';
import {readOptional,digest} from './files';
import {CliError,type ParsedCommand} from './commands';
import type {Workspace} from './workspace';

export async function localDocumentQuery(workspace:Workspace,path:string,source:Buffer,flags:ParsedCommand['flags'],values:Record<string,Scalar>){
 const tree=parseJsx(parseDocument(source.toString()).body);
 if(!tree.ok)throw new CliError('invalid_markup','The local document contains invalid JSX.','Run afbin validate on this file.');
 const {content}=splitHelmet(tree.nodes);const flow:Dataflow={values:content.values,queries:content.queries,mutations:content.mutations};
 const invalid=validateQueryValues(flow,values);if(invalid)throw new CliError(invalid.code,`${invalid.code}: ${invalid.names.join(', ')}.`,'Use exact declared scalar names and types.');
 const names=flow.queries.map(query=>query.name);if(flags.name&&!names.includes(String(flags.name)))throw new CliError('unknown_query',`Choose a declared query: ${names.join(', ')}.`);
 const selected=flags.name?[String(flags.name)]:names;
 if(flags.cursor&&selected.length!==1)throw new CliError('invalid_cursor','Select one query with --name before paging.');
 const queries=selectedQueries(flow,{only:selected});if(!queries)throw new CliError('invalid_query','The declared queries contain a dependency cycle.');
 const datasets:DatasetTables={};const fingerprints:string[]=[];
 for(const id of new Set(queries.flatMap(query=>query.source?[query.source]:query.refs))){
  const entry=Object.entries(workspace.tracking?.files??{}).find(([,tracked])=>tracked.id===id);
  if(!entry)throw new CliError('missing_local_input',`Dataset ${id} has no local copy.` ,`Run afbin pull ${id} to make its data available locally.`);
  let [input]=entry;let bytes=await readOptional(join(workspace.root,input));
  if(!bytes)throw new CliError('missing_local_input',`Local dataset ${input} is missing.`);
  if(/\.ya?ml$/i.test(input)){
   const resource=parseResourceFile(bytes.toString());const native=await readResourceSource(resource,input,workspace.root);
   if(!native)throw new CliError('missing_local_input',`Dataset ${input} requires remote inputs.`);
   input=native.path;bytes=Buffer.from(native.bytes,'base64');
  }
  let rows:unknown;
  if(/\.csv$/i.test(input)){const csv=parseCsv(bytes.toString());rows=coerceRows(csv.headers,csv.rows);}
  else if(/\.json$/i.test(input)){try{rows=JSON.parse(bytes.toString());}catch{throw new CliError('invalid_dataset',`${input} contains invalid JSON.`);}}
  if(!Array.isArray(rows)||!rows.every(row=>row&&typeof row==='object'&&!Array.isArray(row)))throw new CliError('invalid_dataset',`${input} must contain CSV or JSON row objects.`);
  fingerprints.push(digest(bytes));datasets[id]={rows,columns:inferColumns(rows)};
 }
 const limit=Number(flags.limit??20),fingerprint=digest(JSON.stringify([path,digest(source),fingerprints,selected,values,limit]));let offset=0;
 if(flags.cursor){
  try{const cursor=JSON.parse(Buffer.from(String(flags.cursor),'base64url').toString());if(cursor.fingerprint!==fingerprint||!Number.isSafeInteger(cursor.offset)||cursor.offset<0)throw Error();offset=cursor.offset;}
  catch{throw new CliError('invalid_cursor','The cursor no longer matches the local inputs.','Restart this query without --cursor.');}
 }
 const sql=createSql();const results=[];
 for(const name of selected){
  const state=await evaluateDataflow({run:input=>sql.run(input),queryRows:async(table,query,params,page)=>{
   const compiled=compileDatasetSql({kind:'stored',defaultSchema:'public',refreshSeconds:0,tables:[{schema:'public',name:'rows',columns:table.columns,source:{schema:'main',table:'source_rows'}}]},query,params);
   const outcome=(await sql.run({tables:{source_rows:table},queries:[{name:'result',sql:compiled.sql}],params:Object.fromEntries(compiled.values.map((v,i)=>[String(i+1),v])),...(page?{page:{...page,name:'result'}}:{})})).result;
   if(!outcome||isQueryFailure(outcome))throw new CliError('query_failed',outcome?.error??'No result.');return outcome;
  }},flow,datasets,{values,only:[name],page:{name,offset,limit:limit+1}});
  if(state.errors[name])throw new CliError('query_failed',state.errors[name]);const table=state.tables[name];if(!table)continue;
  results.push({path,name,execution:'local',...table,rows:table.rows.slice(0,limit),next_cursor:table.rows.length>limit?Buffer.from(JSON.stringify({fingerprint,offset:offset+limit})).toString('base64url'):null});
 }
 return {results};
}
