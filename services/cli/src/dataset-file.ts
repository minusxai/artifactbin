import {extname} from 'node:path';
import {parseCsv} from '../../app/lib/data-ingest/csv';
import {coerceRows} from '../../app/lib/data-ingest/coerce';
import {geoJsonRows,rowsGeoJson} from '../../app/lib/data-ingest/geojson';
import {rowsCsv} from './tabular';
import {CliError} from './errors';

/**
 * The local files that are dataset ROWS, decided by extension alone: `.csv`,
 * `.json` (an array of row objects) and `.geojson` (one row per feature, its
 * geometry in a `geometry` column). Every command that reads, pushes, diffs or
 * pulls a dataset file asks here, so the three never disagree.
 */
export const DATASET_EXTENSIONS=['.csv','.json','.geojson'];
export const isDatasetFile=(path:string):boolean=>DATASET_EXTENSIONS.includes(extname(path).toLowerCase());

type Row=Record<string,unknown>;
const isRows=(rows:unknown):rows is Row[]=>Array.isArray(rows)&&rows.every(row=>row!==null&&typeof row==='object'&&!Array.isArray(row));

/** A dataset file's rows, or a named refusal. `label` names the file in the message. */
export function datasetFileRows(path:string,bytes:Buffer,label=path):Row[]{
 const extension=extname(path).toLowerCase();
 if(extension==='.csv'){const csv=parseCsv(bytes.toString());return coerceRows(csv.headers,csv.rows) as Row[];}
 let value:unknown;try{value=JSON.parse(bytes.toString());}catch{throw new CliError('invalid_dataset',`${label} is not valid JSON.`);}
 if(extension==='.geojson'){
  let rows:Row[]|null;
  try{rows=geoJsonRows(value);}catch(error){throw new CliError('invalid_dataset',`${label}: ${(error as Error).message}.`);}
  if(!rows)throw new CliError('invalid_dataset',`${label} must be a GeoJSON FeatureCollection or Feature.`,'TopoJSON is not GeoJSON: convert it first (for example with topojson-client or mapshaper).');
  return rows;
 }
 if(isRows(value))return value;
 if(geoJsonRows(value))throw new CliError('invalid_dataset',`${label} is GeoJSON; name it .geojson so each feature becomes a row with a geometry column.`,'Rename the file to .geojson and push again.');
 throw new CliError('invalid_dataset',`${label} must contain an array of row objects.`,'Run afbin help data.');
}

/** Rows written back to a local dataset file in that file's own format. */
export function datasetFileBytes(path:string,rows:Row[]):Buffer{
 const extension=extname(path).toLowerCase();
 if(extension==='.csv')return Buffer.from(rowsCsv(rows));
 return Buffer.from(JSON.stringify(extension==='.geojson'?rowsGeoJson(rows):rows,null,2)+'\n');
}
