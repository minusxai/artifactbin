import {readFile,realpath} from 'node:fs/promises';
import path from 'node:path';
import type {DatasetColumn} from '@artifactbin/contracts';
import {inferColumns} from '@artifactbin/utils/shape';
import {parseCsv} from '../data-ingest/csv';
import {coerceRows} from '../data-ingest/coerce';
import {createLocalDataset} from './local';
import type {LocalDataset,LocalDatasetTable} from './local-types';
export interface LocalDatasetFile {path:string;table:string;schema?:string;columns?:DatasetColumn[]}
/** Only explicitly declared files under root are admitted; symlinks cannot escape root. */
export async function loadLocalDataset(root:string,namespace:string,files:readonly LocalDatasetFile[]):Promise<LocalDataset>{
 const base=await realpath(root),tables:LocalDatasetTable[]=[];
 for(const file of files){
 if(path.isAbsolute(file.path)||file.path.split(/[\\/]/).includes('..'))throw new Error('local_dataset_path');
 const target=await realpath(path.resolve(base,file.path));
 if(!target.startsWith(base+path.sep))throw new Error('local_dataset_path');
 const text=await readFile(target,'utf8');let rows:Record<string,unknown>[];let headers:string[];
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
