import type {ContentObjects} from '@/lib/story/prepared-objects';
import type {ArtifactRow,TokenActor} from '@/lib/artifacts';
import type {StoredContent} from '@/lib/story/input';
import {json} from '@/lib/http';
import {publishDataset} from '@/lib/story/data-tiers';
import {loadDatasetRows} from '@/lib/story/dataset-store';
import type {DatasetCatalog,DatasetTable} from './types';
import {DatasetError} from './errors';
import {discoverPostgres} from './postgres';
import {executeCatalog} from './execute';
import {parseDatasetDefinition,serializeDatasetDefinition} from './definition';
import {resolveDatasetConnection} from './secrets';
import {compileNotebookSql} from './notebook';
import {queryPostgres} from './postgres';
import {connectionShape} from './input';
import type {DatasetColumn} from '@/lib/story/dataset-shape';
import {catalogInputShape} from './input';
import {catalogFromMetadata} from './catalog-metadata';
const shape=catalogInputShape;

/** Transitional legacy normalization stays at this boundary until catalog migration is complete. */
export function catalogOf(row:{meta:unknown}):DatasetCatalog|null {
 return catalogFromMetadata(row.meta);
}
/** Reader-safe catalog: public relations only, never connection or notebook internals. */
export function publicCatalogOf(row:{meta:unknown}):DatasetCatalog|null {
 const catalog=catalogOf(row);if(!catalog)return null;
 return {kind:catalog.kind,defaultSchema:catalog.defaultSchema,refreshSeconds:catalog.refreshSeconds,tables:catalog.tables.map(({schema,name,columns})=>({schema,name,columns}))};
}
const key=(table:{schema:string;name:string})=>JSON.stringify([table.schema,table.name]);
/**
 * The columns a stored table re-declared WITHOUT rows adds to its stored shape.
 * Adding is safe: every kept row reads null there. Dropping or retyping a stored
 * column would lose or mistype data the push never restated, so it is refused.
 * A bare name keeps its stored type; an undeclared column list keeps the shape.
 */
function reshapeWithoutRows(table:{schema:string;name:string;columns?:Array<string|DatasetColumn>},prior:DatasetTable):DatasetColumn[] {
 if(!table.columns)return [];
 const declared=table.columns.map(c=>typeof c==='string'?{name:c}:c),names=new Set(declared.map(c=>c.name));
 const where=`${table.schema}.${table.name}`;
 const dropped=prior.columns.filter(c=>!names.has(c.name)).map(c=>c.name);
 if(dropped.length)throw new DatasetError(`${where}: dropping stored column ${dropped.join(', ')} needs the table's rows restated; add rows={[...]} to reshape it`);
 const retyped=declared.filter((c):c is DatasetColumn=>'type' in c&&prior.columns.some(p=>p.name===c.name&&p.type!==c.type)).map(c=>c.name);
 if(retyped.length)throw new DatasetError(`${where}: retyping stored column ${retyped.join(', ')} needs the table's rows restated; add rows={[...]} to reshape it`);
 return declared.filter(c=>!prior.columns.some(p=>p.name===c.name)).map(c=>'type' in c?c as DatasetColumn:{name:c.name,type:'string' as const});
}
export async function prepareCatalog(input:unknown,actor:TokenActor,previous?:ArtifactRow,objects?:ContentObjects):Promise<StoredContent|Response> {
 try{
  const authored=typeof input==='string'?parseDatasetDefinition(input):input;
  if(authored&&typeof authored==='object'&&(authored as {connection?:unknown}).connection){
   const checked=catalogInputShape.safeParse(authored);if(!checked.success)throw new DatasetError(checked.error.issues.map(issue=>`${issue.path.join('.')}: ${issue.message}`).join('; '));
   const definition=checked.data;const connection=connectionShape.parse(definition.connection);
   if(definition.kind!=='postgres')throw new DatasetError('Connection settings require a Postgres dataset');
   const old=previous?catalogOf(previous):null,defaultSchema=definition.defaultSchema??'public';
   if(old&&old.kind!==definition.kind)throw new DatasetError('Create a new dataset to change its source kind');
   if(old&&old.defaultSchema!==defaultSchema)throw new DatasetError('The default schema is fixed to preserve existing query bindings');
   const tableNames=new Set<string>();for(const table of definition.tables){const tableKey=key(table);if(tableNames.has(tableKey))throw new DatasetError('Table names must be unique within a schema');tableNames.add(tableKey);if(!table.columns?.length||table.columns.some(c=>typeof c!=='string')||new Set(table.columns).size!==table.columns.length)throw new DatasetError('Every exposed table needs unique columns');const sources=Number(!!table.source)+Number(!!table.modelCellId)+Number(!!table.sql)+Number(!!table.rows);if(sources!==1)throw new DatasetError('Each table requires exactly one source');}
   if(!definition.tables.some(table=>table.schema===defaultSchema))throw new DatasetError('The default schema must exist in the catalog');
   const notebook=definition.notebook??{cells:[]};
   const config=await resolveDatasetConnection(connection,previous?undefined:actor,previous?.id);const discovered=await discoverPostgres(config);
   const raw:DatasetCatalog={kind:'postgres',connection,notebook,notebookSources:discovered,defaultSchema:'public',refreshSeconds:definition.refreshSeconds??60,tables:discovered.map(table=>({...table,source:{schema:table.schema,table:table.name}}))};
   const ids=new Set<string>(),names=new Set<string>(),outputs=new Map<string,DatasetColumn[]>();
   for(const cell of notebook.cells){if(ids.has(cell.id)||names.has(cell.name))throw new DatasetError('Notebook cell ids and names must be unique');ids.add(cell.id);names.add(cell.name);const compiled=compileNotebookSql(raw,notebook,cell.id);const result=await queryPostgres(config,compiled.sql,compiled.values,{limit:1,offset:0});outputs.set(cell.id,result.columns);}
   const tables:DatasetTable[]=definition.tables.map(table=>{if(table.modelCellId){const columns=outputs.get(table.modelCellId);if(!columns)throw new DatasetError(`Unknown model cell: ${table.modelCellId}`);const selected=(table.columns??[]).map(name=>{const column=columns.find(item=>item.name===name);if(!column)throw new DatasetError(`Model column is unavailable: ${table.schema}.${table.name}.${name}`);return column;});return {schema:table.schema,name:table.name,modelCellId:table.modelCellId,columns:selected};}if(!table.source||!table.columns)throw new DatasetError('A whitelisted table requires a source and columns');const source=discovered.find(item=>item.schema===table.source!.schema&&item.name===table.source!.table);const columns=table.columns.map(name=>{const column=source?.columns.find(item=>item.name===name);if(!column)throw new DatasetError(`Source column is unavailable: ${table.schema}.${table.name}.${name}`);return column;});return {schema:table.schema,name:table.name,source:table.source,columns};});
   const catalog:DatasetCatalog={kind:'postgres',connection,notebook,notebookSources:discovered,defaultSchema,refreshSeconds:definition.refreshSeconds??60,tables};
   const canonical=serializeDatasetDefinition({...definition,connection,defaultSchema:catalog.defaultSchema,refreshSeconds:catalog.refreshSeconds});
   return {format:'dataset',source:canonical,derivedTitle:null,meta:{catalog,columns:[]}};
  }
  const parsed=shape.safeParse(authored);if(!parsed.success)throw new DatasetError(parsed.error.issues.map(i=>`${i.path.join('.')}: ${i.message}`).join('; '));
  const data={...parsed.data,defaultSchema:parsed.data.defaultSchema??'public',refreshSeconds:parsed.data.refreshSeconds??60};const seen=new Set<string>();for(const t of data.tables){if(seen.has(key(t)))throw new DatasetError('Table names must be unique within a schema');seen.add(key(t));}
  if(!data.tables.some(t=>t.schema===data.defaultSchema))throw new DatasetError('The default schema must exist in the catalog');
  const old=previous?catalogOf(previous):null;
  if(old&&old.defaultSchema!==data.defaultSchema)throw new DatasetError('The default schema is fixed to preserve existing query bindings');
  if(old&&old.kind!==data.kind)throw new DatasetError('Create a new dataset to change its source kind');
  if(data.kind==='postgres'){
   throw new DatasetError('Postgres datasets require an inline dataset connection');
  }
  const tables:DatasetTable[]=[];
  for(const t of data.tables){
   if(t.sql){if(t.source||t.rows)throw new DatasetError('A model has SQL, not a second source');tables.push({schema:t.schema,name:t.name,sql:t.sql,columns:[]});continue;}
   if(t.source)throw new DatasetError('Stored tables do not have a remote source');
   const prior=old?.tables.find(p=>key(p)===key(t));
   if(!t.rows&&prior?.objectKey){
    const added=reshapeWithoutRows(t,prior);
    if(!added.length){tables.push({...prior});continue;}
    // Omitted rows mean KEEP them: republish the stored rows under the widened shape, null in each new column.
    const rows=objects?JSON.parse((await objects.get(prior.objectKey)).toString('utf8')):await loadDatasetRows({meta:{objectKey:prior.objectKey}});
    const stored=await publishDataset({columns:[...prior.columns,...added]},rows,objects);if(stored instanceof Response)return stored;
    tables.push({schema:t.schema,name:t.name,columns:stored.meta.columns as DatasetTable['columns'],objectKey:stored.meta.objectKey as string});continue;
   }
   const declared=t.columns?.filter(c=>typeof c!=='string')??prior?.columns.filter(c=>c.type==='user');
   /*
    * A table with NO ROWS has nothing to infer from, so the names it declares
    * are the whole shape: a bare `columns={['name','joined_on']}` becomes text
    * columns rather than a refusal. Only here — with rows present, inference
    * still types them, and a bare name must not silently retype a number.
    */
   const named=t.rows?.length===0&&!declared?.length?t.columns?.filter(c=>typeof c==='string').map(name=>({name,type:'string' as const})):undefined;
   const stored=await publishDataset(declared?.length?{columns:declared}:named?.length?{columns:named}:{},t.rows,objects);if(stored instanceof Response)return stored;
   tables.push({schema:t.schema,name:t.name,columns:stored.meta.columns as DatasetTable['columns'],objectKey:stored.meta.objectKey as string});
  }
  const catalog:DatasetCatalog={kind:data.kind,defaultSchema:data.defaultSchema,refreshSeconds:data.kind==='stored'?0:data.refreshSeconds,tables};
  // Dependencies are probed in topological order by retrying only unknown model shapes.
  const pending=tables.filter(t=>t.sql);let lastError:unknown;
  while(pending.length){let progress=false;
   for(let i=pending.length-1;i>=0;i--){const t=pending[i];try{const result=await executeCatalog(catalog,t.sql!,{}, {limit:1,refresh:true,objects});t.columns=result.columns;pending.splice(i,1);progress=true;}catch(error){lastError=error;}}
   if(!progress)throw new DatasetError(lastError instanceof Error?lastError.message:'Model dependencies are invalid or cyclic');
  }
  // Keep the original single-table alias pinned to public.rows; adding tables never rebinds it.
  const legacy=tables.find(t=>t.schema==='public'&&t.name==='rows'&&t.objectKey);
  return {format:'dataset',source:serializeDatasetDefinition(data),derivedTitle:null,meta:{catalog,...(legacy?{objectKey:legacy.objectKey,columns:legacy.columns}:{}),columns:legacy?.columns??[]}};
 }catch(error){return json({error:'invalid_dataset',details:[error instanceof Error?error.message:'Dataset validation failed']},error instanceof DatasetError?error.status:400);}
}
export async function storedTables(catalog:DatasetCatalog,objects?:Pick<ContentObjects,'get'>):Promise<Record<string,{rows:Record<string,unknown>[];columns:DatasetTable['columns']}>> {
 return Object.fromEntries(await Promise.all(catalog.tables.map(async(t,i)=>[ `dataset_table_${i}`,{rows:t.objectKey?(objects?JSON.parse((await objects.get(t.objectKey)).toString('utf8')):await loadDatasetRows({meta:{objectKey:t.objectKey}})):[],columns:t.columns}] as const)));
}
/**
 * The tables an `<Import>` of this dataset exposes under its name: the stored
 * tables of its default schema (`public.rows` reads as `<import>.rows`).
 * Models and other schemas stay behind the dataset's own catalog queries.
 */
export function importedTables(catalog:DatasetCatalog):DatasetTable[] {
 return catalog.kind==='stored'?catalog.tables.filter(t=>t.schema===catalog.defaultSchema&&!t.sql):[];
}
/** An imported dataset's rows, by the table names its import exposes. */
export async function importedRows(catalog:DatasetCatalog):Promise<Record<string,{rows:Record<string,unknown>[];columns:DatasetTable['columns']}>> {
 // A table defined but never written has no stored object yet: it is empty, not missing.
 return Object.fromEntries(await Promise.all(importedTables(catalog).map(async t=>[t.name,{rows:t.objectKey?await loadDatasetRows({meta:{objectKey:t.objectKey}}):[],columns:t.columns}] as const)));
}
