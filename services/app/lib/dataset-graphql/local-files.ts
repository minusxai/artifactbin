import {constants} from 'node:fs';
import {open,realpath} from 'node:fs/promises';
import path from 'node:path';
import type {DatasetColumn} from '@artifactbin/contracts';
import {inferColumns} from '@artifactbin/utils/shape';
import {parseCsv} from '../data-ingest/csv';
import {coerceRows} from '../data-ingest/coerce';
import {createLocalDataset} from './local';
import type {LocalDataset,LocalDatasetTable} from './local-types';
export interface LocalDatasetFileOptions {
 /** Trusted reader relative to root; owns descriptor confinement and byte bounds. */
 readText?:(relativePath:string)=>Promise<string>;
}
const LOCAL_DATASET_MAX_BYTES=32*1024*1024;
async function boundedText(target:string):Promise<string>{
 const handle=await open(target,constants.O_RDONLY|constants.O_NOFOLLOW);
 try{
 const stat=await handle.stat();if(!stat.isFile()||stat.size>LOCAL_DATASET_MAX_BYTES)throw new Error('local_dataset_file_size');
 const bytes=Buffer.alloc(Math.min(stat.size+1,LOCAL_DATASET_MAX_BYTES+1));let count=0;
 while(count<bytes.length){const read=await handle.read(bytes,count,bytes.length-count,null);if(!read.bytesRead)break;count+=read.bytesRead;}
 // Growth is refused rather than returning a truncated CSV or JSON document.
 const extra=Buffer.alloc(1),tail=await handle.read(extra,0,1,null);
 if(count>stat.size||tail.bytesRead)throw new Error('local_dataset_file_changed');
 return bytes.subarray(0,count).toString('utf8');
 }finally{await handle.close();}
}
export interface LocalDatasetFile {path:string;table:string;schema?:string;columns?:DatasetColumn[]}
/** Only explicitly declared files under root are admitted; symlinks cannot escape root. */
export async function loadLocalDataset(root:string,namespace:string,files:readonly LocalDatasetFile[],options:LocalDatasetFileOptions={}):Promise<LocalDataset>{
 if(files.length>64)throw new Error('local_dataset_too_many_files');
 const base=await realpath(root),tables:LocalDatasetTable[]=[];let totalBytes=0;
 for(const file of files){
 if(path.isAbsolute(file.path)||file.path.split(/[\\/]/).includes('..'))throw new Error('local_dataset_path');
 const target=options.readText?path.resolve(base,file.path):await realpath(path.resolve(base,file.path));
 if(!target.startsWith(base+path.sep))throw new Error('local_dataset_path');
 const text=options.readText?await options.readText(file.path):await boundedText(target);
 totalBytes+=Buffer.byteLength(text);
 if(totalBytes>LOCAL_DATASET_MAX_BYTES)throw new Error('local_dataset_file_size');let rows:Record<string,unknown>[];let headers:string[];
 if(path.extname(target).toLowerCase()==='.csv'){
 const csv=parseCsv(text);if(csv.rows.some(row=>row.length>csv.headers.length))throw new Error('local_dataset_csv_width');
 rows=coerceRows(csv.headers,csv.rows,file.columns,csv.quotedEmptyCells);headers=csv.headers;
 }else if(path.extname(target).toLowerCase()==='.json'){
 const value:unknown=JSON.parse(text);if(!Array.isArray(value)||value.some(row=>!row||typeof row!=='object'||Array.isArray(row)))throw new Error('local_dataset_json_rows');
 rows=value as Record<string,unknown>[];headers=[...new Set(rows.flatMap(Object.keys))];
 }else throw new Error('local_dataset_format');
 const inferred=inferColumns(rows),columns=file.columns??headers.map(name=>inferred.find(c=>c.name===name)??{name,type:'string'});
 tables.push({schema:file.schema??'main',name:file.table,columns,rows});
 }
 if(new Set(tables.map(t=>JSON.stringify([t.schema,t.name]))).size!==tables.length)throw new Error('local_dataset_duplicate_table');
 return createLocalDataset(namespace,tables);
}
