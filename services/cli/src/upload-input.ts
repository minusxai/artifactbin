import {basename,extname} from 'node:path';
import {assetFormatOf,fileContentType} from '../../app/lib/story/file-types';
import {parseCsv} from '../../app/lib/data-ingest/csv';
import {CliError} from './commands';
export function assetInput(path:string,bytes:Buffer):Record<string,unknown>{
 const extension=extname(path).toLowerCase();
 if(extension==='.csv'){
  if(!parseCsv(bytes.toString()).headers.length)throw new CliError('invalid_dataset',`${path} has no CSV columns.`);
  return{dataset:bytes.toString()};
 }
 if(extension==='.json'){
  let rows:unknown;try{rows=JSON.parse(bytes.toString());}catch{throw new CliError('invalid_dataset',`${path} is not valid JSON.`);}
  if(!Array.isArray(rows)||!rows.every(row=>row!==null&&typeof row==='object'&&!Array.isArray(row)))throw new CliError('invalid_dataset',`${path} must contain an array of row objects.`,'Run afbin help data.');
  return{dataset:rows};
 }
 const format=assetFormatOf(path),contentType=fileContentType(basename(path));
 if(!format||!contentType)throw new CliError('unsupported_file_type',`Unsupported file type: ${path}.`,'Use JSX documents, CSV/JSON rows or supported media files.');
 if(format==='image')return{image:`data:${contentType};base64,${bytes.toString('base64')}`};
 if(format==='pdf')return{pdf:`data:application/pdf;base64,${bytes.toString('base64')}`};
 return{file:{filename:basename(path),contentType,base64:bytes.toString('base64')}};
}
