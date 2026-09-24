import {basename,extname} from 'node:path';
import {assetFormatOf,fileContentType} from '../../app/lib/story/file-types';
import {parseCsv} from '../../app/lib/data-ingest/csv';
import {datasetFileRows,isDatasetFile} from './dataset-file';
import {CliError} from './commands';
export function assetInput(path:string,bytes:Buffer):Record<string,unknown>{
 const extension=extname(path).toLowerCase();
 if(extension==='.csv'){
  if(!parseCsv(bytes.toString()).headers.length)throw new CliError('invalid_dataset',`${path} has no CSV columns.`);
  return{dataset:bytes.toString()};
 }
 if(isDatasetFile(path))return{dataset:datasetFileRows(path,bytes)};
 const format=assetFormatOf(path),contentType=fileContentType(basename(path));
 if(!format||!contentType)throw new CliError('unsupported_file_type',`Unsupported file type: ${path}.`,'Use JSX documents, CSV/JSON/GeoJSON rows or supported media files.');
 if(format==='image')return{image:`data:${contentType};base64,${bytes.toString('base64')}`};
 if(format==='pdf')return{pdf:`data:application/pdf;base64,${bytes.toString('base64')}`};
 return{file:{filename:basename(path),contentType,base64:bytes.toString('base64')}};
}
