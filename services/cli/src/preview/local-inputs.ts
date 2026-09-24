/**
 * Local bytes behind a registered reference. A tracked id can map to a typed resource YAML,
 * whose content lives in its `source` file; a session reads that file, never the YAML itself.
 */
import {join} from 'node:path';
import {inferColumns} from '../../../utils/src/shape';
import {parseCsv} from '../../../app/lib/data-ingest/csv';
import {coerceRows} from '../../../app/lib/data-ingest/coerce';
import type {DatasetTables} from '../../../app/lib/sql/dataflow-core';
import {parseResourceFile,readResourceSource} from '../resource-file';
import {confinedPath} from '../journal';
import {readOptional} from '../files';
import {CliError} from '../errors';

const isResourceFile=(path:string)=>/\.ya?ml$/i.test(path);

/** The workspace-relative file holding a reference's content, or undefined when only the host has it. */
export async function localInputPath(root:string,path:string):Promise<string|undefined>{
 if(!isResourceFile(path))return path;
 const bytes=await readOptional(await confinedPath(root,join(root,path)));
 if(!bytes)throw new CliError('missing_local_input',`Local resource ${path} is missing.`);
 try{return (await readResourceSource(parseResourceFile(bytes.toString()),path,root))?.path;}
 catch(error){throw new CliError('invalid_resource',`Local resource ${path}: ${error instanceof Error?error.message:String(error)}`);}
}

/** Stored rows for dataset `id` from its local file; undefined when it is defined remotely (a `<Dataset>` definition or no source). */
export async function readLocalDataset(root:string,path:string,id:string):Promise<DatasetTables[string]|undefined>{
 let input:string|undefined=path;
 try{
  input=await localInputPath(root,path);
  if(input===undefined||/\.jsx$/i.test(input))return undefined;
  const bytes=await readOptional(await confinedPath(root,join(root,input)));
  if(!bytes)throw Error('the file is missing');
  let rows:unknown;
  if(/\.csv$/i.test(input)){const csv=parseCsv(bytes.toString());rows=coerceRows(csv.headers,csv.rows);}
  else if(/\.json$/i.test(input)){try{rows=JSON.parse(bytes.toString());}catch{rows=undefined;}}
  if(!Array.isArray(rows)||!rows.every(row=>row&&typeof row==='object'&&!Array.isArray(row)))throw Error('it does not contain CSV or JSON row objects');
  return {rows,columns:inferColumns(rows)};
 }catch(error){
  // Name the reference and the file it resolved to; a bare parser message says neither.
  const file=input&&input!==path?`${input} (from ${path})`:path;
  throw new CliError('invalid_dataset',`Dataset ${id} reads ${file}: ${(error instanceof Error?error.message:String(error)).replace(/\.$/,'')}.`);
 }
}
